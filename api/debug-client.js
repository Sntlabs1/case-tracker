// GET /api/debug-client?id=xxx
// Returns the raw KV record for a client — used to diagnose what was
// actually saved after ingest.

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== "GET") return res.status(405).end();
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const raw = await kv.get(`client:${id}`);
    if (!raw) return res.status(404).json({ error: "not found", id });
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.status(200).json({
      id: c.id,
      name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
      creditAccounts: c.creditAccounts?.length ?? "missing",
      collectionsHistory: c.collectionsHistory?.length ?? "missing",
      bankruptcies: c.bankruptcies?.length ?? "missing",
      taxLiens: c.taxLiens?.length ?? "missing",
      creditInquiries: c.creditInquiries?.length ?? "missing",
      employmentHistory: c.employmentHistory?.length ?? "missing",
      addressHistory: c.addressHistory?.length ?? "missing",
      creditScore: c.creditScore ?? null,
      ssnLast4: c.ssnLast4 ?? null,
      creditReportPdfUrl: c.creditReportPdfUrl ?? null,
      ingestSource: c.ingestSource,
      lastCreditReportAt: c.lastCreditReportAt,
      // first account sample
      firstAccount: c.creditAccounts?.[0] ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
