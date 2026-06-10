// Defendant entity resolution.
//
// "Capital One Bank, N.A." vs "Capital One" vs "Capital One Financial Corp" all
// need to collapse to a single canonical defendant ID so a credit.com client
// whose collections history names "Capital One" can match a TCPA case captioned
// "Smith v. Capital One Bank, N.A."
//
// KV layout:
//   tcpa:defendant:${canonicalId}              full defendant record
//   tcpa:defendant_alias:${normalizedAlias}    alias → canonicalId lookup
//   tcpa:defendants_index                      sorted set of canonicalIds (alphabetical)
//
// Resolution strategy (cheapest → most expensive):
//   1. Exact normalized-alias hit          → instant
//   2. Trigram similarity over all aliases → in-process, no API call
//   3. Haiku judgment call (api/resolve-defendant.js)
//
// This module exposes the deterministic pieces. Step 3 lives in api/resolve-defendant.js
// because it needs ANTHROPIC_API_KEY.

import { kv } from "@vercel/kv";

const COMMON_SUFFIXES = [
  "n.a.", "na",
  "inc.", "inc",
  "incorporated",
  "llc",
  "l.l.c.",
  "ltd.", "ltd",
  "limited",
  "corp.", "corp",
  "corporation",
  "co.", "co",
  "company",
  "lp", "l.p.",
  "llp", "l.l.p.",
  "plc",
  "p.c.", "pc",
  "bank",
  "trust",
  "financial",
  "holdings",
  "group",
  "services",
  "solutions",
  "the",
];

// Normalize a raw defendant name into a stable comparison key.
// "Capital One Bank, N.A." → "capital one"
// "PORTFOLIO RECOVERY ASSOCIATES, LLC" → "portfolio recovery associates"
export function normalize(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing common corporate suffixes (iteratively — multiple may stack).
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMMON_SUFFIXES) {
      if (s.endsWith(" " + suf)) {
        s = s.slice(0, -(suf.length + 1)).trim();
        changed = true;
      }
      if (s === suf) {
        s = "";
        changed = true;
      }
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

// Trigram set for similarity scoring.
function trigrams(s) {
  const padded = "  " + s + "  ";
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

// Jaccard similarity over trigram sets, range [0, 1].
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Look up a canonical defendant ID by exact normalized alias.
// Returns canonicalId or null.
export async function resolveExact(rawName) {
  const norm = normalize(rawName);
  if (!norm) return null;
  const cId = await kv.get(`tcpa:defendant_alias:${norm}`);
  return cId || null;
}

// Find top-K candidate defendants by trigram similarity.
// Returns [{ canonicalId, displayName, similarity }, ...] sorted desc.
export async function findCandidates(rawName, k = 5) {
  const norm = normalize(rawName);
  if (!norm) return [];
  const ids = await kv.zrange("tcpa:defendants_index", 0, -1).catch(() => []);
  if (!ids.length) return [];
  // Batch-read defendant records.
  const BATCH = 100;
  const candidates = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = await Promise.all(
      ids.slice(i, i + BATCH).map((id) => kv.get(`tcpa:defendant:${id}`))
    );
    batch.forEach((r) => {
      if (!r) return;
      const d = typeof r === "string" ? JSON.parse(r) : r;
      const aliases = [d.displayName, ...(d.aliases || [])];
      let best = 0;
      for (const a of aliases) {
        const score = similarity(norm, normalize(a));
        if (score > best) best = score;
      }
      if (best > 0.3) {
        candidates.push({
          canonicalId: d.canonicalId,
          displayName: d.displayName,
          similarity: best,
        });
      }
    });
  }
  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, k);
}

// Persist a brand-new canonical defendant.
export async function createDefendant({ displayName, aliases = [], parent = null, industry = "", hqState = "" }) {
  const canonicalId = `def_${normalize(displayName).replace(/\s+/g, "_")}_${Math.random().toString(36).slice(2, 6)}`;
  const record = {
    canonicalId,
    displayName,
    aliases: [...new Set([displayName, ...aliases])],
    parent,
    subsidiaries: [],
    industry,
    hqState: (hqState || "").toUpperCase().slice(0, 2),
    createdAt: new Date().toISOString(),
  };
  const ops = [
    kv.set(`tcpa:defendant:${canonicalId}`, JSON.stringify(record), { ex: 365 * 24 * 3600 }),
    kv.zadd("tcpa:defendants_index", { score: Date.now(), member: canonicalId }),
  ];
  // Write alias → canonicalId lookups
  for (const alias of record.aliases) {
    const norm = normalize(alias);
    if (norm) ops.push(kv.set(`tcpa:defendant_alias:${norm}`, canonicalId, { ex: 365 * 24 * 3600 }));
  }
  await Promise.all(ops);
  return record;
}

// Add an alias to an existing canonical defendant.
export async function addAlias(canonicalId, alias) {
  const raw = await kv.get(`tcpa:defendant:${canonicalId}`);
  if (!raw) throw new Error(`defendantResolver.addAlias: unknown canonicalId '${canonicalId}'`);
  const record = typeof raw === "string" ? JSON.parse(raw) : raw;
  const norm = normalize(alias);
  if (!norm) return record;
  if (!record.aliases.includes(alias)) {
    record.aliases.push(alias);
    await kv.set(`tcpa:defendant:${canonicalId}`, JSON.stringify(record), { ex: 365 * 24 * 3600 });
  }
  await kv.set(`tcpa:defendant_alias:${norm}`, canonicalId, { ex: 365 * 24 * 3600 });
  return record;
}

// Merge two canonical defendants (collapse `loserId` into `winnerId`).
// All aliases of the loser get re-pointed to the winner; the loser record stays
// as a tombstone with `mergedInto: winnerId` so old references still resolve.
export async function mergeEntities(winnerId, loserId) {
  if (winnerId === loserId) return null;
  const [winRaw, loseRaw] = await Promise.all([
    kv.get(`tcpa:defendant:${winnerId}`),
    kv.get(`tcpa:defendant:${loserId}`),
  ]);
  if (!winRaw || !loseRaw) {
    throw new Error("defendantResolver.mergeEntities: one or both IDs not found");
  }
  const winner = typeof winRaw === "string" ? JSON.parse(winRaw) : winRaw;
  const loser  = typeof loseRaw === "string" ? JSON.parse(loseRaw) : loseRaw;

  // Merge aliases
  winner.aliases = [...new Set([...winner.aliases, ...loser.aliases])];
  winner.subsidiaries = [...new Set([...(winner.subsidiaries || []), ...(loser.subsidiaries || [])])];

  // Re-point alias lookups
  const aliasOps = loser.aliases.map((a) => {
    const norm = normalize(a);
    return norm ? kv.set(`tcpa:defendant_alias:${norm}`, winnerId, { ex: 365 * 24 * 3600 }) : null;
  }).filter(Boolean);

  await Promise.all([
    kv.set(`tcpa:defendant:${winnerId}`, JSON.stringify(winner), { ex: 365 * 24 * 3600 }),
    kv.set(`tcpa:defendant:${loserId}`, JSON.stringify({ ...loser, mergedInto: winnerId }), { ex: 365 * 24 * 3600 }),
    kv.zrem("tcpa:defendants_index", loserId),
    ...aliasOps,
  ]);

  return winner;
}

// Resolve or create — the most common entry point.
// 1. Exact alias hit → return canonicalId
// 2. High-similarity (>= 0.85) candidate → auto-link as alias and return
// 3. Otherwise → return { needsReview: true, candidates: [...] }
//    (Caller can either create a new defendant via createDefendant or escalate to Haiku.)
export async function resolveOrSuggest(rawName, { autoLinkThreshold = 0.85 } = {}) {
  const exact = await resolveExact(rawName);
  if (exact) return { canonicalId: exact, source: "exact" };

  const candidates = await findCandidates(rawName, 5);
  if (candidates.length && candidates[0].similarity >= autoLinkThreshold) {
    await addAlias(candidates[0].canonicalId, rawName);
    return { canonicalId: candidates[0].canonicalId, source: "trigram", similarity: candidates[0].similarity };
  }

  return { needsReview: true, candidates };
}
