// GET /api/credit-portfolio
// Returns the credit.com dataset match stats stored by tools/credit-ingest.js.
// Powers the Credit Portfolio tab.

import { kv } from "@vercel/kv";

const N_SHARDS = 16;

// Merge the top of every by_score shard to get the global highest-priority ids.
async function topByScore(n) {
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`by_score:${s}`, 0, n - 1, { rev: true, withScores: true }).catch(() => [])
    )
  );
  const merged = [];
  for (const slice of slices) {
    for (let i = 0; i < slice.length; i += 2) merged.push([slice[i], Number(slice[i + 1])]);
  }
  merged.sort((a, b) => b[1] - a[1]);
  return merged.slice(0, n).map(m => m[0]);
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

    // Top leads by score from the sharded index.
    const topIds = await topByScore(50);
    const topLeads = [];
    for (let i = 0; i < topIds.length; i += 20) {
      const batch = await Promise.all(
        topIds.slice(i, i + 20).map(id => kv.get(`client:${id}`))
      );
      batch.forEach(r => {
        if (!r) return;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        topLeads.push({
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
        });
      });
    }

    return res.status(200).json({
      status:   "ok",
      stats:    parsed,
      topLeads,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
