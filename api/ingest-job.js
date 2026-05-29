// GET /api/ingest-job?id=xxx  — poll ingest job progress
// DELETE /api/ingest-job?id=xxx — cancel / delete job record

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return (await r.json()).result;
}

async function kvDel(key) {
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: "KV env vars not configured" });
  }

  const { id } = req.query || {};
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "DELETE") {
    await kvDel(`ingest:job:${id}`);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET") return res.status(405).end();

  const raw = await kvGet(`ingest:job:${id}`);
  if (!raw) return res.status(404).json({ error: "Job not found or expired" });
  const job = typeof raw === "string" ? JSON.parse(raw) : raw;

  // Compute derived fields for the UI
  const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  return res.status(200).json({ ...job, pct });
}
