// FCC Consumer Complaints (Socrata API) — demand-signal layer.
//
// Endpoint: https://opendata.fcc.gov/resource/sr6c-syda.json
// Auth:     none required (anonymous works; X-App-Token raises rate limits)
// Doc:      https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj
//
// Aggregates "Unwanted Calls" complaints by US state, written to
// `tcpa:fcc:state:${ST}` for the TCPACases tab heatmap. Not cases; pure signal.

import { kv } from "@vercel/kv";

const BASE = "https://opendata.fcc.gov/resource/sr6c-syda.json";
const PAGE_SIZE = 5000;

function authHeaders() {
  const token = process.env.FCC_APP_TOKEN; // optional
  return token ? { "X-App-Token": token } : {};
}

// Aggregate one date window. Returns { byState: { CA: 1234, ... }, total }.
async function fetchAggregate({ since, until }) {
  // Socrata supports SoQL — pull just (state, issue) for unwanted-calls topic.
  const where = `issue like '%Unwanted%' AND ticket_created >= '${since}T00:00:00' AND ticket_created < '${until}T00:00:00'`;
  const params = new URLSearchParams({
    $select: "state, count(*) as ct",
    $where: where,
    $group: "state",
    $limit: String(PAGE_SIZE),
  });
  const url = `${BASE}?${params.toString()}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FCC ${res.status}: ${body.slice(0, 200)}`);
  }
  const rows = await res.json();
  const byState = {};
  let total = 0;
  for (const r of rows) {
    const st = String(r.state || "").toUpperCase().slice(0, 2);
    const ct = Number(r.ct || 0);
    if (!st || !ct) continue;
    byState[st] = (byState[st] || 0) + ct;
    total += ct;
  }
  return { byState, total };
}

export async function runFccComplaints({ mode = "daily", since: sinceOverride } = {}) {
  const cursorKey = "tcpa:ingest:fcc:cursor";
  const cursor = await kv.get(cursorKey).catch(() => null);
  const since = sinceOverride
    ? sinceOverride
    : (mode === "backfill"
        ? "2021-01-01"
        : (cursor || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)));
  const until = new Date().toISOString().slice(0, 10);

  const { byState, total } = await fetchAggregate({ since, until });

  // Replace per-state totals (cumulative count over `since` → `until`).
  // For backfill we set; for daily delta we increment.
  const ops = [];
  for (const [st, ct] of Object.entries(byState)) {
    if (mode === "backfill") {
      ops.push(kv.set(`tcpa:fcc:state:${st}`, ct, { ex: 60 * 24 * 3600 }));
    } else {
      ops.push(kv.incrby(`tcpa:fcc:state:${st}`, ct).catch(() => {}));
    }
  }
  await Promise.all(ops);

  await kv.set(cursorKey, until, { ex: 365 * 24 * 3600 }).catch(() => {});
  await kv.set("tcpa:ingest:fcc:stats", JSON.stringify({
    ranAt: new Date().toISOString(),
    mode,
    windowStart: since,
    windowEnd: until,
    statesCovered: Object.keys(byState).length,
    totalComplaints: total,
  }), { ex: 30 * 24 * 3600 }).catch(() => {});

  return {
    source: "fcc",
    mode,
    windowStart: since,
    windowEnd: until,
    statesCovered: Object.keys(byState).length,
    totalComplaints: total,
  };
}
