// CourtListener docket fetcher.
//
// API: https://www.courtlistener.com/api/rest/v4/dockets/
// Auth: Token <COURTLISTENER_API_TOKEN> (free tier; 5000 req/hr).
//
// Query strategy per case-type:
//   TCPA  → nature_of_suit=890 with cause filter for "227" (47 U.S.C. § 227)
//   FDCPA → nature_of_suit=480 with cause filter for "1692" (15 U.S.C. § 1692)
//   FCRA  → nature_of_suit=480 with cause filter for "1681" (15 U.S.C. § 1681)
//
// Modes:
//   backfill — paginate from `since` (default 2021-01-01) forward to today
//   daily    — pull cases filed since cursor (last successful run)

import { kv } from "@vercel/kv";
import { fromCourtListener } from "../../src/lib/tcpaIngestNormalize.js";

// CourtListener v4 SEARCH API (Solr-backed) — much faster than the raw
// /dockets/ resource for filtered queries. /dockets/ with a date_filed range
// over NOS=890 (TCPA) repeatedly times out at the upstream gateway with 504s.
//
// Search params:
//   type=r              RECAP docket search
//   q                   Solr query (e.g. `cause:227 AND nature_of_suit:890`)
//   filed_after         YYYY-MM-DD inclusive
//   filed_before        YYYY-MM-DD inclusive
//   order_by            dateFiled desc | dateFiled asc
//   page_size           up to 100
const BASE = "https://www.courtlistener.com/api/rest/v4/search/";

// CourtListener's REST API whitelists filter params and rejects unknown ones
// (e.g. `cause__icontains` is not allowed on the dockets endpoint). We filter
// by `nature_of_suit` server-side and refine by the `cause` field client-side
// inside fromCourtListener() / detectCaseType().
//
// One Solr query per case type. CourtListener's RECAP-docket Solr index
// indexes the cause field as plain text — quoted phrase search hits the
// statute citation pattern best. NOS code is a string field.
const SEARCH_QUERIES = {
  TCPA:  '"Telephone Consumer Protection" OR "47:227"',
  FDCPA: '"Fair Debt Collection" OR "15:1692"',
  FCRA:  '"Fair Credit Reporting" OR "15:1681"',
};

function authHeaders() {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) throw new Error("COURTLISTENER_API_TOKEN not set");
  return { Authorization: `Token ${token}` };
}

function buildUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${BASE}?${qs}`;
}

// Fetch one page. Honors Retry-After on 429s by sleeping then retrying once.
// Returns { results, next, count }.
async function fetchPage(url, attempt = 0) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 429 && attempt < 1) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "5", 10);
    await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
    return fetchPage(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CourtListener ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (process.env.TCPA_INGEST_DEBUG) {
    console.log(`[courtlistener] ${url}\n  count=${data.count} results=${(data.results || []).length}`);
    if (data.results?.[0]) console.log(`  sample keys=${Object.keys(data.results[0]).slice(0, 20).join(",")}`);
  }
  return data;
}

// Walk paginated search results for one (caseType, since, until) window.
// Uses the v4 Solr search API at /search/?type=r — much faster than the raw
// /dockets/ resource for filtered queries.
export async function fetchDockets({ caseType, since, until = null, maxPages = 50, onBatch }) {
  const q = SEARCH_QUERIES[caseType];
  if (!q) throw new Error(`Unknown caseType '${caseType}'`);

  const params = {
    type: "r",          // RECAP docket search
    q,
    order_by: "dateFiled desc",
    page_size: "100",
  };
  if (since) params.filed_after = since;
  if (until) params.filed_before = until;

  let url = buildUrl(params);
  let pages = 0;
  let total = 0;
  let discarded = 0;

  while (url && pages < maxPages) {
    const page = await fetchPage(url);
    const normalized = [];
    for (const d of page.results || []) {
      // The search query already constrained on caseType — pass it to the
      // normalizer so cases without "TCPA" in the cause field still get tagged.
      const rec = fromCourtListener(d, { assumeCaseType: caseType });
      if (!rec) { discarded++; continue; }
      normalized.push(rec);
    }
    total += normalized.length;
    if (onBatch && normalized.length) await onBatch(normalized);
    url = page.next;
    pages++;
  }

  return { pages, total, discarded };
}

// High-level entrypoint. Returns aggregated stats for one source run.
// `importer(records)` is the caller-provided write fn — typically importCases().
export async function runCourtListener({
  caseTypes = ["TCPA", "FDCPA", "FCRA"],
  mode = "daily",
  since = null,
  importer,
}) {
  if (!importer) throw new Error("runCourtListener requires importer fn");

  const cursorKey = "tcpa:ingest:courtlistener:cursor";
  let windowStart = since;
  if (!windowStart) {
    if (mode === "backfill") {
      windowStart = "2021-01-01";
    } else {
      const cursor = await kv.get(cursorKey).catch(() => null);
      // Daily delta: from cursor (or yesterday if first run) to now.
      windowStart = cursor || new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }
  const today = new Date().toISOString().slice(0, 10);

  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0, totalErrors = 0, totalDiscarded = 0;
  const partialErrors = [];

  for (const caseType of caseTypes) {
    if (!SEARCH_QUERIES[caseType]) continue;
    try {
      const result = await fetchDockets({
        caseType,
        since: windowStart,
        until: today,
        maxPages: mode === "backfill" ? 200 : 10,
        onBatch: async (records) => {
          const r = await importer(records);
          totalCreated += r.created;
          totalUpdated += r.updated;
          totalUnchanged += r.unchanged;
          totalErrors += r.errors.length;
        },
      });
      totalDiscarded += result.discarded || 0;
    } catch (e) {
      // Keep any partial progress already accumulated; record the failure.
      partialErrors.push({ caseType, error: e.message });
      totalErrors++;
    }
  }

  // Advance cursor only on success.
  await kv.set(cursorKey, today, { ex: 365 * 24 * 3600 }).catch(() => {});
  await kv.set("tcpa:ingest:courtlistener:stats", JSON.stringify({
    ranAt: new Date().toISOString(),
    mode,
    windowStart,
    windowEnd: today,
    caseTypes,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    discarded: totalDiscarded,
    errors: totalErrors,
  }), { ex: 30 * 24 * 3600 }).catch(() => {});

  return {
    source: "courtlistener",
    mode,
    windowStart,
    windowEnd: today,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    discarded: totalDiscarded,
    errors: totalErrors,
    partialErrors: partialErrors.length ? partialErrors : undefined,
  };
}
