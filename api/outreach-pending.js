// Pending Outreach inbox — surfaces high-confidence (score ≥ 80, qualifies=true)
// client/case matches awaiting human review. Auto-populated by match-batch
// whenever a qualifying match is written.
//
// GET    /api/outreach-pending?limit=100   — list top N by score (default 100)
// DELETE /api/outreach-pending?pair=cId|caseId — dismiss (sticky; won't reappear)

import { kv } from "@vercel/kv";
import { KEYS as TCPA_KEYS } from "../src/lib/tcpaSchema.js";

const PENDING_KEY   = "outreach:pending";
const DISMISSED_KEY = "outreach:dismissed";

async function readJson(key) {
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "DELETE") {
    const pair = req.query?.pair;
    if (!pair) return res.status(400).json({ error: "pair required (clientId|caseId)" });
    await Promise.all([
      kv.zrem(PENDING_KEY, pair).catch(() => {}),
      kv.sadd(DISMISSED_KEY, pair).catch(() => {}),
    ]);
    return res.status(200).json({ dismissed: pair });
  }

  if (req.method !== "GET") return res.status(405).end();

  const limit = Math.min(parseInt(req.query?.limit || "100"), 500);

  // Fetch top members + scores (highest match score first).
  const raw = await kv.zrange(PENDING_KEY, 0, limit - 1, { rev: true, withScores: true }).catch(() => []);

  // @vercel/kv withScores returns alternating [member, score, member, score, ...]
  // OR an array of objects depending on version. Handle both.
  const pairs = [];
  if (raw.length && typeof raw[0] === "object") {
    for (const r of raw) pairs.push({ pair: r.member, score: r.score });
  } else {
    for (let i = 0; i < raw.length; i += 2) pairs.push({ pair: raw[i], score: Number(raw[i + 1]) });
  }

  // Hydrate each pair with client + case data.
  const items = [];
  for (const { pair, score } of pairs) {
    const [clientId, caseId] = pair.split("|");
    if (!clientId || !caseId) continue;
    const [clientRaw, caseRaw] = await Promise.all([
      kv.get(`client:${clientId}`),
      kv.get(TCPA_KEYS.case(caseId)),
    ]);
    if (!clientRaw || !caseRaw) {
      // Stale pair — client or case was deleted. Drop from queue.
      await kv.zrem(PENDING_KEY, pair).catch(() => {});
      continue;
    }
    const client = typeof clientRaw === "string" ? JSON.parse(clientRaw) : clientRaw;
    const c      = typeof caseRaw   === "string" ? JSON.parse(caseRaw)   : caseRaw;
    items.push({
      pair,
      score,
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        state: client.state,
        partnerId: client.partnerId || (client.ingestSource === "credit.com" ? "credit_com" : "manual"),
        sourceFirm: client.sourceFirm,
        phone: client.phone,
        email: client.email,
      },
      case: {
        id: c.id,
        caption: c.caption,
        caseType: c.caseType,
        status: c.status,
        court: c.court?.name || c.court?.district || "",
        defendants: (c.defendants || []).map((d) => d.displayName),
      },
    });
  }

  return res.status(200).json({ total: items.length, items });
}
