import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > 64) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const [raw, crRaw] = await Promise.all([
      kv.get(`client:${id}`),
      kv.get(`credit_report:${id}`),
    ]);
    if (raw === null || raw === undefined) {
      return res.status(404).json({ error: "Client not found" });
    }
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    const creditReport = crRaw ? (typeof crRaw === "string" ? JSON.parse(crRaw) : crRaw) : null;
    const normalized = {
      ...c,
      score:        c.priorityScore  ?? c.score,
      cases:        c.cases          || c.caseSignals || [],
      intakeReady:  c.intakeReady,
      creditReport,
    };
    return res.status(200).json(normalized);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
