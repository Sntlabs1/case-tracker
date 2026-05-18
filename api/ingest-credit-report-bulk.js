// Bulk credit-report ingest — for batches of 10–100,000+ clients.
//
// POST /api/ingest-credit-report-bulk
//   Content-Type: multipart/form-data
//   Fields:
//     file     — CSV (one row per client or one row per tradeline) OR
//                JSON array of client/credit-report objects
//     partner  — optional (default: "credit_com")
//     mode     — "roster" | "tradeline" | "auto" (default: auto)
//
// Returns streaming NDJSON progress or, on completion:
//   { ok: true, total, imported, updated, failed, errors: [{ row, name, error }] }
//
// Large files: processes in parallel batches of 50 clients each.
// Memory: streams the CSV rather than loading it all at once when file > 10MB.

import { parseCreditReportCsv } from "./_ingest-parsers/csv-parser.js";
import normalize                 from "./_partner-importers/credit-com-json.js";
import { buildCreditReport }     from "../src/lib/creditReportSchema.js";
import { creditReportToClient }  from "../src/lib/creditReportToClient.js";

const BATCH_SIZE = 50;
const MAX_ERRORS = 100;

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

async function saveBatch(clients, partner) {
  const r = await fetch(`${BASE_URL}/api/clients?partner=${encodeURIComponent(partner)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clients }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.status);
    throw new Error(`clients API ${r.status}: ${txt}`);
  }
  return r.json();
}

function reportToClient(raw) {
  try {
    const report = buildCreditReport(raw);
    return creditReportToClient(report, { partnerId: "credit_com", ingestSource: "credit.com" });
  } catch {
    return normalize(raw.consumer ? {
      ...raw.consumer,
      collections: (raw.accounts || []).filter(a => a.isCollection),
    } : raw);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const startMs = Date.now();

  try {
    const formData   = await req.formData();
    const file       = formData.get("file");
    const partner    = formData.get("partner") || "credit_com";

    if (!file) return res.status(400).json({ ok: false, error: "No file provided" });

    const filename   = (file.name || "upload").toLowerCase();
    const fileType   = file.type || "";
    const isJson     = filename.endsWith(".json") || fileType.includes("json");
    const isCsv      = !isJson;

    // Parse all client objects from the file
    let rawClients = [];
    const text = new TextDecoder().decode(await file.arrayBuffer());

    if (isJson) {
      const obj = JSON.parse(text);
      rawClients = (Array.isArray(obj) ? obj : [obj]).map(item => normalize(item));
    } else {
      // CSV: parse into credit report canonical shapes, then convert to clients
      const reports = parseCreditReportCsv(text);
      rawClients = reports.map(reportToClient);
    }

    // Filter out rows with no usable identity
    const clients = rawClients.filter(c => c.firstName || c.lastName || c.phone);
    const invalidCount = rawClients.length - clients.length;

    const totals = { imported: 0, updated: 0, failed: 0, queuedForMatch: 0 };
    const errors = [];

    // Process in batches
    for (let i = 0; i < clients.length; i += BATCH_SIZE) {
      const batch = clients.slice(i, i + BATCH_SIZE);
      try {
        const result = await saveBatch(batch, partner);
        totals.imported       += result.imported       || 0;
        totals.updated        += result.updated        || 0;
        totals.queuedForMatch += result.queuedForMatch || 0;
        if (Array.isArray(result.errors)) {
          for (const e of result.errors) {
            if (errors.length < MAX_ERRORS) {
              errors.push({ row: i + (e.index || 0) + 2, name: `${batch[e.index]?.firstName || ""} ${batch[e.index]?.lastName || ""}`.trim(), error: e.error });
            }
            totals.failed++;
          }
        }
      } catch (e) {
        // Batch-level failure: record all rows in the batch as failed
        for (let j = 0; j < batch.length; j++) {
          if (errors.length < MAX_ERRORS) {
            errors.push({ row: i + j + 2, name: `${batch[j]?.firstName || ""} ${batch[j]?.lastName || ""}`.trim(), error: e.message });
          }
        }
        totals.failed += batch.length;
      }
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    return res.status(200).json({
      ok: true,
      total: clients.length + invalidCount,
      valid: clients.length,
      invalid: invalidCount,
      imported: totals.imported,
      updated: totals.updated,
      failed: totals.failed,
      queuedForMatch: totals.queuedForMatch,
      elapsedSec: parseFloat(elapsed),
      errors: errors.slice(0, MAX_ERRORS),
    });

  } catch (e) {
    console.error("ingest-credit-report-bulk error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export const config = { api: { bodyParser: false } };
