// Vercel serverless function — historical trend analytics
// GET /api/trends          — full dashboard data
// GET /api/trends?type=topics   — hot topics only
// GET /api/trends?type=history  — scan history only

import { kv } from "@vercel/kv";

function dateRange(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { type } = req.query;

  // ── Scan history ──────────────────────────────────────────────────────────
  if (type === "history") {
    const raw = await kv.lrange("scan_history", 0, 59);
    const history = raw.map(r => {
      try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; }
    }).filter(Boolean);
    return res.status(200).json({ history });
  }

  // ── Hot topics ────────────────────────────────────────────────────────────
  if (type === "topics") {
    const topics = await buildHotTopics();
    return res.status(200).json({ topics });
  }

  // ── Full dashboard ────────────────────────────────────────────────────────

  // Parallel fetch of all data
  const [
    scanHistoryRaw,
    topicsData,
    dailyStatsData,
  ] = await Promise.all([
    kv.lrange("scan_history", 0, 89),
    buildHotTopics(),
    buildDailyStats(30),
  ]);

  const scanHistory = scanHistoryRaw.map(r => {
    try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; }
  }).filter(Boolean);

  return res.status(200).json({
    scanHistory,
    hotTopics: topicsData,
    dailyStats: dailyStatsData.dailyStats,
    caseTypeBreakdown: dailyStatsData.caseTypeBreakdown,
    sourceCategoryBreakdown: dailyStatsData.sourceCategoryBreakdown,
    urgencyBreakdown: dailyStatsData.urgencyBreakdown,
    summary: dailyStatsData.summary,
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function buildHotTopics() {
  // Get top 50 topics by all-time mentions
  const topTopicsRaw = await kv.zrange("topic_mentions", 0, 49, { rev: true, withScores: true });
  if (!topTopicsRaw || topTopicsRaw.length === 0) return [];

  // Parse: Vercel KV returns [{member, score}] or alternating [member, score, member, score]
  const topTopics = [];
  if (Array.isArray(topTopicsRaw) && typeof topTopicsRaw[0] === "object") {
    for (const item of topTopicsRaw) {
      topTopics.push({ subject: item.member || item[0], total: Number(item.score || item[1]) });
    }
  } else {
    // Flat alternating array
    for (let i = 0; i < topTopicsRaw.length; i += 2) {
      topTopics.push({ subject: String(topTopicsRaw[i]), total: Number(topTopicsRaw[i + 1]) });
    }
  }

  // Calculate velocity: mentions in last 7 days vs prior 7 days
  const last7Dates = dateRange(7);
  const prior7Dates = dateRange(14).slice(0, 7);

  const [last7Raw, prior7Raw] = await Promise.all([
    Promise.all(last7Dates.map(d => kv.zscore(`topic_daily:${d}`, "").catch(() => null))),
    Promise.all(prior7Dates.map(d => kv.zscore(`topic_daily:${d}`, "").catch(() => null))),
  ]);

  // Get per-subject counts for the two windows
  // Batch: for each topic get its count in last 7 days and prior 7 days
  const topicVelocity = await Promise.all(
    topTopics.slice(0, 30).map(async ({ subject, total }) => {
      const [last7Counts, prior7Counts] = await Promise.all([
        Promise.all(last7Dates.map(d => kv.zscore(`topic_daily:${d}`, subject).catch(() => 0))),
        Promise.all(prior7Dates.map(d => kv.zscore(`topic_daily:${d}`, subject).catch(() => 0))),
      ]);
      const last7 = last7Counts.reduce((s, v) => s + Number(v || 0), 0);
      const prior7 = prior7Counts.reduce((s, v) => s + Number(v || 0), 0);

      let velocityLabel;
      let velocityValue;
      if (prior7 === 0 && last7 > 0) {
        velocityLabel = "NEW";
        velocityValue = 999;
      } else if (prior7 === 0) {
        velocityLabel = "FLAT";
        velocityValue = 0;
      } else {
        velocityValue = (last7 - prior7) / prior7;
        if (velocityValue >= 1.0) velocityLabel = "ACCELERATING";
        else if (velocityValue >= 0.2) velocityLabel = "GROWING";
        else if (velocityValue <= -0.2) velocityLabel = "DECLINING";
        else velocityLabel = "STABLE";
      }

      return { subject, total, last7, prior7, velocityLabel, velocityValue };
    })
  );

  // Sort by velocity desc, then total desc
  return topicVelocity.sort((a, b) => {
    if (b.velocityValue !== a.velocityValue) return b.velocityValue - a.velocityValue;
    return b.total - a.total;
  });
}

async function buildDailyStats(days) {
  const dates = dateRange(days);

  const rawStats = await Promise.all(
    dates.map(d => kv.hgetall(`daily_stats:${d}`).catch(() => null))
  );

  const dailyStats = dates.map((date, i) => {
    const s = rawStats[i];
    if (!s) return { date, leads: 0, highPriority: 0, create: 0, avgScore: 0, processed: 0, clusters: 0 };
    return {
      date,
      leads: Number(s.leads || 0),
      highPriority: Number(s.highPriority || 0),
      create: Number(s.create || 0),
      avgScore: Number(s.avgScore || 0),
      processed: Number(s.processed || 0),
      clusters: Number(s.clusters || 0),
    };
  });

  // Aggregate case type breakdown (last 30 days)
  const caseTypeBreakdown = {};
  const sourceCategoryBreakdown = {};
  const urgencyBreakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (const s of rawStats.filter(Boolean)) {
    if (s.caseTypes) {
      try {
        const ct = JSON.parse(s.caseTypes);
        for (const [k, v] of Object.entries(ct)) caseTypeBreakdown[k] = (caseTypeBreakdown[k] || 0) + Number(v);
      } catch {}
    }
    if (s.sourceCategories) {
      try {
        const sc = JSON.parse(s.sourceCategories);
        for (const [k, v] of Object.entries(sc)) sourceCategoryBreakdown[k] = (sourceCategoryBreakdown[k] || 0) + Number(v);
      } catch {}
    }
    if (s.urgency) {
      try {
        const u = JSON.parse(s.urgency);
        for (const [k, v] of Object.entries(u)) if (urgencyBreakdown[k] !== undefined) urgencyBreakdown[k] += Number(v);
      } catch {}
    }
  }

  // Summary stats
  const totalLeads = dailyStats.reduce((s, d) => s + d.leads, 0);
  const activeDays = dailyStats.filter(d => d.leads > 0).length;
  const avgLeadsPerDay = activeDays > 0 ? Math.round(totalLeads / activeDays) : 0;
  const peakDay = [...dailyStats].sort((a, b) => b.leads - a.leads)[0];
  const totalClusters = dailyStats.reduce((s, d) => s + d.clusters, 0);
  const avgScore = (() => {
    const days = dailyStats.filter(d => d.avgScore > 0);
    return days.length > 0 ? Math.round(days.reduce((s, d) => s + d.avgScore, 0) / days.length) : 0;
  })();

  return {
    dailyStats,
    caseTypeBreakdown,
    sourceCategoryBreakdown,
    urgencyBreakdown,
    summary: { totalLeads, activeDays, avgLeadsPerDay, peakDay, totalClusters, avgScore },
  };
}
