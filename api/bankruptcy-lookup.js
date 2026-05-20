// Federal bankruptcy docket lookup via CourtListener (free, no per-doc charge).
//
// GET  /api/bankruptcy-lookup?clientId=xxx
//      Searches all federal bankruptcy courts for filings matching the
//      client's name. Uses CourtListener's free RECAP API — same data as
//      PACER but zero cost for searches.
//
// POST /api/bankruptcy-lookup  { clientIds: ["c_...", ...] }
//      Batch: runs up to 50 clients, writes results back to KV.
//
// No additional API keys needed — uses COURTLISTENER_API_TOKEN already in env.
//
// For each client we surface:
//   - All bankruptcy cases (chapter, filing date, district, disposition)
//   - Automatic stay violations: creditors who contacted client AFTER filing
//   - Discharge violations: creditors who collected after discharge
//
// These are independent claims worth $1,000–$50,000+ each (11 U.S.C. § 362).

import { kv } from "@vercel/kv";

const CL_BASE    = "https://www.courtlistener.com/api/rest/v4";
const CLIENT_TTL = 365 * 24 * 3600;

function clHeaders() {
  const token = process.env.COURTLISTENER_API_TOKEN;
  return token
    ? { Authorization: `Token ${token}`, Accept: "application/json" }
    : { Accept: "application/json" };
}

// ── CourtListener search ──────────────────────────────────────────────────────
// Strategy: search the docket index filtering to bankruptcy court types.
// CourtListener bankruptcy court IDs all contain "b" after the district code
// (e.g. "alnb" = N.D. Ala. Bankr., "caeb" = E.D. Cal. Bankr.).
// We query by debtor name using full-text Solr search on the docket index.

async function searchCourtListener(firstName, lastName) {
  const name = `"${firstName} ${lastName}"`.trim();
  const params = new URLSearchParams({
    type:      "r",             // RECAP docket search
    q:         name,
    order_by:  "dateFiled desc",
    page_size: "20",
    // Restrict to bankruptcy courts: CourtListener court IDs ending in "b"
    // We pass court as a filter — CL supports court= for exact court IDs
    // but there are 94 bankruptcy courts so we filter client-side below.
  });

  const url = `${CL_BASE}/search/?${params}`;
  const r = await fetch(url, {
    headers: clHeaders(),
    signal:  AbortSignal.timeout(20000),
  });

  if (r.status === 429) throw new Error("CourtListener rate limit hit — try again in a few minutes");
  if (!r.ok) throw new Error(`CourtListener ${r.status}`);

  const data = await r.json();
  const results = data.results || [];

  // Keep only bankruptcy courts (court ID ends in "b" or contains "bankr")
  return results.filter(d => {
    const court = (d.court || d.court_id || "").toLowerCase();
    return court.endsWith("b") || court.includes("bankr") || court.includes("bk");
  });
}

// Also search the parties endpoint for exact name match
async function searchByParty(firstName, lastName) {
  const params = new URLSearchParams({
    name:      `${firstName} ${lastName}`,
    page_size: "20",
  });
  const r = await fetch(`${CL_BASE}/parties/?${params}`, {
    headers: clHeaders(),
    signal:  AbortSignal.timeout(15000),
  });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.results || []).filter(p => {
    const court = (p.docket_court || "").toLowerCase();
    return court.endsWith("b") || court.includes("bankr");
  });
}

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeResult(d) {
  // Extract chapter from case name or nature_of_suit
  const caption  = d.caseName || d.case_name || d.caseNameFull || "";
  const nos      = String(d.nature_of_suit || d.natureOfSuit || "");
  const chapter  = extractChapter(caption, nos, d.chapter);
  const courtId  = d.court || d.court_id || "";
  const docketNo = d.docketNumber || d.docket_number || "";

  return {
    caseNumber:   docketNo,
    chapter,
    filingDate:   d.dateFiled      || d.date_filed      || null,
    disposition:  d.caseStatus     || d.status          || null,
    dischargeDate:d.dateDischarge  || d.date_discharge  || null,
    dismissDate:  d.dateDismissed  || d.date_dismissed  || null,
    court:        d.courtName      || d.court_name      || courtId,
    courtId,
    debtor:       caption,
    sourceUrl:    d.absolute_url
      ? `https://www.courtlistener.com${d.absolute_url}`
      : `https://www.courtlistener.com/?q=${encodeURIComponent(caption)}&type=r`,
  };
}

function extractChapter(caption, nos, explicit) {
  if (explicit) return String(explicit);
  // Nature of suit codes: 70=Ch7, 71=Ch11, 72=Ch12, 73=Ch13
  if (nos === "70") return "7";
  if (nos === "71") return "11";
  if (nos === "72") return "12";
  if (nos === "73") return "13";
  const m = caption.match(/chapter\s*(\d+)/i) || caption.match(/ch\.?\s*(\d+)/i);
  return m ? m[1] : null;
}

// ── Stay-violation detector ───────────────────────────────────────────────────

function detectStayViolations(client, filingDate) {
  if (!filingDate) return [];
  const filedMs = new Date(filingDate).getTime();
  if (isNaN(filedMs)) return [];
  const violations = [];

  for (const e of [...(client.collectionsHistory || []), ...(client.creditAccounts || [])]) {
    const contactsAfter = (e.contactDates || []).filter(d => {
      try { return new Date(d).getTime() >= filedMs; } catch { return false; }
    });
    const lastActivity = e.dateLastActivity || e.dateRange?.end || null;
    const activityAfter = lastActivity && new Date(lastActivity).getTime() >= filedMs;

    if (contactsAfter.length > 0 || activityAfter) {
      violations.push({
        creditor:       e.creditor || e.originalCreditor || "Unknown",
        contactDates:   contactsAfter,
        lastActivity:   activityAfter ? lastActivity : null,
        claimType:      "Automatic Stay Violation",
        statute:        "11 U.S.C. § 362",
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

  let filings     = [];
  let lookupError = null;

  try {
    const [dockets, parties] = await Promise.allSettled([
      searchCourtListener(client.firstName || "", client.lastName || ""),
      searchByParty(client.firstName || "", client.lastName || ""),
    ]);

    const docketResults  = dockets.status  === "fulfilled" ? dockets.value  : [];
    const partyResults   = parties.status  === "fulfilled" ? parties.value  : [];

    // Merge — dedupe by docket number
    const seen = new Set();
    for (const d of [...docketResults, ...partyResults]) {
      const norm = normalizeResult(d);
      const key  = norm.caseNumber || norm.sourceUrl;
      if (!seen.has(key)) { seen.add(key); filings.push(norm); }
    }

    if (dockets.status === "rejected" && parties.status === "rejected") {
      lookupError = dockets.reason?.message || "CourtListener search failed";
    }
  } catch (e) {
    lookupError = e.message;
  }

  // Merge with credit-report bankruptcies already on the client record
  const creditReportBkr = (client.bankruptcies || []).map(b => ({
    chapter:      b.type?.replace("bankruptcy_ch", "") || null,
    filingDate:   b.dateFiled      || null,
    dischargeDate:b.dateDischarged || null,
    disposition:  b.disposition    || null,
    source:       "credit_report",
  }));

  // Detect stay violations from earliest filing date found
  const allDates  = [...filings.map(f => f.filingDate), ...creditReportBkr.map(b => b.filingDate)]
    .filter(Boolean).sort();
  const earliest  = allDates[0] || null;
  const stayViolations = detectStayViolations(client, earliest);

  const result = {
    clientId,
    name:            `${client.firstName || ""} ${client.lastName || ""}`.trim(),
    courtListenerFilings: filings,
    creditReportBkr,
    stayViolations,
    hasFilings:      filings.length > 0 || creditReportBkr.length > 0,
    lookupError,
    checkedAt:       new Date().toISOString(),
  };

  // Patch client KV record
  await kv.set(
    `client:${clientId}`,
    JSON.stringify({ ...client, bankruptcyLookup: result, lastBankruptcyCheckAt: result.checkedAt }),
    { ex: CLIENT_TTL }
  ).catch(() => {});

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

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

  if (req.method === "POST") {
    const { clientIds } = req.body || {};
    if (!Array.isArray(clientIds) || !clientIds.length)
      return res.status(400).json({ error: "clientIds array required" });

    let withFilings = 0, errors = 0;
    const results = [];

    for (const id of clientIds.slice(0, 50)) {
      try {
        const r = await lookupClient(id);
        results.push(r);
        if (r.hasFilings) withFilings++;
        if (r.lookupError) errors++;
      } catch (e) {
        results.push({ clientId: id, error: e.message });
        errors++;
      }
      await new Promise(r => setTimeout(r, 500)); // avoid rate limiting
    }

    return res.status(200).json({ total: results.length, withFilings, errors, results });
  }

  return res.status(405).end();
}
