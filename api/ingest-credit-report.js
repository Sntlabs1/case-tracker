// Single credit-report ingest endpoint.
//
// POST /api/ingest-credit-report
//   Content-Type: application/json
//   Body: {
//     file:        base64-encoded string of the file
//     filename:    "report.pdf" | "data.json" | "clients.csv"
//     contentType: "application/pdf" | "application/json" | "text/csv"
//     partner:     "credit_com" (optional)
//   }
//   OR:
//   Body: { clients: [...] }   — pre-parsed client objects (API-to-API)
//
// Returns:
//   { ok: true, imported, updated, accountsExtracted, matchQueued }
//   or { ok: false, error }
//
// NOTE: We use raw body collection (getRawBody) instead of req.json() or
// req.formData() — both are Edge Runtime APIs not available in the Vercel
// Node.js serverless runtime.

import { parseCreditReportPdfBase64 }  from "./_ingest-parsers/pdf-parser.js";
import { parseCreditReportCsv }         from "./_ingest-parsers/csv-parser.js";
import normalize                         from "./_partner-importers/credit-com-json.js";
import { buildCreditReport }             from "../src/lib/creditReportSchema.js";
import { creditReportToClient }          from "../src/lib/creditReportToClient.js";
import { kv }                            from "@vercel/kv";
import { put }                           from "@vercel/blob";
import { createHash }                    from "node:crypto";
import {
  normalize as normalizeDefendant,
  createDefendant,
} from "../src/lib/defendantResolver.js";

// ── Raw body helper (works in Node.js serverless) ─────────────────────────────

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── KV helpers (direct — no internal HTTP hop) ────────────────────────────────

const CLIENTS_ZSET   = "clients_by_date";
const CLIENTS_CACHE  = "clients_cache_v1";
const PENDING_MATCH  = "tcpa:clients_pending_match";
const CLIENT_TTL     = 365 * 24 * 3600;

function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

function normPhone(raw) {
  if (!raw) return "";
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

function buildRecord(c, now, idx) {
  const phones = (Array.isArray(c.phoneNumbers) && c.phoneNumbers.length
    ? c.phoneNumbers : (c.phone ? [c.phone] : []))
    .map(normPhone).filter(Boolean);
  const primaryPhone = phones[0] || "";
  const email = String(c.email || "").trim().toLowerCase();
  const id = c.id || `c_${now}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    firstName: c.firstName || "",
    lastName:  c.lastName  || "",
    email,
    phone:     primaryPhone,
    phoneNumbers: phones,
    state: (c.state || "").toUpperCase().slice(0, 2),
    city:  c.city  || "",
    dob:   c.dob   || null,
    ssnLast4: c.ssnLast4 || null,
    creditScore: c.creditScore || null,
    sourceFirm:  c.sourceFirm || "Credit.com",
    ingestSource: c.ingestSource || "credit.com",
    partnerId: c.partnerId || "credit_com",
    contactRights: c.contactRights || { creditor: true, source: "credit.com partnership" },
    tcpaOptOut: c.tcpaOptOut === true,
    importedAt: new Date(now).toISOString(),
    phoneHash: primaryPhone ? sha256(primaryPhone) : "",
    emailHash: email        ? sha256(email)        : "",
    collectionsHistory: Array.isArray(c.collectionsHistory) ? c.collectionsHistory : [],
    addressHistory:     Array.isArray(c.addressHistory)     ? c.addressHistory     : [],
    creditAccounts:     Array.isArray(c.creditAccounts)     ? c.creditAccounts     : [],
    bankruptcies:       Array.isArray(c.bankruptcies)       ? c.bankruptcies       : [],
    civilJudgments:     Array.isArray(c.civilJudgments)     ? c.civilJudgments     : [],
    taxLiens:           Array.isArray(c.taxLiens)           ? c.taxLiens           : [],
    creditInquiries:    Array.isArray(c.creditInquiries)    ? c.creditInquiries    : [],
    creditReportAlerts: Array.isArray(c.creditReportAlerts) ? c.creditReportAlerts : [],
    employmentHistory:  Array.isArray(c.employmentHistory)  ? c.employmentHistory  : [],
    creditReportSummary: c.creditReportSummary || null,
    lastCreditReportAt:  c.lastCreditReportAt  || new Date(now).toISOString(),
    creditReportPdfUrl:  c.creditReportPdfUrl  || null,
    existingCases: c.existingCases || "",
    matchedLeads: [],
  };
}

async function persistClients(records) {
  const now = Date.now();
  let imported = 0, updated = 0;
  const matchIds = [], importedIds = [], updatedIds = [];

  for (let i = 0; i < records.length; i++) {
    const fresh = buildRecord(records[i], now, i);

    // Dedup: prefer phone > email > name+dob fingerprint.
    // Never skip a record just because it lacks phone/email — credit reports
    // often have neither and that was silently dropping every PDF client.
    let existingId = null;
    for (const hash of [fresh.phoneHash, fresh.emailHash]) {
      if (!hash) continue;
      const field = fresh.phoneHash === hash ? "client_by_phonehash" : "client_by_emailhash";
      const id = await kv.get(`${field}:${hash}`).catch(() => null);
      if (id) { existingId = id; break; }
    }
    // Name+DOB fingerprint fallback — prevents duplicates when phone is absent
    if (!existingId && fresh.firstName && fresh.lastName && fresh.dob) {
      const nameKey = sha256(`${fresh.firstName.toLowerCase()}|${fresh.lastName.toLowerCase()}|${fresh.dob}`);
      const id = await kv.get(`client_by_namekey:${nameKey}`).catch(() => null);
      if (id) existingId = id;
      fresh._nameKey = nameKey; // carry forward so we can write the index
    }

    const id = existingId || fresh.id;
    const score = now + i;

    const ops = [
      kv.set(`client:${id}`, JSON.stringify({ ...fresh, id }), { ex: CLIENT_TTL }),
      kv.zadd(CLIENTS_ZSET, { score, member: id }),
      kv.zadd(`clients_by_partner:${fresh.partnerId}`, { score, member: id }),
    ];
    if (fresh.phoneHash) ops.push(kv.set(`client_by_phonehash:${fresh.phoneHash}`, id, { ex: CLIENT_TTL }));
    if (fresh.emailHash) ops.push(kv.set(`client_by_emailhash:${fresh.emailHash}`, id, { ex: CLIENT_TTL }));
    if (fresh._nameKey)  ops.push(kv.set(`client_by_namekey:${fresh._nameKey}`,    id, { ex: CLIENT_TTL }));
    ops.push(kv.zadd(PENDING_MATCH, { score, member: id }).catch(() => {}));
    await Promise.all(ops);

    if (existingId) { updated++; updatedIds.push(id); } else { imported++; importedIds.push(id); }
    matchIds.push(id);
  }

  // Bust the list cache
  await kv.del(CLIENTS_CACHE).catch(() => {});
  return { imported, updated, matchQueued: matchIds.length, ids: importedIds, updatedIds };
}

// ── Bulk defendant resolution ─────────────────────────────────────────────────

async function resolveDefendants(records) {
  const uniqueNames = new Map();
  for (const r of records) {
    for (const arr of [r.collectionsHistory || [], r.creditAccounts || []]) {
      for (const e of arr) {
        for (const name of [e.creditor, e.debtBuyer, e.originalCreditor].filter(Boolean)) {
          const norm = normalizeDefendant(name);
          if (norm && !uniqueNames.has(norm)) uniqueNames.set(norm, name);
        }
      }
    }
  }
  const cache = new Map();
  for (const [norm, display] of uniqueNames) {
    const id = await kv.get(`tcpa:defendant_alias:${norm}`).catch(() => null);
    if (id) { cache.set(norm, id); continue; }
    try {
      const created = await createDefendant({ displayName: display });
      cache.set(norm, created.canonicalId);
    } catch { /* skip */ }
  }
  // Back-fill
  for (const r of records) {
    for (const arr of [r.collectionsHistory || [], r.creditAccounts || []]) {
      for (const e of arr) {
        if (e.creditor && !e.creditorCanonicalId) {
          const n = normalizeDefendant(e.creditor);
          if (cache.has(n)) e.creditorCanonicalId = cache.get(n);
        }
      }
    }
  }
}

// ── File parsing ──────────────────────────────────────────────────────────────

async function parseFile(base64, filename, contentType) {
  const ext = (filename || "").toLowerCase().split(".").pop();

  if (ext === "pdf" || (contentType || "").includes("pdf")) {
    const parsed = await parseCreditReportPdfBase64(base64, filename);
    const report = buildCreditReport(parsed);
    return [creditReportToClient(report, { partnerId: "credit_com", ingestSource: "credit.com" })];
  }

  const text = Buffer.from(base64, "base64").toString("utf8");

  if (ext === "json" || (contentType || "").includes("json")) {
    const obj = JSON.parse(text);
    return (Array.isArray(obj) ? obj : [obj]).map(item => normalize(item));
  }

  // CSV / TSV / plain text
  const reports = parseCreditReportCsv(text);
  return reports.map(r => {
    try {
      const report = buildCreditReport(r);
      return creditReportToClient(report, { partnerId: "credit_com", ingestSource: "credit.com" });
    } catch {
      return normalize(r.consumer ? { ...r.consumer, collections: (r.accounts || []).filter(a => a.isCollection) } : r);
    }
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Partner");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const rawBody = await getRawBody(req);
    const body = JSON.parse(rawBody.toString("utf8"));

    let clients = [];

    if (body.file) {
      // base64 file upload (single report)
      clients = await parseFile(body.file, body.filename || "upload", body.contentType || "");

      // Upload the original PDF to Blob storage so it can be shown in the client card.
      // Fire-and-forget with graceful fallback — ingest still succeeds without Blob.
      const isPdf = (body.filename || "").toLowerCase().endsWith(".pdf") ||
                    (body.contentType || "").includes("pdf");
      if (isPdf && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const pdfBuf = Buffer.from(body.file, "base64");
          const slug = `credit-reports/${Date.now()}-${(body.filename || "report.pdf").replace(/[^a-z0-9.\-_]/gi, "_")}`;
          const blob = await put(slug, pdfBuf, { access: "public", contentType: "application/pdf" });
          // Attach the URL to each parsed client so buildRecord persists it
          clients.forEach(c => { if (c) c.creditReportPdfUrl = blob.url; });
        } catch (e) {
          console.warn("Blob upload skipped:", e.message);
        }
      }
    } else if (Array.isArray(body.clients)) {
      clients = body.clients.map(item => normalize(item));
    } else if (body.firstName || body.consumer) {
      clients = [normalize(body)];
    } else {
      return res.status(400).json({ ok: false, error: "Provide { file, filename, contentType } or { clients: [...] }" });
    }

    // Accept any client with at least a name, phone, email, OR credit accounts.
    // Credit reports are valid even if contact fields are sparse.
    const validClients = clients.filter(c => c && (
      c.firstName || c.lastName || c.phone || c.email ||
      (Array.isArray(c.creditAccounts) && c.creditAccounts.length > 0) ||
      (Array.isArray(c.collectionsHistory) && c.collectionsHistory.length > 0)
    ));
    if (!validClients.length) {
      return res.status(400).json({ ok: false, error: "No client records could be extracted from the file" });
    }

    await resolveDefendants(validClients);
    const result = await persistClients(validClients);

    if (!result.ids?.length && !result.updatedIds?.length) {
      return res.status(500).json({ ok: false, error: "Client record could not be saved. The report may lack a phone number and email — add at least one contact field and re-upload." });
    }

    const c = validClients[0];

    // Build a human-readable extraction summary to show in the UI immediately
    const allAccounts = [...(c.creditAccounts || []), ...(c.collectionsHistory || [])];
    const creditorNames = [...new Set(
      allAccounts.map(a => a.creditor || a.originalCreditor || a.debtBuyer).filter(Boolean)
    )];
    const collectionAccounts = allAccounts.filter(a => a.isCollection || a.type === "collection");
    const lateAccounts = (c.creditAccounts || []).filter(a =>
      (a.latePayments?.d30 || 0) + (a.latePayments?.d60 || 0) + (a.latePayments?.d90 || 0) > 0
    );

    // Matching runs via the hourly cron — don't block the response on it.
    // Clients are already queued in PENDING_MATCH by persistClients().

    return res.status(200).json({
      ok: true,
      imported:     result.imported,
      updated:      result.updated,
      count:        validClients.length,
      matchQueued:  result.matchQueued,
      // Extraction summary
      client: {
        id:        result.ids?.[0] || result.updatedIds?.[0],
        name:      `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        dob:       c.dob || null,
        state:     c.state || null,
        phones:    (c.phoneNumbers || []).slice(0, 3),
        creditScore: c.creditScore || null,
        ssnLast4:  c.ssnLast4 || null,
      },
      extraction: {
        totalAccounts:    allAccounts.length,
        creditAccounts:   (c.creditAccounts || []).length,
        collections:      collectionAccounts.length,
        lateAccounts:     lateAccounts.length,
        bankruptcies:     (c.bankruptcies || []).length,
        taxLiens:         (c.taxLiens || []).length,
        civilJudgments:   (c.civilJudgments || []).length,
        inquiries:        (c.creditInquiries || []).length,
        creditors:        creditorNames.slice(0, 20),
        employmentHistory: (c.employmentHistory || []).map(e => e.employer).filter(Boolean).slice(0, 5),
        addressHistory:   (c.addressHistory || []).map(a => `${a.city || ""} ${a.state || ""}`.trim()).filter(Boolean).slice(0, 5),
      },
      matches: [],  // populated by cron match agent within the hour
    });

  } catch (e) {
    console.error("ingest-credit-report:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// bodyParser must be disabled so we can collect the raw body stream
export const config = { api: { bodyParser: false } };
