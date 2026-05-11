// Trellis.law API integration — secondary state-court source. Stronger
// coverage in states UniCourt misses (WV, MS, AL, NM, the Dakotas).
//
// Endpoint: https://api.trellis.law/v1/cases  (placeholder; confirm with
//           Trellis sales rep — they have multiple endpoint shapes).
// Auth:     TRELLIS_API_KEY env var

import { kv } from "@vercel/kv";

const BASE = "https://api.trellis.law/v1/cases";

const QUERIES = [
  { caseType: "TCPA",  q: "47 USC 227 OR Telephone Consumer Protection" },
  { caseType: "FDCPA", q: "15 USC 1692 OR Fair Debt Collection"         },
  { caseType: "FCRA",  q: "15 USC 1681 OR Fair Credit Reporting"        },
];

function authHeaders() {
  const key = process.env.TRELLIS_API_KEY;
  if (!key) throw new Error("TRELLIS_API_KEY not set");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

function mapStatus(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("settle")) return "settled";
  if (s.includes("dismiss")) return "dismissed";
  if (s.includes("closed") || s.includes("disposed")) return "claim_closed";
  return "active";
}

function fromTrellis(c, caseType) {
  const state = (c.state || c.jurisdiction || "").toUpperCase().slice(0, 2);
  const defendants = (c.defendants || c.parties_defendant || [])
    .map((p) => (typeof p === "string" ? p : p.name))
    .filter(Boolean);

  return {
    id: `tr_${c.id || c.case_id}`,
    caption: c.case_name || c.title || `${c.case_number || ""} (${c.court || ""})`.trim(),
    caseType,
    defendants,
    court: {
      name: c.court || c.court_name || "",
      jurisdiction: "state",
      state,
      district: "",
      docket: c.case_number || "",
      citation: "",
    },
    filingDate: c.filed_date || c.filing_date || null,
    lastDocketDate: c.last_activity_date || null,
    status: mapStatus(c.status || c.case_status),
    conductDescription: c.cause || "",
    geographicScope: "state",
    eligibleStates: state ? [state] : [],
    source: "trellis",
    sourceUrl: c.url || "",
  };
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Trellis ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

async function runOneQuery({ caseType, q, since, until, maxPages, onBatch }) {
  const params = new URLSearchParams({
    q,
    filed_after: since,
    filed_before: until,
    limit: "100",
  });
  let url = `${BASE}?${params.toString()}`;
  let pages = 0;
  let total = 0;

  while (url && pages < maxPages) {
    const page = await fetchPage(url);
    const records = (page.results || page.cases || page.data || [])
      .map((c) => fromTrellis(c, caseType))
      .filter(Boolean);
    total += records.length;
    if (onBatch && records.length) await onBatch(records);
    url = page.next || page.links?.next || null;
    pages++;
  }

  return { pages, total };
}

export async function runTrellis({
  caseTypes = ["TCPA", "FDCPA", "FCRA"],
  mode = "daily",
  since = null,
  importer,
}) {
  if (!importer) throw new Error("runTrellis requires importer fn");

  const cursorKey = "tcpa:ingest:trellis:cursor";
  let windowStart = since;
  if (!windowStart) {
    if (mode === "backfill") {
      windowStart = "2021-01-01";
    } else {
      const cursor = await kv.get(cursorKey).catch(() => null);
      windowStart = cursor || new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }
  const today = new Date().toISOString().slice(0, 10);

  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0, totalErrors = 0;

  for (const q of QUERIES) {
    if (!caseTypes.includes(q.caseType)) continue;
    try {
      await runOneQuery({
        caseType: q.caseType,
        q: q.q,
        since: windowStart,
        until: today,
        maxPages: mode === "backfill" ? 500 : 20,
        onBatch: async (records) => {
          const r = await importer(records);
          totalCreated += r.created;
          totalUpdated += r.updated;
          totalUnchanged += r.unchanged;
          totalErrors += r.errors.length;
        },
      });
    } catch (e) {
      totalErrors++;
    }
  }

  await kv.set(cursorKey, today, { ex: 365 * 24 * 3600 }).catch(() => {});
  await kv.set("tcpa:ingest:trellis:stats", JSON.stringify({
    ranAt: new Date().toISOString(),
    mode,
    windowStart,
    windowEnd: today,
    caseTypes,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  }), { ex: 30 * 24 * 3600 }).catch(() => {});

  return {
    source: "trellis",
    mode,
    windowStart,
    windowEnd: today,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  };
}
