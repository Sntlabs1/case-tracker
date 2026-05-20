// Federal bankruptcy docket lookup via PACER Case Locator (PCL).
//
// GET  /api/bankruptcy-lookup?clientId=xxx
//      Searches all 94 federal bankruptcy courts for filings matching
//      the client's name (+ optional SSN last 4).
//
// POST /api/bankruptcy-lookup  { clientIds: ["c_...", ...] }
//      Batch: runs all clients, writes results back to each KV record.
//
// PACER credentials required (free account at pacer.uscourts.gov):
//   PACER_USERNAME
//   PACER_PASSWORD
//
// The PCL search is free — PACER only charges for document retrieval.
// Auth: OAuth 2.0 password grant → bearer token cached 55 min in KV.
//
// For each client we surface:
//   - All bankruptcy cases (chapter, filing date, district, disposition)
//   - Automatic stay violations: creditors who contacted client AFTER filing
//   - Discharge violations: creditors who continued collecting after discharge
//
// These are independent legal claims worth $1k–$50k+ each.

import { kv } from "@vercel/kv";

const PCL_AUTH   = "https://pacer.login.uscourts.gov/cas/oauth2.0/accessToken";
const PCL_SEARCH = "https://pcl.uscourts.gov/pcl/search/cases/results";
const TOKEN_KEY  = "pacer:token:cache";
const CLIENT_TTL = 365 * 24 * 3600;

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getPacerToken() {
  const cached = await kv.get(TOKEN_KEY).catch(() => null);
  if (cached) return cached;

  const user = process.env.PACER_USERNAME;
  const pass = process.env.PACER_PASSWORD;
  if (!user || !pass) throw new Error("PACER_USERNAME / PACER_PASSWORD not set in env");

  const body = new URLSearchParams({
    grant_type: "password",
    username:   user,
    password:   pass,
    client_id:  "pcl-basic-v1",
  });
  const r = await fetch(PCL_AUTH, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
    signal:  AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PACER auth failed ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const token = data.access_token;
  if (!token) throw new Error("PACER auth returned no access_token");
  // Cache for 55 min (tokens expire after 60 min)
  await kv.set(TOKEN_KEY, token, { ex: 55 * 60 }).catch(() => {});
  return token;
}

// ── PCL search ────────────────────────────────────────────────────────────────

async function searchPCL(firstName, lastName, ssnLast4 = null) {
  const token = await getPacerToken();
  const params = new URLSearchParams({
    lastName,
    firstName,
    court_type: "bk",   // bankruptcy courts only
    page_size:  "50",
  });
  if (ssnLast4) params.set("ssnLast4", ssnLast4);

  const r = await fetch(`${PCL_SEARCH}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal:  AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PACER PCL ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  // PCL returns { results: [...], total: N }
  return Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
}

// ── Stay-violation detector ───────────────────────────────────────────────────
// Returns creditors from the client's collections/accounts who contacted the
// client on or after the bankruptcy filing date → automatic stay violation.

function detectStayViolations(client, bankruptcyFilingDate) {
  if (!bankruptcyFilingDate) return [];
  const filedMs = new Date(bankruptcyFilingDate).getTime();
  const violations = [];

  const allEntries = [
    ...(client.collectionsHistory || []),
    ...(client.creditAccounts    || []),
  ];

  for (const e of allEntries) {
    const contactDates = (e.contactDates || []).filter(d => {
      try { return new Date(d).getTime() >= filedMs; } catch { return false; }
    });
    const lastActivity = e.dateLastActivity || e.dateRange?.end || null;
    const activityAfter = lastActivity && new Date(lastActivity).getTime() >= filedMs;

    if (contactDates.length > 0 || activityAfter) {
      violations.push({
        creditor:    e.creditor || e.originalCreditor || "Unknown",
        contactDates,
        lastActivity: activityAfter ? lastActivity : null,
        accountType: e.accountType || e.type || null,
        claimType:   "Automatic Stay Violation",
        statute:     "11 U.S.C. § 362",
        estimatedValue: "$1,000–$50,000 per violation",
      });
    }
  }
  return violations;
}

// ── Single client lookup ──────────────────────────────────────────────────────

async function lookupClient(clientId) {
  const raw = await kv.get(`client:${clientId}`);
  if (!raw) return { error: "Client not found", clientId };
  const client = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!client.firstName && !client.lastName)
    return { error: "Client has no name to search", clientId };

  let pacerResults = [];
  let pacerError   = null;

  try {
    pacerResults = await searchPCL(
      client.firstName || "",
      client.lastName  || "",
      client.ssnLast4  || null,
    );
  } catch (e) {
    pacerError = e.message;
  }

  // Normalize PCL results into a standard shape
  const filings = pacerResults.map(r => ({
    caseNumber:   r.caseNumber    || r.case_number    || r.caseNo    || "",
    chapter:      r.chapter       || r.chapterNumber  || null,
    filingDate:   r.dateFiled     || r.date_filed     || null,
    disposition:  r.disposition   || r.caseStatus     || null,
    dischargeDate:r.dateDischarge || r.date_discharge || null,
    dismissDate:  r.dateDismissed || r.date_dismissed || null,
    court:        r.court         || r.courtName      || r.district  || null,
    courtId:      r.courtId       || r.court_id       || null,
    debtor:       r.debtor        || `${client.firstName} ${client.lastName}`.trim(),
    sourceUrl:    r.courtId
      ? `https://www.courtlistener.com/?q=${encodeURIComponent(client.lastName)}&type=r&court=${r.courtId}`
      : null,
  }));

  // Merge with credit-report bankruptcies already on the client record
  const creditReportBkr = (client.bankruptcies || []).map(b => ({
    chapter:      b.type?.replace("bankruptcy_ch", "") || null,
    filingDate:   b.dateFiled     || null,
    dischargeDate:b.dateDischarged|| null,
    disposition:  b.disposition   || null,
    source:       "credit_report",
  }));

  // Detect stay violations from the most recent filing
  const latestFiling  = filings.find(f => f.filingDate) || null;
  const stayViolations = detectStayViolations(client, latestFiling?.filingDate);

  const result = {
    clientId,
    name: `${client.firstName || ""} ${client.lastName || ""}`.trim(),
    pacerFilings:    filings,
    creditReportBkr,
    stayViolations,
    hasFilings:      filings.length > 0 || creditReportBkr.length > 0,
    pacerError,
    checkedAt:       new Date().toISOString(),
  };

  // Patch client record with bankruptcy lookup results
  const updated = {
    ...client,
    bankruptcyLookup: result,
    lastBankruptcyCheckAt: result.checkedAt,
  };
  await kv.set(`client:${clientId}`, JSON.stringify(updated), { ex: CLIENT_TTL }).catch(() => {});

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Check env vars first — fail fast with a clear message
  if (!process.env.PACER_USERNAME || !process.env.PACER_PASSWORD) {
    return res.status(503).json({
      error: "PACER credentials not configured",
      setup: "Add PACER_USERNAME and PACER_PASSWORD to your Vercel environment variables. Free account at pacer.uscourts.gov",
    });
  }

  // Single client GET
  if (req.method === "GET") {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    try {
      const result = await lookupClient(clientId);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Batch POST
  if (req.method === "POST") {
    const { clientIds } = req.body || {};
    if (!Array.isArray(clientIds) || !clientIds.length)
      return res.status(400).json({ error: "clientIds array required" });

    const results = [];
    let withFilings = 0, errors = 0;

    for (const id of clientIds.slice(0, 100)) { // cap at 100 per call
      try {
        const r = await lookupClient(id);
        results.push(r);
        if (r.hasFilings) withFilings++;
        if (r.pacerError) errors++;
      } catch (e) {
        results.push({ clientId: id, error: e.message });
        errors++;
      }
      // Small delay to avoid PACER rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    return res.status(200).json({ total: results.length, withFilings, errors, results });
  }

  return res.status(405).end();
}
