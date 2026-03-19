// Vercel serverless function — Morning Intelligence Briefing
// GET /api/briefing?generate=1   — generate and return fresh briefing
// GET /api/briefing              — return cached briefing (6h TTL)

import { kv } from "@vercel/kv";

export const config = { maxDuration: 60 };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CACHE_KEY = "briefing_cache_v1";
const CACHE_TTL = 6 * 3600; // 6 hours

async function fetchRecentLeads() {
  try {
    // Get all lead IDs from sorted set — top 200 by score
    const ids = await kv.zrange("leads_by_score", 0, 199, { rev: true });
    if (!ids || ids.length === 0) return [];

    const now = Date.now();
    const cutoff = now - 24 * 3600 * 1000; // 24h ago

    // Fetch all leads in parallel
    const leadsRaw = await Promise.all(ids.map(id => kv.get(`lead:${id}`).catch(() => null)));
    const leads = leadsRaw
      .filter(Boolean)
      .map(l => typeof l === "string" ? JSON.parse(l) : l)
      .filter(l => {
        const ts = l.scannedAt || l.pubDate;
        if (!ts) return false;
        return new Date(ts).getTime() >= cutoff;
      });

    return leads;
  } catch {
    return [];
  }
}

async function fetchTopOpportunities() {
  try {
    const cached = await kv.get("opportunities:latest");
    if (!cached) return [];
    const data = typeof cached === "string" ? JSON.parse(cached) : cached;
    return (data.opportunities || []).slice(0, 5);
  } catch {
    return [];
  }
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const forceGenerate = req.query.generate === "1";

  // Return cached briefing if available and not forcing regeneration
  if (!forceGenerate) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) {
        const data = typeof cached === "string" ? JSON.parse(cached) : cached;
        return res.status(200).json({ ...data, cached: true });
      }
    } catch {}
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  // Fetch data in parallel
  const [recentLeads, topOpps] = await Promise.all([
    fetchRecentLeads(),
    fetchTopOpportunities(),
  ]);

  const today = new Date();
  const dateStr = formatDate(today);
  const newLeadsCount = recentLeads.length;

  // Build a compact summary for the prompt
  const leadsDigest = recentLeads
    .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0))
    .slice(0, 20)
    .map(l => {
      const a = l.analysis || {};
      return `- [Score: ${a.score || 0}] ${a.headline || l.title || "Untitled"} | ${a.caseType || "Unknown"} | Defendant: ${a.defendantProfile?.name || "Unknown"} | Urgency: ${a.timeline?.urgencyLevel || "Unknown"} | Source: ${l.source || "Unknown"}`;
    })
    .join("\n");

  const oppsDigest = topOpps
    .map(o => `- #${o.rank} ${o.opportunityName} | Score: ${o.combinedScore} | P(win): ${o.probabilityOfSuccess}% | Fund: ${o.estimatedFund || "Unknown"} | Fee: ${o.estimatedFeeToFirm || "Unknown"} | Urgency: ${o.urgencyLevel || "Unknown"} | Action: ${o.immediateAction || "None"}`)
    .join("\n");

  const prompt = `You are a senior plaintiff class action attorney. Generate a concise morning intelligence briefing for your firm. Today is ${dateStr}.

## DATA

### New Leads (last 24 hours) — ${newLeadsCount} total
${leadsDigest || "No new leads in the last 24 hours."}

### Top 5 Case Opportunities (AI-synthesized)
${oppsDigest || "No opportunities available."}

## INSTRUCTIONS

Write a professional morning briefing as a formatted markdown document. Structure:

1. ## Morning Intelligence Briefing — ${dateStr}
   One paragraph executive summary (2–3 sentences): what happened overnight, what the firm needs to know.

2. ## New Leads (Last 24 Hours)
   Summarize the most significant new leads. Group by case type where possible. Call out any that are score 75+ or CRITICAL urgency. Keep to 3–5 bullet points max.

3. ## Top Case Opportunities
   For each of the top 3 opportunities: one bullet with name, projected fee, P(win), and the single most important action item. Be specific.

4. ## Action Items for Today
   3–5 numbered concrete actions the firm should take today, ranked by urgency. Be specific — name defendants, case types, deadlines.

5. ## Watch List
   1–2 items: anything developing that needs monitoring but no action yet.

Keep the total briefing to ~400 words. Use plain markdown (##, -, numbers). No HTML. Professional tone — this is read by a senior attorney at 7am.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      return res.status(502).json({ error: `Claude API error: ${apiRes.status}`, detail: errBody.slice(0, 200) });
    }

    const data = await apiRes.json();
    const briefingText = data.content?.[0]?.text || "";

    const result = {
      briefing: briefingText,
      generatedAt: new Date().toISOString(),
      newLeads: newLeadsCount,
      topOpps: topOpps.slice(0, 5).map(o => ({
        name: o.opportunityName,
        score: o.combinedScore,
        pwin: o.probabilityOfSuccess,
        estimatedFee: o.estimatedFeeToFirm,
        urgency: o.urgencyLevel,
      })),
      solAlerts: [], // placeholder — SOL data lives client-side in localStorage
    };

    // Cache for 6 hours
    await kv.set(CACHE_KEY, JSON.stringify(result), { ex: CACHE_TTL }).catch(() => {});

    return res.status(200).json(result);
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ error: "Briefing generation timed out — try again" });
    }
    return res.status(500).json({ error: e.message });
  }
}
