// Vercel serverless — outreach campaign CRUD
// GET    /api/campaigns            — list all campaigns (meta only)
// GET    /api/campaigns?id=X       — single campaign with letters
// POST   /api/campaigns            — create campaign { name, leadId, leadTitle, leadSnapshot, letters }
// PATCH  /api/campaigns            — update letter status { campaignId, clientId, letterStatus }
// DELETE /api/campaigns?id=X       — remove campaign

import { kv } from "@vercel/kv";

const CAMPAIGNS_ZSET = "campaigns_by_date";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { id } = req.query;

    if (id) {
      const [rawMeta, rawLetters] = await Promise.all([
        kv.get(`campaign:${id}`),
        kv.get(`campaign:${id}:letters`),
      ]);
      if (!rawMeta) return res.status(404).json({ error: "Campaign not found" });
      const meta    = typeof rawMeta    === "string" ? JSON.parse(rawMeta)    : rawMeta;
      const letters = rawLetters
        ? (typeof rawLetters === "string" ? JSON.parse(rawLetters) : rawLetters)
        : [];
      return res.status(200).json({ ...meta, letters });
    }

    // List all (meta only — no letters)
    const ids = await kv.zrange(CAMPAIGNS_ZSET, 0, -1, { rev: true }).catch(() => []);
    if (!ids.length) return res.status(200).json({ campaigns: [] });
    const raws = await Promise.all(ids.map(id => kv.get(`campaign:${id}`)));
    const campaigns = raws
      .map(r => r ? (typeof r === "string" ? JSON.parse(r) : r) : null)
      .filter(Boolean);
    return res.status(200).json({ campaigns });
  }

  // ── POST — create campaign ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const { name, leadId, leadTitle, leadSnapshot, letters } = req.body || {};
    if (!name || !letters?.length) return res.status(400).json({ error: "name and letters required" });

    const id  = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const meta = {
      id,
      name,
      leadId:     leadId    || null,
      leadTitle:  leadTitle || null,
      leadSnapshot: leadSnapshot || null,
      createdAt:  new Date(now).toISOString(),
      clientCount:   letters.length,
      sentCount:     0,
      respondedCount:0,
      retainedCount: 0,
    };

    const letterRecords = letters.map(l => ({
      ...l,
      status:      l.status || "generated",
      generatedAt: new Date(now).toISOString(),
    }));

    await Promise.all([
      kv.set(`campaign:${id}`,          JSON.stringify(meta),          { ex: 365 * 24 * 3600 }),
      kv.set(`campaign:${id}:letters`,  JSON.stringify(letterRecords), { ex: 365 * 24 * 3600 }),
      kv.zadd(CAMPAIGNS_ZSET, { score: now, member: id }),
    ]);

    return res.status(200).json(meta);
  }

  // ── PATCH — update a single letter's status ────────────────────────────────
  if (req.method === "PATCH") {
    const { campaignId, clientId, letterStatus } = req.body || {};
    if (!campaignId || !clientId || !letterStatus)
      return res.status(400).json({ error: "campaignId, clientId, and letterStatus required" });

    const [rawMeta, rawLetters] = await Promise.all([
      kv.get(`campaign:${campaignId}`),
      kv.get(`campaign:${campaignId}:letters`),
    ]);
    if (!rawMeta) return res.status(404).json({ error: "Campaign not found" });

    const meta    = typeof rawMeta    === "string" ? JSON.parse(rawMeta)    : rawMeta;
    const letters = rawLetters
      ? (typeof rawLetters === "string" ? JSON.parse(rawLetters) : rawLetters)
      : [];

    const updated = letters.map(l =>
      l.clientId === clientId
        ? { ...l, status: letterStatus, updatedAt: new Date().toISOString() }
        : l
    );

    const sentCount      = updated.filter(l => ["sent","responded","retained"].includes(l.status)).length;
    const respondedCount = updated.filter(l => ["responded","retained"].includes(l.status)).length;
    const retainedCount  = updated.filter(l => l.status === "retained").length;
    const updatedMeta    = { ...meta, sentCount, respondedCount, retainedCount };

    await Promise.all([
      kv.set(`campaign:${campaignId}`,         JSON.stringify(updatedMeta), { ex: 365 * 24 * 3600 }),
      kv.set(`campaign:${campaignId}:letters`, JSON.stringify(updated),     { ex: 365 * 24 * 3600 }),
    ]);

    return res.status(200).json({ updated: clientId, letterStatus, sentCount, respondedCount, retainedCount });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    await Promise.all([
      kv.del(`campaign:${id}`),
      kv.del(`campaign:${id}:letters`),
      kv.zrem(CAMPAIGNS_ZSET, id),
    ]);
    return res.status(200).json({ deleted: id });
  }

  return res.status(405).end();
}
