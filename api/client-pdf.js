// GET /api/client-pdf?clientId=xxx
// Serves the raw PDF stored in KV (fallback when Vercel Blob is unavailable).
// When Blob is configured, the creditReportPdfUrl on the client record points
// directly to the Blob CDN URL instead and this endpoint is not used.

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  try {
    const b64 = await kv.get(`client_pdf:${clientId}`);
    if (!b64) return res.status(404).json({ error: "PDF not found for this client" });

    const buf = Buffer.from(String(b64), "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="credit-report-${clientId}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
