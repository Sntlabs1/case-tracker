// GET /api/case-clients?caseType=FDCPA&defendant=midland&limit=50&offset=0
// Returns the people matched to a given case (defendant) / case type.
//
// The defendant param is normalized through the SHARED canonical token
// (api/_lib/defendantToken.js) so any spelling resolves to the same
// casepeople:<token> inverted index that build-case-index wrote. Falls back to
// a bounded merge of the sharded by_score:{0..15} indexes when no per-case
// index exists.

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

// Merge the top of every by_score shard into a single score-ranked id stream.
async function topByScore(maxScan) {
  const per = Math.ceil(maxScan / N_SHARDS);
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`by_score:${s}`, 0, per - 1, { rev: true, withScores: true }).catch(() => [])
    )
  );
  const merged = [];
  for (const slice of slices) {
    for (let i = 0; i < slice.length; i += 2) merged.push([slice[i], Number(slice[i + 1])]);
  }
  merged.sort((a, b) => b[1] - a[1]);
  return merged.map(m => m[0]);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { caseType, defendant, limit: limitParam, offset: offsetParam } = req.query;
  if (caseType && !/^[A-Za-z0-9_]+$/.test(caseType)) {
    return res.status(400).json({ error: "Invalid caseType" });
  }
  const token = defendant ? canonicalToken(defendant) : null;
  if (!caseType && !token) {
    return res.status(400).json({ error: "Provide caseType and/or defendant" });
  }
  const limit = Math.min(parseInt(limitParam, 10) || 50, 200);
  const offset = Math.max(parseInt(offsetParam, 10) || 0, 0);

  const sigMatches = s => {
    const typeMatch = !caseType || s.caseType === caseType;
    const defMatch = !token || s.defendantToken === token || canonicalToken(s.defendant) === token;
    return typeMatch && defMatch;
  };

  try {
    // ── Fast path: complete per-case inverted index ─────────────────────
    if (token) {
      const indexKey = `casepeople:${token}`;
      const total = await kv.zcard(indexKey).catch(() => 0);
      if (total > 0) {
        const found = [];
        const pageSize = 500;
        let scanned = 0;
        for (let pos = offset; pos < total && found.length < limit; pos += pageSize) {
          const ids = await kv.zrange(indexKey, pos, pos + pageSize - 1, { rev: true });
          if (!ids || ids.length === 0) break;
          const raw = await Promise.all(ids.map(id => kv.get(`client:${id}`)));
          for (const r of raw) {
            scanned++;
            if (!r) continue;
            const c = typeof r === "string" ? JSON.parse(r) : r;
            if (caseType && !(c.cases || []).some(sigMatches)) continue;
            found.push(shape(c, sigMatches));
            if (found.length >= limit) break;
          }
        }
        return res.status(200).json({
          caseType: caseType || null,
          defendant: defendant || null,
          token,
          source: "index",
          total,                       // total people indexed for this defendant
          offset,
          count: found.length,
          clients: found,
        });
      }
    }

    // ── Fallback: bounded merge of the sharded by_score indexes ──────────
    const maxScan = 20000;
    const ids = await topByScore(maxScan);
    const found = [];
    const batchSize = 500;
    for (let i = 0; i < ids.length && found.length < limit; i += batchSize) {
      const slice = ids.slice(i, i + batchSize);
      const raw = await Promise.all(slice.map(id => kv.get(`client:${id}`)));
      for (const r of raw) {
        if (!r) continue;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        if ((c.cases || []).some(sigMatches)) {
          found.push(shape(c, sigMatches));
          if (found.length >= limit) break;
        }
      }
    }

    return res.status(200).json({
      caseType: caseType || null,
      defendant: defendant || null,
      token,
      source: "scan",
      count: found.length,
      clients: found,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
