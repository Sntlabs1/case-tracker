// Vercel serverless function — HTTP endpoint for frontend lead management
// GET  /api/leads?minScore=50&classification=CREATE&category=Federal&limit=50
// GET  /api/leads?stats=1   — return aggregate stats
// DELETE /api/leads?id=xyz  — dismiss a lead

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ─── DELETE — dismiss a lead ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    await kv.del(`lead:${id}`);
    await kv.zrem("leads_by_score", id);
    return res.status(200).json({ dismissed: id });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ─── GET stats ─────────────────────────────────────────────────────────────
  if (req.query.stats === "1") {
    const lastScan = await kv.get("last_scan");
    const totalInSet = await kv.zcard("leads_by_score");

    // Count by score band
    const high = await kv.zcount("leads_by_score", 75, 100);
    const mid = await kv.zcount("leads_by_score", 50, 74);
    const low = await kv.zcount("leads_by_score", 0, 49);

    return res.status(200).json({
      lastScan: lastScan ? JSON.parse(lastScan) : null,
      total: totalInSet,
      highPriority: high,
      investigate: mid,
      pass: low,
    });
  }

  // ─── GET leads ─────────────────────────────────────────────────────────────
  const {
    minScore = "0",
    maxScore = "100",
    classification,
    joinOrCreate,
    category,
    caseType,
    limit = "100",
  } = req.query;

  const min = parseInt(minScore);
  const max = parseInt(maxScore);
  const lim = Math.min(parseInt(limit), 200);

  // Fetch lead IDs from sorted set (highest score first)
  const ids = await kv.zrange("leads_by_score", max, min, {
    byScore: true,
    rev: true,
    limit: { count: lim * 3, offset: 0 }, // overfetch to allow filtering
  });

  if (!ids || ids.length === 0) {
    return res.status(200).json({ leads: [], total: 0 });
  }

  // Fetch lead objects from KV
  const pipeline = kv.pipeline();
  for (const id of ids) pipeline.get(`lead:${id}`);
  const raw = await pipeline.exec();

  const leads = raw
    .map(r => {
      if (!r) return null;
      try { return typeof r === "string" ? JSON.parse(r) : r; }
      catch { return null; }
    })
    .filter(Boolean)
    .filter(lead => {
      if (classification && lead.analysis?.classification !== classification) return false;
      if (joinOrCreate && lead.analysis?.joinOrCreate !== joinOrCreate) return false;
      if (category && lead.category !== category) return false;
      if (caseType && lead.analysis?.caseType !== caseType) return false;
      return true;
    })
    .slice(0, lim);

  return res.status(200).json({ leads, total: leads.length });
}
