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
    if (!fresh.phoneHash && !fresh.emailHash) continue;

    // Dedup check
    let existingId = null;
    for (const hash of [fresh.phoneHash, fresh.emailHash]) {
      if (!hash) continue;
      const field = fresh.phoneHash === hash ? "client_by_phonehash" : "client_by_emailhash";
      const id = await kv.get(`${field}:${hash}`).catch(() => null);
      if (id) { existingId = id; break; }
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
    } else if (Array.isArray(body.clients)) {
      clients = body.clients.map(item => normalize(item));
    } else if (body.firstName || body.consumer) {
      clients = [normalize(body)];
    } else {
      return res.status(400).json({ ok: false, error: "Provide { file, filename, contentType } or { clients: [...] }" });
    }

    const validClients = clients.filter(c => c && (c.firstName || c.lastName || c.phone || c.email));
    if (!validClients.length) {
      return res.status(400).json({ ok: false, error: "No client records could be extracted from the file" });
    }

    await resolveDefendants(validClients);
    const result = await persistClients(validClients);

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

    // Run TCPA case matching immediately (top 20 results) so UI shows matches right away
    let immediateMatches = [];
    if (result.matchQueued > 0) {
      try {
        const matchUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";
        const clientId = result.ids?.[0] || result.updatedIds?.[0];
        if (clientId) {
          const mr = await fetch(`${matchUrl}/api/match-cases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "client-to-cases", clientId, caseType: "TCPA", topN: 20 }),
            signal: AbortSignal.timeout(25000),
          });
          if (mr.ok) {
            const md = await mr.json();
            immediateMatches = (md.matches || [])
              .filter(m => m.qualifies || m.score >= 40)
              .slice(0, 10)
              .map(m => ({
                caseId:        m.caseId,
                caption:       m.caption || m.caseCaption,
                caseType:      m.caseType,
                score:         m.score,
                qualifies:     m.qualifies,
                status:        m.status,
                matchType:     m.matchType,
                matchingFactors: m.matchingFactors,
                claimWindowCloses: m.claimWindowCloses,
                perClaimantRange:  m.perClaimantRange,
              }));
          }
        }
      } catch { /* non-fatal — matching will still run via cron */ }
    }

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
      matches: immediateMatches,
    });

  } catch (e) {
    console.error("ingest-credit-report:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// bodyParser must be disabled so we can collect the raw body stream
export const config = { api: { bodyParser: false } };
