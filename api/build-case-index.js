// GET /api/build-case-index
// In-region resumable sweep that runs EVERY person in the credit DB against
// EVERY case (defendant) in our catalog, and writes a per-case inverted index
// so each case can show its complete matched population instantly.
//
// For each `client:*` record it inspects `cases[].defendant` and, for every
// catalog defendant token that the signal names, adds the person to
//   casepeople:<defendantToken>:<shard>   (zset, score = priorityScore)
// Each per-case index is SHARDED across N_SHARDS sub-zsets (by a hash of the
// person id), so even a very common furnisher (Capital One ~900K people) stays
// far under Upstash's 100MB per-key limit while retaining the COMPLETE matched
// population — no cap. Readers merge the shards.
//
// Catalog = the 41 PACER FDCPA/FCRA clusters (match:defendant_evidence), the
// national TCPA marketer defendants (pacer:tcpa_marketers), the national
// consumer-credit entities (pacer:national_entities — Top-1000 + bureaus), and
// every claim-path registry token (case:claim_paths — settlement defendants).
//
// Resumable via `caseindex:stats.cursor`; idempotent (ZADD). Driven by cron
// until the SCAN cursor returns to 0, then refreshes at most once per REFRESH_MS.

import { kv } from "@vercel/kv";
import { canonicalToken } from "./_lib/defendantToken.js";

const TIME_BUDGET_MS = 230_000;   // stop well before the 300s function limit
const SCAN_COUNT     = 1000;      // Upstash caps returned keys at ~1000/call
const REFRESH_MS     = 12 * 60 * 60 * 1000;
const N_SHARDS       = 16;        // per-defendant index sharded -> no 200K cap, full lists

// Spread a defendant's people across N_SHARDS sub-zsets so even the largest
// defendant (Capital One ~900K) stays far under Upstash's 100MB per-key limit.
function shardOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % N_SHARDS;
}

async function loadCatalogTokens() {
  const [evRaw, tcpaRaw, natRaw, pathsRaw] = await Promise.all([
    kv.get("match:defendant_evidence"),
    kv.get("pacer:tcpa_marketers"),
    kv.get("pacer:national_entities"),
    kv.get("case:claim_paths"),
  ]);
  const parse = r => (r ? (typeof r === "string" ? JSON.parse(r) : r) : {});
  const ev    = parse(evRaw);
  const tcpa  = parse(tcpaRaw);
  const nat   = parse(natRaw);
  const paths = parse(pathsRaw);

  const tokens = new Set();
  for (const name of Object.keys(ev.clusters || {})) {
    const t = canonicalToken(name);
    if (t) tokens.add(t);
  }
  for (const d of (tcpa.defendants || [])) {
    const t = canonicalToken(d.defendant || d.defendantQ || "");
    if (t) tokens.add(t);
  }
  for (const d of (nat.entities || [])) {
    const t = canonicalToken(d.defendant || d.defendantQ || "");
    if (t) tokens.add(t);
  }
  for (const t of Object.keys(paths.registry || {})) {
    if (t) tokens.add(t);
  }
  return [...tokens];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const stats = (await kv.get("caseindex:stats")) || {};
    const now = Date.now();

    // If a previous full sweep completed recently, no-op (let cron rest).
    if (stats.done && stats.completedAt && (now - stats.completedAt) < REFRESH_MS && !req.query.force) {
      return res.status(200).json({ status: "idle", message: "Index fresh; nothing to do.", stats });
    }

    const tokens = await loadCatalogTokens();
    if (tokens.length === 0) {
      return res.status(200).json({ status: "no_catalog", message: "No catalog defendants loaded." });
    }
    const tokenSet = new Set(tokens);

    // Resume point. A fresh start (or a forced refresh) begins at cursor 0.
    let cursor = stats.done || req.query.force ? "0" : (stats.cursor || "0");
    let scanned = stats.done || req.query.force ? 0 : (stats.scanned || 0);
    let indexed = stats.done || req.query.force ? 0 : (stats.indexed || 0);
    const startedAt = stats.done || req.query.force ? now : (stats.startedAt || now);

    const start = Date.now();
    let completed = false;

    while (Date.now() - start < TIME_BUDGET_MS) {
      const [next, keys] = await kv.scan(cursor, { match: "client:*", count: SCAN_COUNT });
      cursor = next;

      if (keys && keys.length) {
        const records = await kv.mget(...keys);
        const byBucket = new Map();   // "token:shard" -> [{ score, member }]

        for (const r of records) {
          if (!r) continue;
          const c = typeof r === "string" ? JSON.parse(r) : r;
          scanned++;
          const id = c.id;
          if (!id) continue;
          // Dedup-suppressed lex_ twins (supersededBy a cc_ record) must stay out
          // of the rebuilt per-defendant index so they no longer double-count.
          if (c.suppressed) continue;
          const score = Number(c.priorityScore) || 0;
          const cases = c.cases || [];
          if (!cases.length) continue;

          // Index the UNION of the stored sig.defendantToken AND the freshly
          // recomputed token. Preferring only the stored token meant alias-map
          // improvements never reached the index until a full re-derivation
          // rewrote every record; readers (case-clients sigMatches) already
          // accept either form, so the index must too. Exact set membership —
          // no substring false-positives.
          const hit = new Set();
          for (const sig of cases) {
            const stored = sig.defendantToken;
            if (stored && tokenSet.has(stored)) hit.add(stored);
            const computed = canonicalToken(sig.defendant || "");
            if (computed && tokenSet.has(computed)) hit.add(computed);
          }
          const shard = shardOf(id);
          for (const tok of hit) {
            const bucket = `${tok}:${shard}`;
            if (!byBucket.has(bucket)) byBucket.set(bucket, []);
            byBucket.get(bucket).push({ score, member: id });
            indexed++;
          }
        }

        // Add this batch's members to the sharded per-defendant indexes. No cap.
        const writes = [];
        for (const [bucket, members] of byBucket) {
          writes.push(kv.zadd(`casepeople:${bucket}`, ...members));
        }
        await Promise.all(writes);
      }

      if (cursor === "0") { completed = true; break; }
    }

    const out = {
      startedAt,
      lastRunAt:   now,
      cursor,
      scanned,
      indexed,
      tokensCount: tokens.length,
      done:        completed,
      completedAt: completed ? Date.now() : (stats.completedAt || null),
    };
    await kv.set("caseindex:stats", out);

    return res.status(200).json({
      status: completed ? "complete" : "in_progress",
      stats:  out,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
