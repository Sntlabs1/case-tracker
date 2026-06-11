// GET /api/case-clients?caseType=FDCPA&defendant=midland&limit=50&cursor=0,0,...
// Returns the people matched to a given case (defendant) / case type.
//
// The defendant param is normalized through the SHARED canonical token
// (api/_lib/defendantToken.js) so any spelling resolves to the same
// casepeople:<token> inverted index that build-case-index wrote. Falls back to
// walking the sharded by_score:{0..15} indexes when no per-case index exists.
//
// Pagination: cursor-based. The cursor is N_SHARDS comma-separated per-shard
// rank offsets (how many entries of each shard have been consumed). Each page
// k-way merges the shard heads in score order, so cost is O(limit * shards)
// per page regardless of depth — the COMPLETE claimant population is
// browsable, not just the top of the index.

import { kv } from "@vercel/kv";
import { canonicalToken } from "./_lib/defendantToken.js";

const N_SHARDS = 16;

function shape(c, sigMatches) {
  const cases = c.cases || [];
  return {
    id:          c.id,
    name:        c.name,
    state:       c.state,
    phone:       c.phone ? `***-***-${String(c.phone).replace(/\D/g, "").slice(-4)}` : null,
    email:       c.email || null,
    score:       c.priorityScore,
    actionable:  c.actionable ?? null,
    intakeReady: c.intakeReady,
    cases:       c.matchedCases || [],
    signals:     cases.filter(sigMatches),       // each carries solStatus, statuteRef, lastReported
    solSummary:  c.solSummary || null,
    recovery:    c.recoveryEstimate || {},
  };
}

function parseCursor(raw) {
  if (!raw) return Array(N_SHARDS).fill(0);
  const parts = String(raw).split(",").map(n => parseInt(n, 10));
  if (parts.length !== N_SHARDS || parts.some(n => !Number.isInteger(n) || n < 0)) return null;
  return parts;
}

// True total for a defendant = sum of its sharded per-case indexes.
async function casepeopleTotal(token) {
  const cards = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) => kv.zcard(`casepeople:${token}:${s}`).catch(() => 0))
  );
  return cards.reduce((a, b) => a + b, 0);
}

// Per-shard score-descending candidate heads starting at the cursor offsets.
async function shardHeads(prefix, cursor, per) {
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`${prefix}:${s}`, cursor[s], cursor[s] + per - 1, { rev: true, withScores: true })
        .catch(() => [])
    )
  );
  return slices.map(slice => {
    const arr = [];
    for (let i = 0; i < slice.length; i += 2) arr.push([slice[i], Number(slice[i + 1])]);
    return arr;
  });
}

// Walk candidates in global score order from the cursor positions, optionally
// filter (caseType narrowing), and collect up to `limit` shaped clients.
// Returns the advanced cursor; only candidates actually examined are consumed,
// so the next page resumes exactly where this one stopped.
async function cursorPage(prefix, cursor, limit, sigMatches, filtered) {
  const cur = cursor.slice();
  const found = [];
  let exhausted = false;
  const MAX_WAVES = 6;     // bound per-request work when a filter rejects heavily

  for (let wave = 0; wave < MAX_WAVES && found.length < limit; wave++) {
    const per = limit;
    const heads = await shardHeads(prefix, cur, per);

    // k-way merge of the shard heads into one score-descending candidate list.
    const taken = Array(N_SHARDS).fill(0);
    const order = [];   // [id, shard]
    for (;;) {
      let best = -1, bs = -Infinity;
      for (let s = 0; s < N_SHARDS; s++) {
        const h = heads[s][taken[s]];
        if (h && h[1] > bs) { bs = h[1]; best = s; }
      }
      if (best === -1) break;
      order.push([heads[best][taken[best]][0], best]);
      taken[best]++;
    }
    if (order.length === 0) { exhausted = true; break; }

    // Fetch records in merge order; stop the moment the page fills.
    for (let i = 0; i < order.length && found.length < limit; i += 200) {
      const chunk = order.slice(i, i + 200);
      const raw = await Promise.all(chunk.map(([id]) => kv.get(`client:${id}`)));
      for (let j = 0; j < chunk.length; j++) {
        cur[chunk[j][1]]++;                       // candidate consumed
        const r = raw[j];
        if (r) {
          const c = typeof r === "string" ? JSON.parse(r) : r;
          if (!filtered || (c.cases || []).some(sigMatches)) {
            found.push(shape(c, sigMatches));
          }
        }
        if (found.length >= limit) break;
      }
    }

    // If the page is still short and every shard came back short, we've
    // consumed the whole index.
    if (found.length < limit && heads.every(h => h.length < per)) {
      exhausted = true;
      break;
    }
  }

  return { found, nextCursor: cur, exhausted };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { caseType, defendant, limit: limitParam, cursor: cursorParam } = req.query;
  if (caseType && !/^[A-Za-z0-9_]+$/.test(caseType)) {
    return res.status(400).json({ error: "Invalid caseType" });
  }
  const token = defendant ? canonicalToken(defendant) : null;
  if (!caseType && !token) {
    return res.status(400).json({ error: "Provide caseType and/or defendant" });
  }
  const limit = Math.min(parseInt(limitParam, 10) || 50, 200);
  const cursor = parseCursor(cursorParam);
  if (!cursor) {
    return res.status(400).json({ error: `cursor must be ${N_SHARDS} comma-separated non-negative integers` });
  }

  const sigMatches = s => {
    const typeMatch = !caseType || s.caseType === caseType;
    const defMatch = !token || s.defendantToken === token || canonicalToken(s.defendant) === token;
    return typeMatch && defMatch;
  };

  // Live claim-path for the queried defendant (open settlement window or
  // joinable open litigation) so the client list states what the match is
  // actually worth today. Built by tools/claim-paths-build.py.
  async function claimPathFor(tok) {
    if (!tok) return null;
    try {
      const raw = await kv.get("case:claim_paths");
      if (!raw) return null;
      const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
      const r = doc?.registry?.[tok];
      if (!r) return { status: "unknown" };
      return {
        status:          r.status,
        liveSettlements: (r.liveSettlements || []).slice(0, 4),
        openLitigation:  (r.openClassCandidates || 0) + (r.openDockets || 0) + (r.tcpaOpenDockets || 0),
      };
    } catch {
      return null;
    }
  }

  // Is this token part of the catalog the casepeople index sweep was built
  // from? If yes and its index is empty, there are DEFINITIVELY no eligible
  // people — return 0 instead of falling through to the slow global scan.
  async function tokenInCatalog(tok) {
    try {
      const [evRaw, tcpaRaw, natRaw, pathsRaw] = await Promise.all([
        kv.get("match:defendant_evidence"),
        kv.get("pacer:tcpa_marketers"),
        kv.get("pacer:national_entities"),
        kv.get("case:claim_paths"),
      ]);
      const ev = evRaw ? (typeof evRaw === "string" ? JSON.parse(evRaw) : evRaw) : {};
      for (const name of Object.keys(ev.clusters || {})) {
        if (canonicalToken(name) === tok) return true;
      }
      const tcpa = tcpaRaw ? (typeof tcpaRaw === "string" ? JSON.parse(tcpaRaw) : tcpaRaw) : {};
      for (const d of (tcpa.defendants || [])) {
        if (canonicalToken(d.defendant || d.defendantQ || "") === tok) return true;
      }
      const nat = natRaw ? (typeof natRaw === "string" ? JSON.parse(natRaw) : natRaw) : {};
      for (const d of (nat.entities || [])) {
        if (canonicalToken(d.defendant || d.defendantQ || "") === tok) return true;
      }
      const paths = pathsRaw ? (typeof pathsRaw === "string" ? JSON.parse(pathsRaw) : pathsRaw) : {};
      if ((paths.registry || {})[tok]) return true;
    } catch { /* fall through to scan */ }
    return false;
  }

  try {
    // ── Fast path: complete (sharded) per-case inverted index ───────────
    if (token) {
      const [total, claimPath] = await Promise.all([casepeopleTotal(token), claimPathFor(token)]);
      if (total === 0 && await tokenInCatalog(token)) {
        return res.status(200).json({
          caseType: caseType || null,
          defendant: defendant || null,
          token,
          claimPath,
          source: "index",
          total: 0,
          count: 0,
          clients: [],
          nextCursor: cursor.join(","),
          hasMore: false,
        });
      }
      if (total > 0) {
        // Always filter by sigMatches: the casepeople index is ZADD-only, so a
        // member whose record was re-derived after the last sweep may no longer
        // carry this defendant's signal — without the filter such stale members
        // render as client rows with an empty signals[] array.
        const { found, nextCursor, exhausted } = await cursorPage(
          `casepeople:${token}`, cursor, limit, sigMatches, true
        );
        const consumed = nextCursor.reduce((a, b) => a + b, 0);
        return res.status(200).json({
          caseType: caseType || null,
          defendant: defendant || null,
          token,
          claimPath,
          source: "index",
          total,                       // COMPLETE people count for this defendant
          count: found.length,
          clients: found,
          nextCursor: nextCursor.join(","),
          hasMore: !exhausted && consumed < total,
        });
      }
    }

    // ── Fallback: cursor walk of the sharded by_score indexes ────────────
    const { found, nextCursor, exhausted } = await cursorPage(
      "by_score", cursor, limit, sigMatches, true
    );
    return res.status(200).json({
      caseType: caseType || null,
      defendant: defendant || null,
      token,
      source: "scan",
      total: null,                     // no per-caseType index; total unknown
      count: found.length,
      clients: found,
      nextCursor: nextCursor.join(","),
      hasMore: !exhausted,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
