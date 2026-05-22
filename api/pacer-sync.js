// Bankruptcy filing tracker — CourtListener RECAP (free).
//
// Pulls federal bankruptcy dockets from CourtListener's free REST API,
// extracts debtor names from case captions, matches against the client
// roster, and writes matches to client records + a global browse index.
//
// Coverage: CourtListener has ~65-70% of all federal BK filings via RECAP.
// No PACER account required, no per-page charges.
//
// Optional: set COURTLISTENER_API_TOKEN (free at courtlistener.com) to raise
// the rate limit from 5,000 req/day (anonymous) to 50,000 req/day.
//
// ── API ───────────────────────────────────────────────────────────────────────
// GET /api/rest/v4/dockets/?court__jurisdiction=B
//     &date_filed__gte=YYYY-MM-DD&date_filed__lte=YYYY-MM-DD
//     &order_by=-date_filed&page_size=100
// Response: { count, next, results: [{ id, case_name, date_filed,
//   docket_number, court_id, chapter, case_status,
//   date_discharge, date_dismissed, absolute_url }] }
//
// ── Endpoints ─────────────────────────────────────────────────────────────────
// POST /api/pacer-sync   { mode: "daily" }              — last 3 days
// POST /api/pacer-sync   { mode: "month", month: "YYYY-MM" } — one calendar month
// GET  /api/pacer-sync?browse=1[&chapter=7&status=active&page=0]
// GET  /api/pacer-sync?stats=1
// GET  /api/pacer-sync?cron=daily                        — Vercel cron trigger

import { kv } from "@vercel/kv";

const CL_BASE      = "https://www.courtlistener.com/api/rest/v4";
const PAGE_SIZE    = 100;
const MAX_PAGES    = 200; // ~80s at 400ms/req; stays within 300s Vercel limit

const KV_CURSOR    = "pacer:cursor";
const KV_STATS     = "pacer:stats";
const KV_MONTHS    = "pacer:months_synced";
const KV_CASES_ZSET  = "bkr:cases_by_date";
const KV_CASE_PREFIX = "bkr:case:";
const CLIENTS_ZSET   = "clients_by_date";
const CLIENT_TTL     = 365 * 24 * 3600;
const CASE_TTL       = 400 * 24 * 3600;

function clHeaders() {
  const token = process.env.COURTLISTENER_API_TOKEN;
  return token
    ? { Authorization: `Token ${token}`, Accept: "application/json" }
    : { Accept: "application/json" };
}

// ── Debtor name extraction ────────────────────────────────────────────────────
// Bankruptcy captions: "In re Smith, John A." / "In re Smith, John and Doe, Jane"
// Returns array of { lastName, firstName } objects (handles joint filers).

function extractDebtors(caseName) {
  if (!caseName) return [];
  let s = caseName.replace(/^in\s+re[:\s]+/i, "").trim();
  // Strip trailing chapter/case type suffixes
  s = s.replace(/,?\s*(chapter\s*\d+|ch\.\s*\d+|debtor.*|case.*)$/i, "").trim();
  if (!s || s.length < 3) return [];

  // Split joint filers on " and " or " & "
  const parts = s.split(/\s+(?:and|&)\s+/i);
  const debtors = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // "Lastname, Firstname" format (most common in PACER)
    const commaMatch = trimmed.match(/^([A-Za-z\s'-]+),\s*([A-Za-z\s'-]*)$/);
    if (commaMatch) {
      debtors.push({ lastName: commaMatch[1].trim(), firstName: commaMatch[2].trim() });
      continue;
    }
    // "Firstname Lastname" format
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      debtors.push({ firstName: words[0], lastName: words[words.length - 1] });
    } else {
      debtors.push({ lastName: trimmed, firstName: "" });
    }
  }
  return debtors;
}

// ── Name normalizer ───────────────────────────────────────────────────────────

function normName(raw) {
  return (raw || "")
    .toUpperCase()
    .replace(/\b(JR|SR|II|III|IV|MR|MRS|MS|DR)\b\.?/g, "")
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatus(d) {
  if (!d) return "active";
  const s = String(d).toLowerCase();
  if (s.includes("discharg")) return "discharged";
  if (s.includes("dismiss"))  return "dismissed";
  if (s.includes("convert"))  return "converted";
  if (s === "closed")         return "dismissed";
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

// ── Match debtor against client index ─────────────────────────────────────────

function matchDebtor(debtor, nameIndex) {
  const pLast  = normName(debtor.lastName);
  const pFirst = normName(debtor.firstName);
  if (!pLast || pLast.length < 2) return [];

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

// ── Docket normalizer ─────────────────────────────────────────────────────────

function normalizeDocket(d, debtors) {
  const rawCaseNum = d.docket_number || null;
  const stableId   = rawCaseNum
    ? `bkr_${rawCaseNum.replace(/[^a-zA-Z0-9]/g, "_")}_${d.court_id || "xx"}`
    : `bkr_cl_${d.id || Date.now()}`;

  // Map CourtListener NOS codes to chapter numbers
  const nosMap = { 70: "7", 71: "11", 72: "12", 73: "13" };
  const chapter = d.chapter || nosMap[d.nature_of_suit] || null;

  // Determine status — check specific discharge/dismiss dates first
  let status = "active";
  if (d.date_discharge) status = "discharged";
  else if (d.date_dismissed) status = "dismissed";
  else if (d.case_status) status = normalizeStatus(d.case_status);

  const primaryDebtor = debtors[0] || {};
  const debtorName = primaryDebtor.lastName
    ? `${primaryDebtor.lastName}, ${primaryDebtor.firstName || ""}`.trim().replace(/,\s*$/, "")
    : (d.case_name || "").replace(/^in\s+re\s*/i, "").trim();

  return {
    id:              stableId,
    caseNumber:      rawCaseNum,
    chapter,
    court:           d.court_id || null,
    dateFiled:       d.date_filed || null,
    disposition:     d.case_status || null,
    status,
    dispositionDate: d.date_discharge || d.date_dismissed || null,
    parties: debtors.map(deb => ({
      role: "debtor",
      name: `${deb.lastName || ""}, ${deb.firstName || ""}`.trim().replace(/,\s*$/, ""),
    })),
    debtorName, // backward compat
    sourceUrl:   d.absolute_url ? `https://www.courtlistener.com${d.absolute_url}` : null,
    source:      "courtlistener",
    ingestedAt:  new Date().toISOString(),
  };
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function syncDateRange(dateFrom, dateTo, clientIndex) {
  let processed = 0, matched = 0, pages = 0;
  const errors = [];
  const clientUpdates = new Map();
  const caseIndex     = new Map();

  let url = `${CL_BASE}/dockets/?court__jurisdiction=B`
    + `&date_filed__gte=${dateFrom}&date_filed__lte=${dateTo}`
    + `&order_by=-date_filed&page_size=${PAGE_SIZE}`;

  while (url && pages < MAX_PAGES) {
    let data;
    try {
      const r = await fetch(url, {
        headers: clHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429) {
        errors.push({ page: pages, error: "Rate limited — try again later or add COURTLISTENER_API_TOKEN" });
        break;
      }
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        errors.push({ page: pages, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
        break;
      }
      data = await r.json();
    } catch (e) {
      errors.push({ page: pages, error: e.message });
      break;
    }

    pages++;
    const results = Array.isArray(data.results) ? data.results : [];

    for (const docket of results) {
      processed++;
      const debtors = extractDebtors(docket.case_name || "");
      if (!debtors.length) continue;

      // Collect best-confidence hit per client across all debtors
      const allHits = new Map();
      for (const debtor of debtors) {
        for (const hit of matchDebtor(debtor, clientIndex)) {
          const existing = allHits.get(hit.clientId);
          if (!existing || (hit.confidence === "high" && existing.confidence === "low")) {
            allHits.set(hit.clientId, hit);
          }
        }
      }
      if (!allHits.size) continue;

      const filing = normalizeDocket(docket, debtors);
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

    url = data.next || null;
    if (url) await new Promise(r => setTimeout(r, 200));
  }

  // Write client updates in batches of 20
  const clientEntries = [...clientUpdates.entries()];
  const WRITE = 20;
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
      const mergedIds = [...new Set([...(existing?.clientIds || []), ...clientIds])];

      await kv.set(
        `${KV_CASE_PREFIX}${caseId}`,
        JSON.stringify({ ...filing, clientIds: mergedIds, matchConfidence: maxConfidence }),
        { ex: CASE_TTL }
      );
      const score = filing.dateFiled ? new Date(filing.dateFiled).getTime() : Date.now();
      await kv.zadd(KV_CASES_ZSET, { score, member: caseId });
    } catch (e) {
      errors.push({ caseId, error: e.message });
    }
  }

  return { processed, matched, pages, errors };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Browse matched cases
  if (req.method === "GET" && req.query?.browse) {
    const page    = Math.max(0, parseInt(req.query?.page || "0"));
    const chapter = req.query?.chapter || null;
    const status  = req.query?.status  || null;
    const total   = await kv.zcard(KV_CASES_ZSET).catch(() => 0);
    const ids     = await kv.zrange(KV_CASES_ZSET, page * 50, page * 50 + 49, { rev: true }).catch(() => []);

    if (!ids.length) return res.status(200).json({ cases: [], total, page, pageSize: 50 });

    let cases = (await Promise.all(ids.map(id => kv.get(`${KV_CASE_PREFIX}${id}`).catch(() => null))))
      .filter(Boolean)
      .map(r => (typeof r === "string" ? JSON.parse(r) : r));

    if (chapter) cases = cases.filter(c => String(c.chapter) === chapter);
    if (status)  cases = cases.filter(c => c.status === status);

    return res.status(200).json({ cases, total, page, pageSize: 50 });
  }

  // Stats
  if (req.method === "GET" && req.query?.stats) {
    const [stats, monthsRaw, cursor] = await Promise.all([
      kv.get(KV_STATS).catch(() => null),
      kv.zrange(KV_MONTHS, 0, -1).catch(() => []),
      kv.get(KV_CURSOR).catch(() => null),
    ]);
    const s = stats ? (typeof stats === "string" ? JSON.parse(stats) : stats) : {};
    return res.status(200).json({
      stats: s,
      monthsSynced: monthsRaw,
      cursor: cursor || null,
      hasApiToken: !!process.env.COURTLISTENER_API_TOKEN,
    });
  }

  // Vercel cron fires as GET ?cron=daily
  if (req.method === "GET" && req.query?.cron === "daily") {
    req = { ...req, method: "POST", body: { mode: "daily" } };
  } else if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { mode = "daily", month, year } = req.body || {};

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

  const clientIndex = await buildClientIndex();
  const started = Date.now();
  const result = await syncDateRange(dateFrom, dateTo, clientIndex).catch(e => ({
    processed: 0, matched: 0, pages: 0, errors: [{ error: e.message }],
  }));

  const ranAt = new Date().toISOString();
  const stats = {
    mode, dateFrom, dateTo,
    processed:  result.processed,
    matched:    result.matched,
    pages:      result.pages,
    errorCount: result.errors.length,
    durationMs: Date.now() - started,
    ranAt,
  };

  await Promise.all([
    kv.set(KV_CURSOR, dateTo, { ex: 400 * 24 * 3600 }).catch(() => {}),
    kv.set(KV_STATS,  JSON.stringify(stats), { ex: 30 * 24 * 3600 }).catch(() => {}),
    mode === "month" && month
      ? kv.zadd(KV_MONTHS, { score: new Date(dateFrom).getTime(), member: month }).catch(() => {})
      : Promise.resolve(),
  ]);

  return res.status(200).json({ ok: true, ...stats, errors: result.errors.slice(0, 10) });
}
