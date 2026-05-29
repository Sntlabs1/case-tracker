// Bulk credit-report ingest — designed for 20M+ records.
//
// POST /api/ingest-credit-report-bulk
//   Content-Type: multipart/form-data
//     file     — CSV or JSON array (up to 50 MB per request)
//     partner  — optional (default: "credit_com")
//   OR application/json body:
//     { url: "https://...", partner: "credit_com" }  — stream from URL (no size limit)
//     { clients: [...] }                             — pre-parsed array
//
// GET /api/ingest-credit-report-bulk?jobId=xxx       — poll job progress
//
// Architecture for scale:
//   - Upstash REST pipeline API: 1,000 KV ops per HTTP call vs. 1 op per call.
//     For 20M records this reduces ~120M individual HTTP calls → ~160K pipeline calls.
//   - Parallel pipelines: up to MAX_CONCURRENT_PIPELINES at once.
//   - Dedup via batch MGET pipeline: one call per 500 records vs. 2 calls per record.
//   - Job-based: returns a jobId immediately; progress tracked in KV.
//     Credit.com should poll GET ?jobId=xxx. Each subsequent call continues the job.
//
// Throughput estimate (Upstash Pay-as-you-go):
//   - 10K records/chunk × 6 KV ops = 60K ops → 60 pipeline calls per chunk
//   - 50 concurrent pipelines per chunk → 1 chunk ≈ 200ms wall-clock
//   - 20M records / 10K = 2,000 chunks → ~400 seconds for pure write phase
//   - Dedup adds ~40 pipeline calls per chunk → ~50 seconds extra
//   - Real-world: credit.com will push in streams of 100K–500K; each call finishes < 30s.

import { parseCreditReportCsv }     from "./_ingest-parsers/csv-parser.js";
import normalize                     from "./_partner-importers/credit-com-json.js";
import { buildCreditReport }         from "../src/lib/creditReportSchema.js";
import { creditReportToClient }      from "../src/lib/creditReportToClient.js";
import { createHash }                from "node:crypto";
import {
  normalize as normalizeDefendant,
  createDefendant,
} from "../src/lib/defendantResolver.js";

// ── Upstash REST pipeline ───────────────────────────────────────────────────

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvPipeline(commands) {
  if (!commands.length) return [];
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`KV pipeline ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.map ? d.map(x => x.result) : [];
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return (await r.json()).result;
}

async function kvSet(key, value, exSec = 365 * 24 * 3600) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value, ex: exSec }),
  });
}

// ── Constants ───────────────────────────────────────────────────────────────

const CLIENTS_ZSET           = "clients_by_date";
const CLIENTS_PENDING_MATCH  = "tcpa:clients_pending_match";
const CLIENTS_CACHE_KEY      = "clients_cache_v1";
const CHUNK_SIZE             = 10_000;   // records per processing chunk
const PIPELINE_BATCH         = 1_000;    // KV ops per pipeline call
const MAX_CONCURRENT_PIPES   = 20;       // parallel pipeline HTTP calls
const CLIENT_TTL             = 365 * 24 * 3600; // 1 year
const MAX_ERRORS_STORED      = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function normEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function genId(now, idx) {
  return `c_${now}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
}

// Convert a raw client object (from normalizer) into a storable record.
// Includes ALL credit-report fields — none get dropped.
function buildRecord(c, idx, now) {
  const phones = (Array.isArray(c.phoneNumbers) && c.phoneNumbers.length
    ? c.phoneNumbers : (c.phone ? [c.phone] : []))
    .map(normPhone).filter(Boolean);
  const primaryPhone = phones[0] || "";
  const email = normEmail(c.email);

  return {
    id:              c.id || genId(now, idx),
    firstName:       c.firstName  || c.first_name  || "",
    lastName:        c.lastName   || c.last_name   || "",
    email,
    phone:           primaryPhone,
    phoneNumbers:    phones,
    state:           (c.state || "").toUpperCase().slice(0, 2),
    city:            c.city || "",
    dob:             c.dob  || null,
    ssnLast4:        c.ssnLast4 || null,
    creditScore:     c.creditScore || null,
    sourceFirm:      c.sourceFirm  || "Credit.com",
    ingestSource:    c.ingestSource || "credit.com",
    partnerId:       c.partnerId   || "credit_com",
    contactRights:   c.contactRights || { creditor: true, source: "credit.com partnership" },
    tcpaOptOut:      c.tcpaOptOut === true,
    importedAt:      new Date(now).toISOString(),
    // Dedup keys (SHA-256 to avoid storing PII in KV keys)
    phoneHash:       primaryPhone ? sha256(primaryPhone) : "",
    emailHash:       email        ? sha256(email)        : "",
    // Legacy flat fields
    collectionsHistory: Array.isArray(c.collectionsHistory) ? c.collectionsHistory : [],
    addressHistory:     Array.isArray(c.addressHistory)     ? c.addressHistory     : [],
    // Full credit-report fields — all tradelines, public records, etc.
    creditAccounts:     Array.isArray(c.creditAccounts)     ? c.creditAccounts     : [],
    bankruptcies:       Array.isArray(c.bankruptcies)       ? c.bankruptcies       : [],
    civilJudgments:     Array.isArray(c.civilJudgments)     ? c.civilJudgments     : [],
    taxLiens:           Array.isArray(c.taxLiens)           ? c.taxLiens           : [],
    creditInquiries:    Array.isArray(c.creditInquiries)    ? c.creditInquiries    : [],
    creditReportAlerts: Array.isArray(c.creditReportAlerts) ? c.creditReportAlerts : [],
    employmentHistory:  Array.isArray(c.employmentHistory)  ? c.employmentHistory  : [],
    creditReportSummary: c.creditReportSummary || null,
    lastCreditReportAt:  c.lastCreditReportAt  || new Date(now).toISOString(),
    lastCreditReportBureau: c.lastCreditReportBureau || null,
    matchedLeads: [],
    existingCases: c.existingCases || "",
  };
}

// ── Bulk defendant resolution ───────────────────────────────────────────────
// Gather every unique creditor name across all records in the chunk, resolve
// them in one batch, back-fill canonical IDs. Same pattern as clients.js but
// extended to creditAccounts[] as well as collectionsHistory[].

async function bulkResolveDefendants(records) {
  const uniqueNames = new Map();
  for (const r of records) {
    for (const e of [...(r.collectionsHistory || []), ...(r.creditAccounts || [])]) {
      const candidates = [
        [e.creditor, e.creditorCanonicalId],
        [e.debtBuyer || e.originalCreditor, e.debtBuyerCanonicalId || e.originalCreditorCanonicalId],
      ];
      for (const [name, existingId] of candidates) {
        if (!name || existingId) continue;
        const norm = normalizeDefendant(name);
        if (norm && !uniqueNames.has(norm)) uniqueNames.set(norm, name);
      }
    }
  }
  if (!uniqueNames.size) return;

  const normList = [...uniqueNames.keys()];
  const cache = new Map();

  // Batch alias lookups via pipeline
  for (let i = 0; i < normList.length; i += PIPELINE_BATCH) {
    const slice = normList.slice(i, i + PIPELINE_BATCH);
    const cmds = slice.map(n => ["GET", `tcpa:defendant_alias:${n}`]);
    const results = await kvPipeline(cmds);
    slice.forEach((n, j) => { if (results[j]) cache.set(n, results[j]); });
  }

  // Create defendants for misses
  for (const norm of normList) {
    if (cache.has(norm)) continue;
    try {
      const created = await createDefendant({ displayName: uniqueNames.get(norm) });
      cache.set(norm, created.canonicalId);
    } catch { /* skip */ }
  }

  // Back-fill canonical IDs
  for (const r of records) {
    for (const arr of [r.collectionsHistory || [], r.creditAccounts || []]) {
      for (const e of arr) {
        if (e.creditor && !e.creditorCanonicalId) {
          const norm = normalizeDefendant(e.creditor);
          if (cache.has(norm)) e.creditorCanonicalId = cache.get(norm);
        }
        const buyerField = e.debtBuyer ? "debtBuyer" : (e.originalCreditor ? "originalCreditor" : null);
        const buyerIdField = buyerField === "debtBuyer" ? "debtBuyerCanonicalId" : "originalCreditorCanonicalId";
        if (buyerField && e[buyerField] && !e[buyerIdField]) {
          const norm = normalizeDefendant(e[buyerField]);
          if (cache.has(norm)) e[buyerIdField] = cache.get(norm);
        }
      }
    }
  }
}

// ── Dedup: batch hash lookups ───────────────────────────────────────────────
// Returns a Map of hash → existing clientId (or null).
// One pipeline call per PIPELINE_BATCH hashes — much faster than individual GETs.

async function batchDedupLookup(records) {
  // Collect all unique hashes to look up
  const hashToKey = new Map(); // hash → KV key
  for (const r of records) {
    if (r.phoneHash) hashToKey.set(r.phoneHash, `client_by_phonehash:${r.phoneHash}`);
    if (r.emailHash) hashToKey.set(r.emailHash, `client_by_emailhash:${r.emailHash}`);
  }
  const hashes = [...hashToKey.keys()];
  const existingByHash = new Map();

  // Batch lookups
  for (let i = 0; i < hashes.length; i += PIPELINE_BATCH) {
    const slice = hashes.slice(i, i + PIPELINE_BATCH);
    const cmds = slice.map(h => ["GET", hashToKey.get(h)]);
    const results = await kvPipeline(cmds);
    slice.forEach((h, j) => { if (results[j]) existingByHash.set(h, results[j]); });
  }

  // Resolve: per record, does it match an existing client?
  const matches = new Map(); // record index → existing clientId or null
  records.forEach((r, i) => {
    const id = existingByHash.get(r.phoneHash) || existingByHash.get(r.emailHash) || null;
    matches.set(i, id);
  });
  return matches;
}

// ── Pipeline write executor ─────────────────────────────────────────────────
// Split a big list of KV commands into PIPELINE_BATCH-sized chunks, then
// execute up to MAX_CONCURRENT_PIPES chunks at once.

async function executePipelines(commands) {
  const chunks = [];
  for (let i = 0; i < commands.length; i += PIPELINE_BATCH) {
    chunks.push(commands.slice(i, i + PIPELINE_BATCH));
  }
  // Process in concurrent groups
  for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_PIPES) {
    await Promise.all(chunks.slice(i, i + MAX_CONCURRENT_PIPES).map(c => kvPipeline(c)));
  }
}

// ── Chunk processor ─────────────────────────────────────────────────────────

async function processChunk(rawRecords, partnerId, chunkStart, now) {
  const records = rawRecords.map((c, i) => buildRecord(c, chunkStart + i, now));
  const valid = records.filter(r => r.phoneHash || r.emailHash);
  const invalid = records.length - valid.length;

  // 1. Resolve defendant canonical IDs across entire chunk in one batch
  await bulkResolveDefendants(valid);

  // 2. Dedup: one pipeline call per 1000 hashes
  const dedupMap = await batchDedupLookup(valid);

  // 3. Build all write commands
  const writeCommands = [];
  let imported = 0, updated = 0;
  const matchIds = [];

  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const existingId = dedupMap.get(i);
    const id    = existingId || r.id;
    const score = now + chunkStart + i;
    const json  = JSON.stringify(existingId ? { ...r, id: existingId } : r);

    writeCommands.push(["SET", `client:${id}`, json, "EX", String(CLIENT_TTL)]);
    writeCommands.push(["ZADD", CLIENTS_ZSET, String(score), id]);
    writeCommands.push(["ZADD", `clients_by_partner:${partnerId}`, String(score), id]);
    if (r.phoneHash) writeCommands.push(["SET", `client_by_phonehash:${r.phoneHash}`, id, "EX", String(CLIENT_TTL)]);
    if (r.emailHash) writeCommands.push(["SET", `client_by_emailhash:${r.emailHash}`, id, "EX", String(CLIENT_TTL)]);
    writeCommands.push(["ZADD", CLIENTS_PENDING_MATCH, String(score), id]);

    if (existingId) updated++; else imported++;
    matchIds.push(id);
  }

  // 4. Execute all writes in parallel pipeline batches
  await executePipelines(writeCommands);

  return { imported, updated, invalid, total: records.length };
}

// ── File parsers ─────────────────────────────────────────────────────────────

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

async function parseBody(file, contentType, text) {
  const filename = (file?.name || "").toLowerCase();
  const isJson = filename.endsWith(".json") || (contentType || "").includes("json");

  if (isJson) {
    const obj = JSON.parse(text);
    return (Array.isArray(obj) ? obj : [obj]).map(item => normalize(item));
  }
  // CSV / TSV / TXT → credit report shape
  const reports = parseCreditReportCsv(text);
  return reports.map(reportToClient);
}

// Guard against SSRF — only allow public HTTPS URLs
function isSafeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    // Block RFC-1918, loopback, and all-interfaces addresses
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|::1|localhost)/i.test(host)) return false;
    // Block IPv6 unspecified, link-local, and ULA (RFC 4193) addresses
    if (/^(\[::|\[fe80|\[fd)/i.test(host)) return false;
    return true;
  } catch { return false; }
}

// Stream a remote URL and return its text.
async function fetchRemoteText(url) {
  const r = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
  if (!r.ok) throw new Error(`Remote fetch ${r.status}: ${url}`);
  return r.text();
}

// ── Job tracking ─────────────────────────────────────────────────────────────

async function createJob(total, partnerId) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await kvSet(`ingest:job:${id}`, {
    id, partnerId, total,
    processed: 0, imported: 0, updated: 0, failed: 0,
    status: "running",
    startedAt: new Date().toISOString(),
    errors: [],
  }, 7 * 24 * 3600); // 7 days
  return id;
}

async function updateJob(jobId, delta) {
  const raw = await kvGet(`ingest:job:${jobId}`);
  if (!raw) return;
  const job = typeof raw === "string" ? JSON.parse(raw) : raw;
  Object.assign(job, {
    processed: (job.processed || 0) + (delta.processed || 0),
    imported:  (job.imported  || 0) + (delta.imported  || 0),
    updated:   (job.updated   || 0) + (delta.updated   || 0),
    failed:    (job.failed    || 0) + (delta.failed    || 0),
  });
  if (delta.errors?.length && job.errors.length < MAX_ERRORS_STORED) {
    job.errors.push(...delta.errors.slice(0, MAX_ERRORS_STORED - job.errors.length));
  }
  if (delta.status) job.status = delta.status;
  if (job.processed >= job.total) {
    job.status = "complete";
    job.completedAt = new Date().toISOString();
    job.elapsedSec = (Date.now() - Date.parse(job.startedAt)) / 1000;
  }
  await kvSet(`ingest:job:${jobId}`, job, 7 * 24 * 3600);
  return job;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Partner");
  if (req.method === "OPTIONS") return res.status(200).end();

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(503).json({ ok: false, error: 'KV not configured' });
  }

  // ── GET — poll job status ────────────────────────────────────────────────
  if (req.method === "GET") {
    const { jobId } = req.query || {};
    if (!jobId) return res.status(400).json({ error: "jobId required" });
    const raw = await kvGet(`ingest:job:${jobId}`);
    if (!raw) return res.status(404).json({ error: "Job not found" });
    const job = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.status(200).json(job);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  const startMs = Date.now();

  try {
    const contentType = req.headers["content-type"] || "";
    let rawClients = [];
    let partner = req.headers["x-partner"] || "credit_com";
    let sourceInfo = "upload";

    // Collect raw body — req.formData() and req.json() are Edge Runtime APIs
    // not available in the Vercel Node.js serverless runtime.
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const body = JSON.parse(rawBody.toString("utf8"));
    partner = body.partner || partner;

    if (body.file) {
      // base64 file sent from browser
      const text = Buffer.from(body.file, "base64").toString("utf8");
      const filename = (body.filename || "upload").toLowerCase();
      const ct = body.contentType || "";
      const isJson = filename.endsWith(".json") || ct.includes("json");
      sourceInfo = body.filename || "upload";
      if (isJson) {
        const obj = JSON.parse(text);
        rawClients = (Array.isArray(obj) ? obj : [obj]).map(c => normalize(c));
      } else {
        rawClients = parseCreditReportCsv(text).map(reportToClient);
      }

    } else if (body.url) {
      if (!isSafeUrl(body.url)) {
        return res.status(400).json({ error: 'Invalid or unsafe URL' });
      }
      sourceInfo = body.url;
      const text = await fetchRemoteText(body.url);
      const isJson = body.url.endsWith(".json");
      if (isJson) {
        const obj = JSON.parse(text);
        rawClients = (Array.isArray(obj) ? obj : [obj]).map(c => normalize(c));
      } else {
        rawClients = parseCreditReportCsv(text).map(reportToClient);
      }
    } else if (Array.isArray(body.clients)) {
      rawClients = body.clients.map(c => normalize(c));
    } else if (Array.isArray(body)) {
      rawClients = body.map(c => normalize(c));
    } else {
      return res.status(400).json({ ok: false, error: "Provide { file, filename } or { url } or { clients: [...] }" });
    }

    // Filter out completely empty rows
    const clients = rawClients.filter(c => c && (c.firstName || c.lastName || c.phone || c.email));
    const skipped = rawClients.length - clients.length;

    // Create job for tracking
    const jobId = await createJob(clients.length, partner);

    // Respond immediately with jobId — client can poll for progress
    res.status(202).json({
      ok: true,
      jobId,
      total: clients.length,
      skipped,
      source: sourceInfo,
      pollUrl: `/api/ingest-credit-report-bulk?jobId=${jobId}`,
      message: `Processing ${clients.length.toLocaleString()} records. Poll pollUrl for progress.`,
    });

    // Process all chunks (runs after response is sent via Node.js keep-alive)
    // On Vercel serverless, this continues until the function times out (300s).
    // For truly massive datasets, credit.com should send in batches of ≤500K.
    let chunkStart = 0;
    const now = Date.now();

    for (let i = 0; i < clients.length; i += CHUNK_SIZE) {
      const chunk = clients.slice(i, i + CHUNK_SIZE);
      try {
        const result = await processChunk(chunk, partner, chunkStart, now);
        await updateJob(jobId, {
          processed: result.total,
          imported:  result.imported,
          updated:   result.updated,
          failed:    result.invalid,
        });
        chunkStart += chunk.length;
      } catch (e) {
        await updateJob(jobId, {
          processed: chunk.length,
          failed:    chunk.length,
          errors:    [{ chunk: i / CHUNK_SIZE, error: e.message }],
        });
      }
    }

    // Invalidate list cache so Clients tab picks up new records
    await fetch(`${KV_URL}/del/${encodeURIComponent(CLIENTS_CACHE_KEY)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    }).catch(() => {});

    await updateJob(jobId, { status: "complete" });

  } catch (e) {
    console.error("ingest-credit-report-bulk:", e.message);
    // Response already sent with 202 — can't send another
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
}

export const config = {
  api: {
    bodyParser: false,
    // Allow up to 50 MB request bodies (handles ~250K records per call)
    responseLimit: false,
  },
};
