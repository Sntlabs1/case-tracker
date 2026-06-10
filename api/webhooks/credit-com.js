// Incremental credit.com webhook — receives new/updated client records in real
// time as credit.com users sign up or refresh their reports.
//
// POST /api/webhooks/credit-com
//   Headers:
//     X-CreditCom-Signature: HMAC-SHA256(rawBody, CREDIT_COM_WEBHOOK_SECRET)
//     Content-Type: application/json
//   Body: single client object OR { records: [...] } (up to 500 per call)
//
// Returns: { ok: true, received: N, queued: N }

import normalize                       from "../_partner-importers/credit-com.js";
import { kv }                          from "@vercel/kv";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  normalize as normalizeDefendant,
  createDefendant,
} from "../../src/lib/ingest/defendantResolver.js";

// ── Raw body helper ───────────────────────────────────────────────────────────

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── KV constants (mirror ingest-credit-report.js) ────────────────────────────

const CLIENTS_ZSET  = "clients_by_date";
const CLIENTS_CACHE = "clients_cache_v1";
const PENDING_MATCH = "tcpa:clients_pending_match";
const CLIENT_TTL    = 365 * 24 * 3600;

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
    firstName:              c.firstName  || c.first_name  || "",
    lastName:               c.lastName   || c.last_name   || "",
    email,
    phone:                  primaryPhone,
    phoneNumbers:           phones,
    state:                  (c.state || "").toUpperCase().slice(0, 2),
    city:                   c.city  || "",
    dob:                    c.dob   || null,
    ssnLast4:               c.ssnLast4 || null,
    creditScore:            c.creditScore || null,
    sourceFirm:             c.sourceFirm  || "Credit.com",
    ingestSource:           c.ingestSource || "credit.com",
    partnerId:              c.partnerId   || "credit_com",
    contactRights:          c.contactRights || { creditor: true, source: "credit.com partnership" },
    tcpaOptOut:             c.tcpaOptOut === true,
    importedAt:             new Date(now).toISOString(),
    phoneHash:              primaryPhone ? sha256(primaryPhone) : "",
    emailHash:              email        ? sha256(email)        : "",
    collectionsHistory:     Array.isArray(c.collectionsHistory)  ? c.collectionsHistory  : [],
    addressHistory:         Array.isArray(c.addressHistory)      ? c.addressHistory      : [],
    creditAccounts:         Array.isArray(c.creditAccounts)      ? c.creditAccounts      : [],
    bankruptcies:           Array.isArray(c.bankruptcies)        ? c.bankruptcies        : [],
    civilJudgments:         Array.isArray(c.civilJudgments)      ? c.civilJudgments      : [],
    taxLiens:               Array.isArray(c.taxLiens)            ? c.taxLiens            : [],
    creditInquiries:        Array.isArray(c.creditInquiries)     ? c.creditInquiries     : [],
    creditReportAlerts:     Array.isArray(c.creditReportAlerts)  ? c.creditReportAlerts  : [],
    employmentHistory:      Array.isArray(c.employmentHistory)   ? c.employmentHistory   : [],
    creditReportSummary:    c.creditReportSummary || null,
    lastCreditReportAt:     c.lastCreditReportAt  || new Date(now).toISOString(),
    lastCreditReportBureau: c.lastCreditReportBureau || null,
    matchedLeads:           [],
    existingCases:          c.existingCases || "",
  };
}

// ── Defendant resolution (mirrors ingest-credit-report.js) ───────────────────

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

// ── Upsert (identical dedup logic to ingest-credit-report.js) ────────────────

async function persistClients(records) {
  const now = Date.now();
  let queued = 0;

  for (let i = 0; i < records.length; i++) {
    const fresh = buildRecord(records[i], now, i);

    let existingId = null;
    for (const [field, hash] of [
      ["client_by_phonehash", fresh.phoneHash],
      ["client_by_emailhash", fresh.emailHash],
    ]) {
      if (!hash) continue;
      const id = await kv.get(`${field}:${hash}`).catch(() => null);
      if (id) { existingId = id; break; }
    }
    if (!existingId && fresh.firstName && fresh.lastName && fresh.dob) {
      const nameKey = sha256(`${fresh.firstName.toLowerCase()}|${fresh.lastName.toLowerCase()}|${fresh.dob}`);
      const id = await kv.get(`client_by_namekey:${nameKey}`).catch(() => null);
      if (id) existingId = id;
      fresh._nameKey = nameKey;
    }

    const id    = existingId || fresh.id;
    const score = now + i;
    const ops   = [
      kv.set(`client:${id}`, JSON.stringify({ ...fresh, id }), { ex: CLIENT_TTL }),
      kv.zadd(CLIENTS_ZSET, { score, member: id }),
      kv.zadd(`clients_by_partner:${fresh.partnerId}`, { score, member: id }),
    ];
    if (fresh.phoneHash) ops.push(kv.set(`client_by_phonehash:${fresh.phoneHash}`, id, { ex: CLIENT_TTL }));
    if (fresh.emailHash) ops.push(kv.set(`client_by_emailhash:${fresh.emailHash}`, id, { ex: CLIENT_TTL }));
    if (fresh._nameKey)  ops.push(kv.set(`client_by_namekey:${fresh._nameKey}`,    id, { ex: CLIENT_TTL }));
    ops.push(kv.zadd(PENDING_MATCH, { score, member: id }).catch(() => {}));
    await Promise.all(ops);
    queued++;
  }

  await kv.del(CLIENTS_CACHE).catch(() => {});
  return queued;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CreditCom-Signature");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = process.env.CREDIT_COM_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Webhook not configured" });

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch {
    return res.status(400).json({ error: "Failed to read request body" });
  }

  const sigHeader = req.headers["x-creditcom-signature"] || "";
  const computedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const computedBuf = Buffer.from(computedHex);
  const receivedBuf = Buffer.from(sigHeader.replace(/^sha256=/, ""));
  if (
    receivedBuf.length !== computedBuf.length ||
    !timingSafeEqual(receivedBuf, computedBuf)
  ) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const raw = Array.isArray(body?.records) ? body.records : [body];
  if (!raw.length || !raw[0]) return res.status(400).json({ error: "No records in payload" });
  if (raw.length > 500) return res.status(400).json({ error: "Maximum 500 records per call" });

  const normalized = raw.map(r => normalize(r)).filter(c =>
    c && (c.firstName || c.lastName || c.phone || c.email)
  );

  if (!normalized.length) {
    return res.status(200).json({ ok: true, received: raw.length, queued: 0 });
  }

  await resolveDefendants(normalized);
  const queued = await persistClients(normalized);

  return res.status(200).json({ ok: true, received: raw.length, queued });
}

export const config = { api: { bodyParser: false } };
