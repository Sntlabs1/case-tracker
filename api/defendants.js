// Defendant / creditor catalog.
//
// GET /api/defendants                          list defendants (limit 500), sorted by case count desc
//   ?q=<term>                                  filter by displayName/alias substring
//   ?min=<n>                                   exclude defendants with fewer than n cases
//   ?limit=<n>                                 max records (default 500, max 2000)
// GET /api/defendants?id=<canonicalId>         single defendant + linked cases + linked clients
//
// Data sources:
//   tcpa:defendants_index                      sorted set of canonicalIds
//   tcpa:defendant:${id}                       full record (displayName, aliases, parent, ...)
//   tcpa:cases_by_defendant:${id}              sorted set of caseIds linked to this defendant
//   clients_by_date                            iterated to find clients whose collectionsHistory
//                                              names this defendant (canonicalId or substring)
//
// Case count is computed via kv.zcard() per defendant (cheap), parallelized in
// batches of 100. The full catalog is cached for 5 min.

import { kv } from "@vercel/kv";
import { KEYS as TCPA_KEYS } from "../src/lib/ingest/tcpaSchema.js";
import { normalize as normalizeDefendant } from "../src/lib/ingest/defendantResolver.js";
import { canonicalToken } from "./_lib/defendantToken.js";

const CACHE_KEY = "tcpa:defendants_catalog_v1";
const CACHE_TTL = 300; // 5 min

// Credit dataset per-defendant inverted index (written by build-case-index): the
// people matched to a defendant token, sharded across casepeople:${token}:{0..15}
// and score-ordered. Same structure consumed by api/case-clients.js. Used to
// surface linked clients from the 10.2M credit.com population when the legacy
// roster (clients_by_date) is empty.
const N_SHARDS = 16;

async function casepeopleTotal(token) {
  const cards = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) => kv.zcard(`casepeople:${token}:${s}`).catch(() => 0))
  );
  return cards.reduce((a, b) => a + (b || 0), 0);
}

// Top-N people for a defendant token in global score order across all shards.
async function linkedClientsFromCredit(token, limit) {
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`casepeople:${token}:${s}`, 0, limit - 1, { rev: true, withScores: true }).catch(() => [])
    )
  );
  const heads = slices.map((slice) => {
    const arr = [];
    for (let i = 0; i < slice.length; i += 2) arr.push([slice[i], Number(slice[i + 1])]);
    return arr;
  });
  // k-way merge the shard heads into one score-descending id list.
  const taken = Array(N_SHARDS).fill(0);
  const ids = [];
  while (ids.length < limit) {
    let best = -1, bs = -Infinity;
    for (let s = 0; s < N_SHARDS; s++) {
      const h = heads[s][taken[s]];
      if (h && h[1] > bs) { bs = h[1]; best = s; }
    }
    if (best === -1) break;
    ids.push(heads[best][taken[best]][0]);
    taken[best]++;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await Promise.all(ids.slice(i, i + 100).map((id) => kv.get(`client:${id}`)));
    for (const r of batch) {
      if (!r) continue;
      const c = typeof r === "string" ? JSON.parse(r) : r;
      const name = c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim();
      out.push({
        id:    c.id,
        name,
        state: c.state,
        phone: c.phone ? `***-***-${String(c.phone).replace(/\D/g, "").slice(-4)}` : null,
        email: c.email || null,
        collectionsCount: (c.collectionsHistory || c.cases || []).length,
      });
    }
  }
  return out;
}

async function loadDefendant(id) {
  const raw = await kv.get(`tcpa:defendant:${id}`).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function caseCountFor(id) {
  return (await kv.zcard(TCPA_KEYS.byDefendant(id)).catch(() => 0)) || 0;
}

async function listAllIds() {
  return (await kv.zrange("tcpa:defendants_index", 0, -1).catch(() => [])) || [];
}

async function buildCatalog({ limit = 500 } = {}) {
  const ids = await listAllIds();
  if (!ids.length) return [];
  const BATCH = 100;
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const [records, counts] = await Promise.all([
      Promise.all(slice.map(loadDefendant)),
      Promise.all(slice.map(caseCountFor)),
    ]);
    records.forEach((r, j) => {
      if (!r || r.mergedInto) return; // skip merge tombstones
      out.push({
        canonicalId:   r.canonicalId,
        displayName:   r.displayName,
        aliasCount:    (r.aliases || []).length,
        aliases:       r.aliases || [],
        parent:        r.parent || null,
        subsidiaries:  r.subsidiaries || [],
        industry:      r.industry || null,
        hqState:       r.hqState || null,
        caseCount:     counts[j],
      });
    });
  }
  out.sort((a, b) => b.caseCount - a.caseCount);
  return out.slice(0, limit);
}

async function getCachedCatalog(limit) {
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      const arr = typeof cached === "string" ? JSON.parse(cached) : cached;
      if (Array.isArray(arr)) return arr.slice(0, limit);
    }
  } catch {}
  const built = await buildCatalog({ limit: Math.max(2000, limit) });
  await kv.set(CACHE_KEY, JSON.stringify(built), { ex: CACHE_TTL }).catch(() => {});
  return built.slice(0, limit);
}

// ── Detail: defendant + linked cases + linked clients ────────────────────────
async function loadDefendantDetail(canonicalId, { caseLimit = 100, clientLimit = 100 } = {}) {
  const def = await loadDefendant(canonicalId);
  if (!def) return null;

  // Cases linked via the inverted index
  const caseIds = (await kv.zrange(TCPA_KEYS.byDefendant(canonicalId), 0, caseLimit - 1, { rev: true })) || [];
  const caseBatch = await Promise.all(caseIds.map((id) => kv.get(TCPA_KEYS.case(id))));
  const cases = caseBatch
    .map((r) => (r ? (typeof r === "string" ? JSON.parse(r) : r) : null))
    .filter(Boolean)
    .map((c) => ({
      id: c.id,
      caption: c.caption,
      caseType: c.caseType,
      filingDate: c.filingDate,
      status: c.status,
      court: c.court?.name,
      state: c.court?.state,
      claimWindowCloses: c.settlement?.claimWindowCloses,
      settlementFund: c.settlement?.totalFund,
    }));

  // Clients linked to this defendant. Primary source is the credit.com dataset:
  // the casepeople:${token} inverted index holds every person in the 10.2M
  // population matched to this defendant, score-ordered. When that index is
  // empty (no credit data for this defendant), fall back to scanning the legacy
  // roster (clients_by_date) and matching on collectionsHistory creditor names.
  let linkedClients = [];
  const token = canonicalToken(def.displayName);
  const creditTotal = token ? await casepeopleTotal(token) : 0;

  if (creditTotal > 0) {
    linkedClients = await linkedClientsFromCredit(token, clientLimit);
  } else {
    const normDef = normalizeDefendant(def.displayName);
    const aliasNorms = new Set([normDef, ...(def.aliases || []).map(normalizeDefendant)].filter(Boolean));
    const clientIds = (await kv.zrange("clients_by_date", 0, -1, { rev: true })) || [];
    const BATCH = 200;
    for (let i = 0; i < clientIds.length && linkedClients.length < clientLimit; i += BATCH) {
      const slice = clientIds.slice(i, i + BATCH);
      const records = await Promise.all(slice.map((id) => kv.get(`client:${id}`)));
      for (const r of records) {
        if (!r) continue;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        const hist = c.collectionsHistory || [];
        let hit = false;
        for (const e of hist) {
          if (e.creditorCanonicalId === canonicalId || e.debtBuyerCanonicalId === canonicalId) {
            hit = true; break;
          }
          const n1 = normalizeDefendant(e.creditor || "");
          const n2 = normalizeDefendant(e.debtBuyer || "");
          if (n1 && aliasNorms.has(n1)) { hit = true; break; }
          if (n2 && aliasNorms.has(n2)) { hit = true; break; }
        }
        if (hit) {
          linkedClients.push({
            id: c.id,
            name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
            state: c.state,
            phone: c.phone,
            email: c.email,
            collectionsCount: (c.collectionsHistory || []).length,
          });
          if (linkedClients.length >= clientLimit) break;
        }
      }
    }
  }
  const linkedClientTotal = creditTotal > 0 ? creditTotal : linkedClients.length;

  return {
    defendant: {
      canonicalId: def.canonicalId,
      displayName: def.displayName,
      aliases:     def.aliases || [],
      parent:      def.parent || null,
      subsidiaries: def.subsidiaries || [],
      industry:    def.industry || null,
      hqState:     def.hqState || null,
    },
    cases,
    caseTotal: caseIds.length,
    linkedClients,
    linkedClientTotal,
    linkedClientCapped: linkedClientTotal > linkedClients.length,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { id, q, min, limit = "500" } = req.query || {};

  // ── Single defendant detail ──────────────────────────────────────────────
  if (id) {
    const detail = await loadDefendantDetail(id);
    if (!detail) return res.status(404).json({ error: "defendant not found" });
    return res.status(200).json(detail);
  }

  // ── Catalog list ─────────────────────────────────────────────────────────
  const lim = Math.min(parseInt(limit) || 500, 2000);
  const minCount = parseInt(min) || 0;
  let catalog = await getCachedCatalog(lim);

  if (q) {
    const needle = String(q).toLowerCase();
    catalog = catalog.filter((d) =>
      (d.displayName || "").toLowerCase().includes(needle) ||
      (d.aliases || []).some((a) => (a || "").toLowerCase().includes(needle))
    );
  }
  if (minCount > 0) {
    catalog = catalog.filter((d) => d.caseCount >= minCount);
  }

  return res.status(200).json({
    defendants: catalog,
    total: catalog.length,
  });
}
