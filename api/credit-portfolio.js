// GET /api/credit-portfolio
// Returns the credit.com dataset match stats stored by tools/credit-ingest.js.
// Powers the Credit Portfolio tab.
//
// Pagination: cursor-based over the 16 sharded by_score zsets. The cursor is a
// comma-separated list of per-shard rank offsets (how many entries of each
// shard have already been consumed). Each page fetches at most `limit` entries
// per shard from its offset, k-way merges them by score, takes the top
// `limit`, and returns the advanced cursor. Cost per page is O(limit * shards)
// regardless of depth, so the entire index is browsable.

import { kv } from "@vercel/kv";

const N_SHARDS = 16;

function parseCursor(raw) {
  if (!raw) return Array(N_SHARDS).fill(0);
  const parts = String(raw).split(",").map(n => parseInt(n, 10));
  if (parts.length !== N_SHARDS || parts.some(n => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  return parts;
}

// One global score-ordered page across all shards starting at `cursor`.
async function pageByScore(cursor, limit) {
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`by_score:${s}`, cursor[s], cursor[s] + limit - 1, { rev: true, withScores: true })
        .catch(() => [])
    )
  );
  // Per-shard candidate heads, already score-descending within each shard.
  const heads = slices.map(slice => {
    const arr = [];
    for (let i = 0; i < slice.length; i += 2) arr.push([slice[i], Number(slice[i + 1])]);
    return arr;
  });
  const taken = Array(N_SHARDS).fill(0);
  const ids = [];
  while (ids.length < limit) {
    let best = -1, bestScore = -Infinity;
    for (let s = 0; s < N_SHARDS; s++) {
      const h = heads[s][taken[s]];
      if (h && h[1] > bestScore) { bestScore = h[1]; best = s; }
    }
    if (best === -1) break; // all shards exhausted
    ids.push(heads[best][taken[best]][0]);
    taken[best]++;
  }
  const nextCursor = cursor.map((c, s) => c + taken[s]);
  return { ids, nextCursor };
}

// Public lead shape for one stored client record.
function toLead(r) {
  const c = typeof r === "string" ? JSON.parse(r) : r;
  return {
    id:             c.id,
    name:           c.name,
    state:          c.state,
    phone:          c.phone ? `***-***-${String(c.phone).replace(/\D/g, "").slice(-4)}` : null,
    email:          c.email || null,
    score:          c.priorityScore,
    actionable:     c.actionable ?? null,
    cases:          c.matchedCases || [],
    signals:        (c.cases || []).map(s => ({
      caseType:   s.caseType,
      defendant:  s.defendant,
      strength:   s.strength,
      solStatus:  s.solStatus,
    })),
    solSummary:     c.solSummary || null,
    recovery:       c.recoveryEstimate || {},
    intakeReady:    c.intakeReady,
  };
}

// Name search: there is no name index in KV, so this is a bounded scan down
// the score-ordered shards. Each request scans at most SEARCH_SCAN_CAP records
// (fetched via MGET in batches) and returns the matches found plus the cursor
// to continue scanning, so the client can "search deeper" on demand. Cost per
// request: ~(cap/chunk)*16 ZRANGEs + cap/100 MGETs.
const SEARCH_CHUNK    = 200;
const SEARCH_SCAN_CAP = 2000;

async function searchByName(q, cursor, limit) {
  let cur = cursor;
  let scanned = 0;
  let exhausted = false;
  const matches = [];
  while (matches.length < limit && scanned < SEARCH_SCAN_CAP) {
    const { ids, nextCursor } = await pageByScore(cur, SEARCH_CHUNK);
    if (ids.length === 0) { exhausted = true; break; }
    cur = nextCursor;
    scanned += ids.length;
    for (let i = 0; i < ids.length; i += 100) {
      const batch = await kv.mget(...ids.slice(i, i + 100).map(id => `client:${id}`));
      for (const r of batch) {
        if (!r) continue;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        if ((c.name || "").toLowerCase().includes(q)) matches.push(toLead(c));
      }
    }
    if (ids.length < SEARCH_CHUNK) { exhausted = true; break; }
  }
  return { matches, scanned, nextCursor: cur, exhausted };
}

// Total people in the score index across all shards.
async function indexTotal() {
  const counts = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) => kv.zcard(`by_score:${s}`).catch(() => 0))
  );
  return counts.reduce((a, b) => a + (b || 0), 0);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const stats = await kv.get("credit_portfolio:stats");
    if (!stats) {
      return res.status(200).json({
        status: "not_ingested",
        message: "No credit.com data ingested yet. Run: python3 tools/credit-rederive.py lex",
      });
    }

    const parsed = typeof stats === "string" ? JSON.parse(stats) : stats;

    const limit  = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
    const cursor = parseCursor(req.query?.cursor);
    if (!cursor) {
      return res.status(400).json({ error: `cursor must be ${N_SHARDS} comma-separated non-negative integers` });
    }

    const q = String(req.query?.q || "").trim().toLowerCase();
    if (q) {
      const [{ matches, scanned, nextCursor, exhausted }, leadsTotal] = await Promise.all([
        searchByName(q, cursor, limit),
        indexTotal(),
      ]);
      return res.status(200).json({
        status:     "ok",
        q,
        topLeads:   matches,
        scanned,
        leadsTotal,
        nextCursor: nextCursor.join(","),
        hasMore:    !exhausted,
      });
    }

    const [{ ids: topIds, nextCursor }, leadsTotal] = await Promise.all([
      pageByScore(cursor, limit),
      indexTotal(),
    ]);

    const topLeads = [];
    for (let i = 0; i < topIds.length; i += 20) {
      const batch = await Promise.all(
        topIds.slice(i, i + 20).map(id => kv.get(`client:${id}`))
      );
      batch.forEach(r => { if (r) topLeads.push(toLead(r)); });
    }

    const consumed = nextCursor.reduce((a, b) => a + b, 0);

    return res.status(200).json({
      status:     "ok",
      stats:      parsed,
      topLeads,
      limit,
      leadsTotal,
      nextCursor: nextCursor.join(","),
      hasMore:    consumed < leadsTotal,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
