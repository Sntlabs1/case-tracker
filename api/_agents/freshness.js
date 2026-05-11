// Freshness agent — pre-computes platform-wide aggregates into one KV blob
// so the UI never has to scan full case/lead lists to render counts and
// "last updated" indicators.
//
// Output → `agent:freshness:rollup` (read by Dashboard / TCPA / Trends tabs)

import { kv } from "@vercel/kv";
import { KEYS, CASE_STATUSES, CASE_TYPES } from "../../src/lib/tcpaSchema.js";

const ROLLUP_KEY = "agent:freshness:rollup";
const SOURCES = ["courtlistener", "tcpaworld", "classaction", "unicourt", "trellis", "fcc"];

function isoWeek(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function daysBetween(a, b) {
  return Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

async function readJson(key) {
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

async function aggregateTcpaCases() {
  // Count by status — cheap zset cardinality reads.
  const byStatus = {};
  await Promise.all(CASE_STATUSES.map(async (s) => {
    byStatus[s] = (await kv.zcard(KEYS.byStatus(s)).catch(() => 0)) || 0;
  }));
  const total = (await kv.zcard(KEYS.byFilingDate()).catch(() => 0)) || 0;

  // For byType + bySource we need to read records — paginate so we don't
  // explode memory on large sets. Cap the scan; precision over speed
  // doesn't matter for headline counts.
  const ids = await kv.zrange(KEYS.byFilingDate(), 0, 4999, { rev: true }).catch(() => []);
  const byType = {};
  const bySource = {};
  let totalFundDollars = 0;
  const closingSoon = [];
  const now = Date.now();

  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = await Promise.all(
      ids.slice(i, i + BATCH).map((id) => kv.get(KEYS.case(id)))
    );
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      byType[c.caseType] = (byType[c.caseType] || 0) + 1;
      bySource[c.source || "unknown"] = (bySource[c.source || "unknown"] || 0) + 1;

      // Settlement fund parsing — accommodate both numeric (raw dollars) and
      // string formats ("$1.2B", "20 million", "$500,000"). Heuristics:
      //   - Pure number ≥ 1000  → assume raw dollars as-is
      //   - String with "billion"/"b" → × 1e9
      //   - String with "million"/"m" → × 1e6
      //   - String with "thousand"/"k" → × 1e3
      //   - Pure number < 1000 → assume millions (legacy convention)
      //   - Pure number < 0.001 (e.g., "0.5") with no suffix → millions
      const fundRaw = c.settlement?.totalFund;
      if (fundRaw != null) {
        if (typeof fundRaw === "number" && isFinite(fundRaw) && fundRaw > 0) {
          totalFundDollars += fundRaw >= 1000 ? fundRaw : fundRaw * 1_000_000;
        } else if (typeof fundRaw === "string" && fundRaw.trim()) {
          const s = fundRaw.trim();
          const m = s.match(/[\d.,]+/);
          if (m) {
            const n = parseFloat(m[0].replace(/,/g, ""));
            if (isFinite(n) && n > 0) {
              const lower = s.toLowerCase();
              let mult = 1;
              if (/billion|\bb\b/.test(lower))      mult = 1_000_000_000;
              else if (/million|\bm\b/.test(lower)) mult = 1_000_000;
              else if (/thousand|\bk\b/.test(lower)) mult = 1_000;
              else if (n < 1000)                    mult = 1_000_000; // bare small number → millions
              totalFundDollars += n * mult;
            }
          }
        }
      }

      // Closing-soon list (claim window ≤ 30 days)
      const closes = c.settlement?.claimWindowCloses;
      if (closes) {
        const days = Math.ceil((new Date(closes).getTime() - now) / 86400000);
        if (days >= 0 && days <= 30) {
          closingSoon.push({ id: c.id, caption: c.caption, daysLeft: days });
        }
      }
    }
  }
  closingSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  return { total, byType, byStatus, bySource, totalFundDollars, closingSoon };
}

async function aggregateLeads() {
  // Score-band counts via zcount on the leads_by_score zset.
  const total = (await kv.zcard("leads_by_score").catch(() => 0)) || 0;
  const high  = (await kv.zcount("leads_by_score", 75, 100).catch(() => 0)) || 0;
  const mid   = (await kv.zcount("leads_by_score", 50, 74).catch(() => 0)) || 0;
  const low   = (await kv.zcount("leads_by_score", 0, 49).catch(() => 0)) || 0;

  // High-priority watchlist — top 10 by score.
  const ids = await kv.zrange("leads_by_score", 0, 9, { rev: true }).catch(() => []);
  const highPriority = [];
  for (const id of ids) {
    const raw = await kv.get(`lead:${id}`).catch(() => null);
    if (!raw) continue;
    const l = typeof raw === "string" ? JSON.parse(raw) : raw;
    const score = l.analysis?.score || 0;
    if (score < 70) break; // sorted desc, we can stop
    highPriority.push({
      leadId: l.id,
      score,
      headline: (l.analysis?.headline || l.title || "").slice(0, 140),
    });
  }

  return { total, high, mid, low, highPriority };
}

async function aggregateClients() {
  const total = (await kv.zcard("clients_by_date").catch(() => 0)) || 0;
  // Retainer breakdown is not indexed — quick sample of recent clients only.
  const ids = await kv.zrange("clients_by_date", 0, 999, { rev: true }).catch(() => []);
  const byRetainer = {};
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = await Promise.all(ids.slice(i, i + BATCH).map((id) => kv.get(`client:${id}`)));
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      const r = c.retainerStatus || "Uncontacted";
      byRetainer[r] = (byRetainer[r] || 0) + 1;
    }
  }
  return { total, byRetainer };
}

async function aggregateDefendants() {
  const total = (await kv.zcard("tcpa:defendants_index").catch(() => 0)) || 0;
  // Top 10 by case-count: scan defendant index, read byDefendant zsets.
  const ids = await kv.zrange("tcpa:defendants_index", 0, 199).catch(() => []);
  const counts = await Promise.all(ids.map(async (id) => {
    const c = (await kv.zcard(KEYS.byDefendant(id)).catch(() => 0)) || 0;
    return { id, c };
  }));
  counts.sort((a, b) => b.c - a.c);
  const topIds = counts.slice(0, 10);
  const top10 = await Promise.all(topIds.map(async ({ id, c }) => {
    const raw = await kv.get(`tcpa:defendant:${id}`).catch(() => null);
    if (!raw) return { canonicalId: id, displayName: id, caseCount: c };
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { canonicalId: id, displayName: d.displayName || id, caseCount: c };
  }));
  return { total, top10 };
}

async function aggregateFcc() {
  // Per-state heatmap — single MGET pattern would be cleaner; here we read
  // the 50 state keys directly.
  const states = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
  const byState = {};
  let total = 0;
  await Promise.all(states.map(async (st) => {
    const v = await kv.get(`tcpa:fcc:state:${st}`).catch(() => null);
    if (v != null) {
      const n = Number(v) || 0;
      byState[st] = n;
      total += n;
    }
  }));
  return { total, byState };
}

async function aggregateLastUpdated() {
  const last_scan = await readJson("last_scan");
  const perSource = {};
  let mostRecentTcpaIngest = null;
  for (const s of SOURCES) {
    const stats = await readJson(`tcpa:ingest:${s}:stats`);
    if (stats?.ranAt) {
      perSource[s] = stats.ranAt;
      if (!mostRecentTcpaIngest || new Date(stats.ranAt) > new Date(mostRecentTcpaIngest)) {
        mostRecentTcpaIngest = stats.ranAt;
      }
    } else {
      perSource[s] = null;
    }
  }
  return {
    tcpaCases: mostRecentTcpaIngest,
    leads: last_scan?.timestamp || null,
    perSource,
  };
}

// Scan health — was the daily scanner ([api/scan.js]) actually firing?
// `last_scan` has a 7-day TTL, so it can be null even when scans happened
// recently — fall back to scan_history (last 90 entries, no TTL).
async function aggregateScanHealth() {
  const last = await readJson("last_scan");
  const history = await kv.lrange("scan_history", 0, 89).catch(() => []);
  const parsed = history
    .map((x) => (typeof x === "string" ? JSON.parse(x) : x))
    .filter((x) => x?.timestamp);

  const lastScanAt = last?.timestamp || parsed[0]?.timestamp || null;
  const now = Date.now();
  const daysSince = lastScanAt
    ? Math.floor((now - new Date(lastScanAt).getTime()) / 86400000)
    : null;

  // Separate fetch and analyze run counts (the new split-scan world).
  const cutoff7 = now - 7 * 86400000;
  const cutoff30 = now - 30 * 86400000;
  let runsLast7 = 0, runsLast30 = 0;
  let fetchRunsLast7 = 0, analyzeRunsLast7 = 0;
  for (const e of parsed) {
    const t = new Date(e.timestamp).getTime();
    if (t >= cutoff7) {
      runsLast7++;
      if (e.mode === "fetch") fetchRunsLast7++;
      else if (e.mode === "analyze") analyzeRunsLast7++;
    }
    if (t >= cutoff30) runsLast30++;
  }

  // Items waiting for deep analysis. A growing queue means fetch works but
  // analyze isn't keeping up; an empty queue + recent fetch means we're caught up.
  const analysisQueueDepth = (await kv.zcard("scan:analysis_queue").catch(() => 0)) || 0;

  let status = "broken";
  if (daysSince === null) status = "broken";
  else if (daysSince <= 1) status = "ok";
  else if (daysSince <= 3) status = "stale";

  return {
    lastScanAt,
    lastScanMode: last?.mode || null,
    daysSince,
    runsLast7,
    runsLast30,
    fetchRunsLast7,
    analyzeRunsLast7,
    expectedRunsLast7: 7,
    expectedRunsLast30: 30,
    expectedFetchRunsLast7: 21,   // 3x daily
    expectedAnalyzeRunsLast7: 168, // hourly
    analysisQueueDepth,
    status,
    recentRuns: parsed.slice(0, 10).map((e) => ({
      timestamp: e.timestamp,
      mode: e.mode || "full",
      processed: e.processed ?? null,
      queued: e.queuedForAnalysis ?? null,
      queueDepthAfter: e.queueDepthAfter ?? null,
    })),
  };
}

async function aggregateStaleSources(perSource) {
  const now = Date.now();
  const stale = [];
  for (const [source, ranAt] of Object.entries(perSource)) {
    if (!ranAt) continue; // never-run sources are tracked separately by the UI
    const ageHours = Math.round((now - new Date(ranAt).getTime()) / 3_600_000);
    if (ageHours > 24) stale.push({ source, ranAt, ageHours });
  }
  return stale;
}

async function aggregateTrends() {
  // Cases-per-week: bucket the last 12 ISO weeks from the filing-date zset.
  const now = Date.now();
  const cutoff = now - 12 * 7 * 86400000;
  const weeks = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(now - i * 7 * 86400000);
    weeks[isoWeek(d)] = { week: isoWeek(d), TCPA: 0, FDCPA: 0, FCRA: 0, "TCPA+FDCPA": 0 };
  }

  // Pull every case filed in the last 12 weeks (zrangebyscore by epoch).
  const ids = await kv.zrange(KEYS.byFilingDate(), cutoff, now, { byScore: true }).catch(() => []);
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = await Promise.all(ids.slice(i, i + BATCH).map((id) => kv.get(KEYS.case(id))));
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!c.filingDate) continue;
      const w = isoWeek(c.filingDate);
      if (weeks[w] && weeks[w][c.caseType] !== undefined) {
        weeks[w][c.caseType]++;
      }
    }
  }
  const casesPerWeek = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));

  // Leads-per-day from `daily_stats:${date}` — last 30 days.
  const leadsPerDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const dateKey = d.toISOString().slice(0, 10);
    const stats = await kv.hgetall(`daily_stats:${dateKey}`).catch(() => null);
    if (stats) {
      leadsPerDay.push({
        date: dateKey,
        total: Number(stats.leads_total || 0),
        high: Number(stats.high_priority || 0),
      });
    }
  }

  // Top new defendants — defendants with the most cases filed in last 30 days.
  const newCutoff = now - 30 * 86400000;
  const newIds = await kv.zrange(KEYS.byFilingDate(), newCutoff, now, { byScore: true }).catch(() => []);
  const counts = {};
  const names = {};
  for (let i = 0; i < newIds.length; i += BATCH) {
    const batch = await Promise.all(newIds.slice(i, i + BATCH).map((id) => kv.get(KEYS.case(id))));
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      for (const d of (c.defendants || [])) {
        if (!d.canonicalId) continue;
        counts[d.canonicalId] = (counts[d.canonicalId] || 0) + 1;
        names[d.canonicalId] = d.displayName;
      }
    }
  }
  const topNewDefendants = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, n]) => ({ canonicalId: id, name: names[id] || id, newCases: n, windowDays: 30 }));

  return { casesPerWeek, leadsPerDay, topNewDefendants };
}

// ── Agent ───────────────────────────────────────────────────────────────────

export default {
  name: "freshness",
  description: "Aggregates case/lead/client counts, trends, and last-updated timestamps platform-wide. Read by the Dashboard, TCPA, and Trends tabs to render instantly without scanning full datasets.",
  schedule: "0 * * * *", // hourly

  async run() {
    const startedAt = Date.now();

    const [tcpaCases, leads, clients, defendants, fccComplaints, lastUpdated] =
      await Promise.all([
        aggregateTcpaCases(),
        aggregateLeads(),
        aggregateClients(),
        aggregateDefendants(),
        aggregateFcc(),
        aggregateLastUpdated(),
      ]);

    const trends = await aggregateTrends();
    const staleSources = await aggregateStaleSources(lastUpdated.perSource);
    const scanHealth = await aggregateScanHealth();

    const rollup = {
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      counts: {
        tcpaCases: {
          total: tcpaCases.total,
          byType: tcpaCases.byType,
          byStatus: tcpaCases.byStatus,
          bySource: tcpaCases.bySource,
          // Sum of disclosed settlement funds in dollars across all cases.
          totalFundDollars: Math.round(tcpaCases.totalFundDollars),
        },
        leads: {
          total: leads.total,
          high: leads.high,
          mid: leads.mid,
          low: leads.low,
        },
        clients,
        defendants,
        fccComplaints,
        kbCases: 165, // hand-curated; static
      },
      lastUpdated,
      trends,
      scanHealth,
      watchlist: {
        closingSoon: tcpaCases.closingSoon,
        highPriority: leads.highPriority,
        staleSources,
      },
    };

    await kv.set(ROLLUP_KEY, JSON.stringify(rollup), { ex: 7 * 24 * 3600 });

    return {
      ok: true,
      summary: {
        tcpaCases: rollup.counts.tcpaCases.total,
        leads: rollup.counts.leads.total,
        clients: rollup.counts.clients.total,
        defendants: rollup.counts.defendants.total,
        scanStatus: scanHealth.status,
        scansLast7Days: scanHealth.runsLast7,
        closingSoonCount: rollup.watchlist.closingSoon.length,
        staleSources: rollup.watchlist.staleSources.length,
      },
      result: rollup,
    };
  },
};
