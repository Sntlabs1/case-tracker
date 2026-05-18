// Single credit-report ingest endpoint.
//
// POST /api/ingest-credit-report
//   Content-Type: multipart/form-data
//   Fields:
//     file      — required — PDF, JSON, or CSV
//     partner   — optional — partner id (default: "credit_com")
//     sourceNote — optional — free-text note stored on the client record
//
// Returns:
//   { ok: true, clientId, name, accountsExtracted, matchQueued }
//   or { ok: false, error }

import { parseCreditReportPdfBlob } from "./_ingest-parsers/pdf-parser.js";
import { parseCreditReportCsv }      from "./_ingest-parsers/csv-parser.js";
import normalize                      from "./_partner-importers/credit-com-json.js";
import { buildCreditReport }          from "../src/lib/creditReportSchema.js";
import { creditReportToClient }       from "../src/lib/creditReportToClient.js";

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(method, ...args) {
  const r = await fetch(`${KV_URL}/${method}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const d = await r.json();
  return d.result;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return (await r.json()).result;
}

function clientKey() {
  return `c_${Date.now()}_0_${Math.random().toString(36).slice(2, 7)}`;
}

async function saveClient(clientData, partner) {
  const r = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/clients?partner=${encodeURIComponent(partner || "credit_com")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clients: [clientData] }),
  });
  if (!r.ok) throw new Error(`clients API ${r.status}`);
  const d = await r.json();
  return d;
}

async function parseFile(file, filename, contentType) {
  const ext = (filename || "").toLowerCase().split(".").pop();

  if (ext === "pdf" || contentType?.includes("pdf")) {
    const parsed = await parseCreditReportPdfBlob(file, filename);
    // parsed is already buildCreditReport() input shape
    const report = buildCreditReport(parsed);
    return [creditReportToClient(report, { partnerId: "credit_com", ingestSource: "credit.com" })];
  }

  if (ext === "json" || contentType?.includes("json")) {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    const obj = JSON.parse(text);
    // Support both single object and array
    const items = Array.isArray(obj) ? obj : [obj];
    return items.map(item => normalize(item));
  }

  if (ext === "csv" || ext === "tsv" || ext === "txt" || contentType?.includes("csv") || contentType?.includes("text")) {
    const text = new TextDecoder().decode(await file.arrayBuffer());
    const reports = parseCreditReportCsv(text);
    return reports.map(r => {
      try {
        const report = buildCreditReport(r);
        return creditReportToClient(report, { partnerId: "credit_com", ingestSource: "credit.com" });
      } catch {
        // Minimal fallback — still save basic identity
        return normalize(r.consumer ? {
          ...r.consumer,
          collections: r.accounts?.filter(a => a.isCollection) || [],
        } : r);
      }
    });
  }

  throw new Error(`Unsupported file type: ${ext || contentType}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const contentType = req.headers["content-type"] || "";

    let clients = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file     = formData.get("file");
      const partner  = formData.get("partner") || "credit_com";

      if (!file) return res.status(400).json({ ok: false, error: "No file provided" });

      const filename = file.name || "upload";
      const fileType = file.type || "";

      clients = await parseFile(file, filename, fileType);
    } else if (contentType.includes("application/json")) {
      // Direct JSON body (API-to-API use)
      const body = await req.json();
      const items = Array.isArray(body) ? body : [body];
      clients = items.map(item => normalize(item));
    } else {
      return res.status(400).json({ ok: false, error: "Send multipart/form-data with a file, or application/json" });
    }

    if (!clients.length) {
      return res.status(400).json({ ok: false, error: "No client records could be extracted" });
    }

    // Save via the main clients API to get dedup, hashing, and match queueing.
    const partner = req.headers["x-partner"] || "credit_com";
    const saveResult = await saveClient(clients.length === 1 ? clients[0] : null, partner);

    if (clients.length === 1) {
      const c = clients[0];
      return res.status(200).json({
        ok: true,
        clientId: saveResult.clientId || saveResult.ids?.[0],
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        accountsExtracted: (c.creditAccounts || c.collectionsHistory || []).length,
        matchQueued: saveResult.queuedForMatch || 0,
      });
    }

    // Multi-record CSV/JSON — batch save
    const batchResult = await fetch(
      `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/clients?partner=${encodeURIComponent(partner)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients }),
      }
    ).then(r => r.json());

    return res.status(200).json({
      ok: true,
      count: clients.length,
      imported: batchResult.imported || 0,
      updated: batchResult.updated || 0,
      matchQueued: batchResult.queuedForMatch || 0,
    });

  } catch (e) {
    console.error("ingest-credit-report error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export const config = { api: { bodyParser: false } };
