// Bankruptcy filing tracker — PACER Case Locator (PCL) party search.
//
// Uses the official PCL REST API to pull ALL bankruptcy debtors by date range,
// match names against the client roster, and write matches back to client records.
//
// Only case metadata is retrieved (case number, chapter, court, filing date,
// debtor name, status). No individual docket sheets or case documents downloaded.
//
// Cost: $0.10 per page of 54 results from PCL, billed to your PACER account.
//   Daily monitoring (~1,100 new cases/day ≈ 20–30 pages) ≈ $2–3/day.
//   5-year backfill (~3M debtor records ≈ 55K pages) ≈ $5,500 one-time.
//   Quarterly charges under $30 are waived automatically by PACER.
//
// ── Auth ──────────────────────────────────────────────────────────────────────
// POST https://pacer.login.uscourts.gov/services/cso-auth
// Body: { loginId, password, redactFlag: "1" [, otpCode: "6digits" if MFA] }
// Response: { nextGenCSO: "<128-char token>", loginResult: "0" }
//
// ── Party search ──────────────────────────────────────────────────────────────
// POST https://pcl.uscourts.gov/pcl-public-api/rest/parties/find?page=N
// Header: X-NEXT-GEN-CSO: <token>
// Body: { "role": ["db"], "courtCase": { "jurisdictionType": "bk",
//          "dateFiledFrom": "YYYY-MM-DD", "dateFiledTo": "YYYY-MM-DD" } }
// Response: { receipt: { billablePages, searchFee },
//             pageInfo: { totalPages, totalElements, number },
//             content: [{ lastName, firstName,
//               courtCase: { bankruptcyChapter, dateFiled, effectiveDateClosed,
//                            dispositionMethod, courtId, caseNumberFull, caseLink } }] }
// Page size: 54 results per page.
//
// ── Env vars ──────────────────────────────────────────────────────────────────
//   PACER_USERNAME     PACER login ID (required)
//   PACER_PASSWORD     PACER password (required)
//   PACER_MFA_SECRET   Base32 TOTP secret (only if MFA enabled on account)
//
// ── Endpoints ─────────────────────────────────────────────────────────────────
// POST /api/pacer-sync   { mode: "daily" }              — last 3 days
// POST /api/pacer-sync   { mode: "month", month: "YYYY-MM" } — one calendar month
// GET  /api/pacer-sync?browse=1[&chapter=7&status=active&page=0] — browse all matched cases
// GET  /api/pacer-sync?stats=1                           — last run stats + billing
// GET  /api/pacer-sync?status=1                          — PACER auth health check
// GET  /api/pacer-sync?cron=daily                        — Vercel cron trigger

import { kv } from "@vercel/kv";
import { createHmac } from "node:crypto";

const PACER_AUTH_URL = "https://pacer.login.uscourts.gov/services/cso-auth";
const PCL_BASE       = "https://pcl.uscourts.gov/pcl-public-api/rest";

const KV_AUTH        = "pacer:auth:token";
const KV_CURSOR      = "pacer:cursor";
const KV_STATS       = "pacer:stats";
const KV_BILLING     = "pacer:billing";
const KV_MONTHS      = "pacer:months_synced";
const KV_CASES_ZSET  = "bkr:cases_by_date";
const KV_CASE_PREFIX = "bkr:case:";
const CLIENTS_ZSET   = "clients_by_date";
const CLIENT_TTL     = 365 * 24 * 3600;
const CASE_TTL       = 400 * 24 * 3600;

// ── MFA / TOTP ────────────────────────────────────────────────────────────────

function base32Decode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, value = 0;
  const output = [];
  for (const c of clean) {
    const idx = chars.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTOTP(secretBase32) {
  const key = base32Decode(secretBase32);
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
    (hmac[offset + 3]  & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getPacerToken() {
  const cached = await kv.get(KV_AUTH).catch(() => null);
  if (cached) {
    const obj = typeof cached === "string" ? JSON.parse(cached) : cached;
    if (obj?.token && new Date(obj.expiresAt) > new Date(Date.now() + 5 * 60_000)) {
      return obj.token;
    }
  }

  const user = process.env.PACER_USERNAME;
  const pass = process.env.PACER_PASSWORD;
  if (!user || !pass) throw new Error("PACER_USERNAME / PACER_PASSWORD env vars not set");

  const body = { loginId: user, password: pass, redactFlag: "1" };
  const mfaSecret = process.env.PACER_MFA_SECRET;
  if (mfaSecret) body.otpCode = generateTOTP(mfaSecret);

  const r = await fetch(PACER_AUTH_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`PACER auth HTTP ${r.status}`);

  const d = await r.json();
  if (d.loginResult !== "0") {
    throw new Error(`PACER auth failed (loginResult ${d.loginResult}): ${d.errorDescription || "unknown"}`);
  }
  if (!d.nextGenCSO) throw new Error("PACER auth returned no token");

  const token     = d.nextGenCSO;
  const expiresAt = new Date(Date.now() + 50 * 60_000).toISOString();
  await kv.set(KV_AUTH, JSON.stringify({ token, expiresAt }), { ex: 3600 }).catch(() => {});
  return token;
}

async function refreshTokenFromHeaders(headers) {
  const newToken = headers?.get?.("X-NEXT-GEN-CSO");
  if (!newToken || newToken.length < 64) return null;
  const expiresAt = new Date(Date.now() + 50 * 60_000).toISOString();
  await kv.set(KV_AUTH, JSON.stringify({ token: newToken, expiresAt }), { ex: 3600 }).catch(() => {});
  return newToken;
}

// ── PCL party search ──────────────────────────────────────────────────────────

async function searchDebtors(token, { dateFrom, dateTo, page = 0 }) {
  const url = `${PCL_BASE}/parties/find?page=${page}`;
  const body = {
    role: ["db"],
    courtCase: { jurisdictionType: "bk", dateFiledFrom: dateFrom, dateFiledTo: dateTo },
  };

  const r = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":   "application/json",
      Accept:           "application/json",
      "X-NEXT-GEN-CSO": token,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const renewedToken = await refreshTokenFromHeaders(r.headers);

  if (r.status === 401) throw new Error("PACER session expired");
  if (r.status === 406) throw new Error("PCL rejected search parameters (406)");
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`PCL ${r.status}: ${text.slice(0, 200)}`);
  }

  const data     = await r.json();
  const content  = Array.isArray(data.content) ? data.content : [];
  const pageInfo = data.pageInfo || {};
  const receipt  = data.receipt  || {};
  const billable = receipt.billablePages ?? 1;
  const fee      = parseFloat(receipt.searchFee ?? "0.10");

  return {
    parties:       content,
    totalPages:    pageInfo.totalPages ?? 1,
    totalElements: pageInfo.totalElements ?? content.length,
    billablePages: billable,
    cost:          fee * billable,
    renewedToken:  renewedToken || null,
  };
}

// ── Name helpers ──────────────────────────────────────────────────────────────

function normName(raw) {
  return (raw || "")
    .toUpperCase()
    .replace(/\b(JR|SR|II|III|IV|MR|MRS|MS|DR)\b\.?/g, "")
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatus(dispositionMethod) {
  if (!dispositionMethod) return "active";
  const d = dispositionMethod.toLowerCase();
  if (d.includes("discharg")) return "discharged";
  if (d.includes("dismiss"))  return "dismissed";
  if (d.includes("convert"))  return "converted";
  return "active";
}

// ── Client name index ─────────────────────────────────────────────────────────

async function buildClientIndex() {
  const ids = await kv.zrange(CLIENTS_ZSET, 0, -1).catch(() => []);
  if (!ids.length) return new Map();
  const index = new Map();
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const rawBatch = await Promise.all(
      ids.slice(i, i + BATCH).map(id => kv.get(`client:${id}`).catch(() => null))
    );
    for (const raw of rawBatch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!c?.lastName) continue;
      const key = normName(c.lastName);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ id: c.id, firstName: c.firstName || "", lastName: c.lastName });
    }
  }
  return index;
}

function matchParty(party, nameIndex) {
  const pLast  = normName(party.lastName  || "");
  const pFirst = normName(party.firstName || "");
  if (!pLast) return [];

  const candidates = nameIndex.get(pLast) || [];
  const hits = [];
  for (const c of candidates) {
    const cFirst = normName(c.firstName);
    if (pFirst && cFirst) {
      if (
        pFirst === cFirst ||
        (pFirst.length >= 3 && cFirst.startsWith(pFirst.slice(0, 3))) ||
        (cFirst.length >= 3 && pFirst.startsWith(cFirst.slice(0, 3)))
      ) {
        hits.push({ clientId: c.id, confidence: "high" });
      } else if (pFirst[0] === cFirst[0]) {
        hits.push({ clientId: c.id, confidence: "low" });
      }
    } else {
      hits.push({ clientId: c.id, confidence: "low" });
    }
  }
  return hits;
}

// ── Filing normalizer ─────────────────────────────────────────────────────────
// Takes an array of PCL rows that all share the same caseNumberFull.
// Returns one normalized filing object with a parties[] array.

function normalizeFiling(parties) {
  const primary = parties[0];
  const cc = primary.courtCase || {};

  const rawCaseNum = cc.caseNumberFull ?? primary.caseNumberFull ?? null;
  const stableId   = rawCaseNum
    ? `bkr_${rawCaseNum.replace(/[^a-zA-Z0-9]/g, "_")}`
    : `bkr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const disposition = cc.dispositionMethod ?? primary.disposition ?? null;

  return {
    id:              stableId,
    caseNumber:      rawCaseNum,
    chapter:         cc.bankruptcyChapter ?? primary.bankruptcyChapter ?? null,
    court:           cc.courtId           ?? primary.courtId ?? null,
    dateFiled:       cc.dateFiled         ?? primary.dateFiled ?? null,
    disposition,
    status:          normalizeStatus(disposition),
    dispositionDate: cc.effectiveDateClosed ?? null,
    // parties[] — one entry per debtor (joint filers have multiple entries)
    parties: parties.map(p => ({
      role: "debtor",
      name: `${p.lastName || ""}, ${p.firstName || ""}`.trim().replace(/^,\s*/, ""),
    })),
    // debtorName kept for backward compat with records stored before parties[] existed
    debtorName: `${primary.lastName || ""}, ${primary.firstName || ""}`.trim().replace(/^,\s*/, ""),
    sourceUrl:   cc.caseLink ?? null,
    source:      "pacer",
    ingestedAt:  new Date().toISOString(),
  };
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function syncDateRange(token, dateFrom, dateTo, clientIndex) {
  let page = 0, totalPages = null;
  let processed = 0, matched = 0, totalCost = 0;
  const errors = [];
  let currentToken = token;

  // Phase 1: collect all party rows across all pages
  const allParties = [];

  do {
    let result;
    try {
      result = await searchDebtors(currentToken, { dateFrom, dateTo, page });
    } catch (e) {
      if (e.message.includes("expired")) await kv.del(KV_AUTH).catch(() => {});
      errors.push({ page, error: e.message });
      break;
    }

    if (result.renewedToken) currentToken = result.renewedToken;
    if (totalPages === null) totalPages = result.totalPages;
    totalCost += result.cost;

    for (const party of result.parties) {
      processed++;
      allParties.push(party);
    }

    if (page < (totalPages ?? 0) - 1) await new Promise(r => setTimeout(r, 400));
    page++;
  } while (totalPages !== null && page < totalPages);

  // Phase 2: group parties by caseNumberFull (joint filers share a case number)
  const caseGroups = new Map();
  for (const party of allParties) {
    const key = party.courtCase?.caseNumberFull ?? `_ungrouped_${Math.random()}`;
    if (!caseGroups.has(key)) caseGroups.set(key, []);
    caseGroups.get(key).push(party);
  }

  // Phase 3: match groups against client index
  const clientUpdates = new Map(); // clientId → [filing, ...]
  const caseIndex     = new Map(); // caseId   → { filing, clientIds: Set, maxConfidence }

  for (const [, groupedParties] of caseGroups) {
    // Collect best-confidence hit per client across all debtors in this case
    const allHits = new Map(); // clientId → { clientId, confidence }
    for (const party of groupedParties) {
      for (const hit of matchParty(party, clientIndex)) {
        const existing = allHits.get(hit.clientId);
        if (!existing || (hit.confidence === "high" && existing.confidence === "low")) {
          allHits.set(hit.clientId, hit);
        }
      }
    }
    if (!allHits.size) continue;

    const filing = normalizeFiling(groupedParties);
    const maxConfidence = [...allHits.values()].some(h => h.confidence === "high") ? "high" : "low";

    for (const [clientId, hit] of allHits) {
      if (!clientUpdates.has(clientId)) clientUpdates.set(clientId, []);
      clientUpdates.get(clientId).push({ ...filing, matchConfidence: hit.confidence });
      matched++;
    }

    caseIndex.set(filing.id, {
      filing,
      clientIds: new Set(allHits.keys()),
      maxConfidence,
    });
  }

  // Write client updates
  const WRITE = 20;
  const clientEntries = [...clientUpdates.entries()];
  for (let i = 0; i < clientEntries.length; i += WRITE) {
    await Promise.all(
      clientEntries.slice(i, i + WRITE).map(async ([clientId, filings]) => {
        try {
          const raw = await kv.get(`client:${clientId}`);
          if (!raw) return;
          const client      = typeof raw === "string" ? JSON.parse(raw) : raw;
          const existing    = client.pacerBankruptcies || [];
          const existingIds = new Set(existing.map(f => f.id));
          const newFilings  = filings.filter(f => !existingIds.has(f.id));
          if (!newFilings.length) return;
          await kv.set(
            `client:${clientId}`,
            JSON.stringify({ ...client, pacerBankruptcies: [...existing, ...newFilings] }),
            { ex: CLIENT_TTL }
          );
        } catch (e) {
          errors.push({ clientId, error: e.message });
        }
      })
    );
  }

  // Write global case index
  for (const [caseId, { filing, clientIds, maxConfidence }] of caseIndex) {
    try {
      const existingRaw = await kv.get(`${KV_CASE_PREFIX}${caseId}`).catch(() => null);
      const existing    = existingRaw
        ? (typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw)
        : null;
      const mergedClientIds = [...new Set([...(existing?.clientIds || []), ...clientIds])];

      await kv.set(
        `${KV_CASE_PREFIX}${caseId}`,
        JSON.stringify({ ...filing, clientIds: mergedClientIds, matchConfidence: maxConfidence }),
        { ex: CASE_TTL }
      );
      const score = filing.dateFiled ? new Date(filing.dateFiled).getTime() : Date.now();
      await kv.zadd(KV_CASES_ZSET, { score, member: caseId });
    } catch (e) {
      errors.push({ caseId, error: e.message });
    }
  }

  return { processed, matched, pages: page, cost: totalCost, errors };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Browse all matched cases (paginated, filterable)
  if (req.method === "GET" && req.query?.browse) {
    const page    = Math.max(0, parseInt(req.query?.page || "0"));
    const chapter = req.query?.chapter || null;
    const status  = req.query?.status  || null;
    const total   = await kv.zcard(KV_CASES_ZSET).catch(() => 0);
    const ids     = await kv.zrange(KV_CASES_ZSET, page * 50, page * 50 + 49, { rev: true }).catch(() => []);

    if (!ids.length) {
      return res.status(200).json({ cases: [], total, page, pageSize: 50 });
    }

    let cases = (await Promise.all(ids.map(id => kv.get(`${KV_CASE_PREFIX}${id}`).catch(() => null))))
      .filter(Boolean)
      .map(r => (typeof r === "string" ? JSON.parse(r) : r));

    if (chapter) cases = cases.filter(c => String(c.chapter) === chapter);
    if (status)  cases = cases.filter(c => c.status === status);

    return res.status(200).json({ cases, total, page, pageSize: 50 });
  }

  // Stats
  if (req.method === "GET" && req.query?.stats) {
    const [stats, monthsRaw, cursor, billing] = await Promise.all([
      kv.get(KV_STATS).catch(() => null),
      kv.zrange(KV_MONTHS, 0, -1).catch(() => []),
      kv.get(KV_CURSOR).catch(() => null),
      kv.get(KV_BILLING).catch(() => null),
    ]);
    const s = stats   ? (typeof stats   === "string" ? JSON.parse(stats)   : stats)   : {};
    const b = billing ? (typeof billing === "string" ? JSON.parse(billing) : billing) : { totalCost: 0, pages: 0 };
    return res.status(200).json({
      stats: s, monthsSynced: monthsRaw, cursor: cursor || null, billing: b,
      credsMissing:  !process.env.PACER_USERNAME || !process.env.PACER_PASSWORD,
      mfaConfigured: !!process.env.PACER_MFA_SECRET,
    });
  }

  // Auth health check
  if (req.method === "GET" && req.query?.status) {
    const hasCreds = !!(process.env.PACER_USERNAME && process.env.PACER_PASSWORD);
    if (!hasCreds) return res.status(200).json({ ok: false, reason: "PACER_USERNAME or PACER_PASSWORD not set" });
    try {
      const token = await getPacerToken();
      return res.status(200).json({ ok: true, tokenLength: token.length, mfaConfigured: !!process.env.PACER_MFA_SECRET });
    } catch (e) {
      return res.status(200).json({ ok: false, reason: e.message });
    }
  }

  // Vercel cron fires as GET ?cron=daily
  if (req.method === "GET" && req.query?.cron === "daily") {
    req = { ...req, method: "POST", body: { mode: "daily" } };
  } else if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { mode = "daily", month, year } = req.body || {};

  let token;
  try {
    token = await getPacerToken();
  } catch (e) {
    return res.status(500).json({ error: e.message, hint: "Check PACER_USERNAME, PACER_PASSWORD, and PACER_MFA_SECRET env vars." });
  }

  const clientIndex = await buildClientIndex();

  let dateFrom, dateTo;
  if (mode === "daily") {
    const d = new Date();
    dateTo   = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 3);
    dateFrom = d.toISOString().slice(0, 10);
  } else if (mode === "month" && month) {
    const [y, m] = month.split("-").map(Number);
    dateFrom = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    dateTo   = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
  } else if (mode === "year" && year) {
    dateFrom = `${year}-01-01`;
    dateTo   = `${year}-12-31`;
  } else {
    return res.status(400).json({ error: "mode must be 'daily', 'month' (+ month: 'YYYY-MM'), or 'year' (+ year: 'YYYY')" });
  }

  const started = Date.now();
  const result = await syncDateRange(token, dateFrom, dateTo, clientIndex).catch(e => ({
    processed: 0, matched: 0, pages: 0, cost: 0, errors: [{ error: e.message }],
  }));

  const ranAt = new Date().toISOString();
  const stats = {
    mode, dateFrom, dateTo,
    processed:  result.processed,
    matched:    result.matched,
    pages:      result.pages,
    cost:       result.cost,
    errorCount: result.errors.length,
    durationMs: Date.now() - started,
    ranAt,
  };

  const prevBilling = await kv.get(KV_BILLING).catch(() => null);
  const prev = prevBilling ? (typeof prevBilling === "string" ? JSON.parse(prevBilling) : prevBilling) : { totalCost: 0, pages: 0 };
  await kv.set(KV_BILLING, JSON.stringify({
    totalCost: (prev.totalCost || 0) + result.cost,
    pages:     (prev.pages    || 0) + result.pages,
    updatedAt: ranAt,
  }), { ex: 400 * 24 * 3600 }).catch(() => {});

  await Promise.all([
    kv.set(KV_CURSOR, dateTo, { ex: 400 * 24 * 3600 }).catch(() => {}),
    kv.set(KV_STATS,  JSON.stringify(stats), { ex: 30 * 24 * 3600 }).catch(() => {}),
    mode === "month" && month
      ? kv.zadd(KV_MONTHS, { score: new Date(dateFrom).getTime(), member: month }).catch(() => {})
      : Promise.resolve(),
  ]);

  return res.status(200).json({ ok: true, ...stats, errors: result.errors.slice(0, 10) });
}
