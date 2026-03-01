// Vercel serverless function — synthesizes top case opportunities from stored leads
// GET /api/opportunities        — returns cached synthesis (6h TTL)
// GET /api/opportunities?refresh=1 — forces fresh synthesis

import { kv } from "@vercel/kv";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CACHE_TTL_SECONDS = 6 * 3600; // 6 hours

const SYNTHESIS_PROMPT = `You are a senior class action attorney reviewing a portfolio of intelligence leads. Your job is to identify the TOP CASE OPPORTUNITIES — not individual signals, but the underlying cases that multiple signals are pointing to.

Group related leads by defendant/case. A lead about "FDA warns on Ozempic" and a lead about "Reddit users reporting Ozempic injuries" and a lead about "class action filed against Novo Nordisk re: Ozempic" are all the SAME case opportunity.

For each case opportunity, produce a RANKED assessment considering:
- Combined signal strength (how many independent sources pointing here)
- Historical win probability (based on case type, signals present, KB replication grade)
- First-mover advantage (Pre-Litigation stage = no one has filed yet = critical window)
- Targeting readiness (can you start signing clients today?)
- Economic upside (fund size × probability × 33% fee)
- Urgency (SOL, consolidation window, competing firms)

RANKING PRIORITY ORDER:
1. Pre-Litigation + multiple signals + KB grade A/B = highest priority (first-mover window open, proven case type)
2. Filed/MDL + high score + large fund = strong JOIN opportunity
3. Bellwether Set + high KB grade = settlement imminent, last chance to sign clients
4. High score single signal with compelling facts = worth investigating

Return ONLY a JSON array (no markdown, no explanation text). Top 10 opportunities max. Each item:
{
  "rank": <1–10>,
  "opportunityName": "<Defendant — Case Type, e.g. 'Novo Nordisk — GLP-1 Gastroparesis' or '3M — PFAS Water Contamination'>",
  "defendant": "<company/entity name>",
  "caseType": "<Medical Device|Pharmaceutical|Auto Defect|Environmental|Consumer Fraud|Data Breach|Securities|Food Safety|Financial Products|Employment|Antitrust|Government Liability|Other>",
  "caseStage": "Pre-Litigation|Filed / Discovery|MDL Consolidated|Bellwether Set|Settlement Discussions",
  "combinedScore": <0-100 integer>,
  "probabilityOfSuccess": <0-100 integer — realistic % chance of viable class action reaching settlement>,
  "signalCount": <integer — how many leads from the list support this>,
  "estimatedFund": "<e.g. '$500M–$2B' or 'Unknown'>",
  "estimatedFeeToFirm": "<e.g. '$165M–$660M' or 'Unknown'>",
  "firstMoverAdvantage": true|false,
  "urgencyLevel": "CRITICAL|HIGH|MEDIUM|LOW",
  "whyPursue": [
    "<specific reason 1 — cite actual signal or KB precedent>",
    "<specific reason 2>",
    "<specific reason 3>"
  ],
  "immediateAction": "<the single most important thing to do today — specific and concrete, not generic>",
  "keyRisk": "<biggest single threat to this case — specific, not generic>",
  "kbReplicationGrade": "A|B|C|D|F|Unknown",
  "supportingSignals": ["<headline — Source Label>", "<headline — Source Label>", "<headline — Source Label>"]
}

For supportingSignals, use the format "Headline text — Source Label" (e.g. "FDA issues warning for Drug X — FDA Drug Safety" or "Reddit users report insulin pump failures — Reddit Cluster"). Always include the source label so the attorney knows where each signal originated.

Order by: (combinedScore × probabilityOfSuccess) descending. If fewer than 3 meaningful opportunities exist in the leads, return what you have.`;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const forceRefresh = req.query.refresh === "1";

  // ── 1. CHECK CACHE ──────────────────────────────────────────────────────────
  if (!forceRefresh) {
    try {
      const cached = await kv.get("opportunities:latest");
      if (cached) {
        const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
        const ageMs = Date.now() - new Date(parsed.generatedAt || 0).getTime();
        if (ageMs < CACHE_TTL_SECONDS * 1000) {
          return res.status(200).json(parsed);
        }
      }
    } catch {}
  }

  // ── 2. FETCH TOP 50 LEADS FROM KV ──────────────────────────────────────────
  let ids = [];
  try {
    // zrange with byScore + rev returns highest-scored IDs first
    ids = await kv.zrange("leads_by_score", 100, 0, {
      byScore: true,
      rev: true,
      limit: { count: 50, offset: 0 },
    });
  } catch (e) {
    console.error("KV zrange failed:", e.message);
    return res.status(200).json({
      opportunities: [],
      generatedAt: new Date().toISOString(),
      error: "KV unavailable — deploy to Vercel with KV configured",
    });
  }

  if (!ids || ids.length === 0) {
    return res.status(200).json({
      opportunities: [],
      generatedAt: new Date().toISOString(),
      leadCount: 0,
    });
  }

  // Batch fetch lead objects
  const pipeline = kv.pipeline();
  ids.forEach(id => pipeline.get(`lead:${id}`));
  let rawLeads = [];
  try {
    rawLeads = await pipeline.exec();
  } catch (e) {
    console.error("KV pipeline failed:", e.message);
    return res.status(500).json({ error: "KV pipeline failed" });
  }

  const leads = rawLeads
    .map(d => {
      try { return typeof d === "string" ? JSON.parse(d) : d; }
      catch { return null; }
    })
    .filter(Boolean);

  if (leads.length === 0) {
    return res.status(200).json({
      opportunities: [],
      generatedAt: new Date().toISOString(),
      leadCount: 0,
    });
  }

  // ── 3. BUILD COMPACT LEAD SUMMARIES ────────────────────────────────────────
  // Each line ~200 chars — keeps total prompt within Sonnet's context
  const leadSummaries = leads.map((l, i) => {
    const a = l.analysis || {};
    const headline = (a.headline || l.title || "").slice(0, 80);
    const defendant = a.defendantProfile?.name || "Unknown";
    const fund = a.damagesModel?.totalFundEstimate || "?";
    const kb = a.kbReplicationGrade || "?";
    const stage = a.caseStage || "?";
    const urgency = a.timeline?.urgencyLevel || "?";
    const ready = a.targetingReadiness || "?";
    // Include source so synthesis can cite it in supportingSignals
    const src = (l.source || "").slice(0, 40);
    return `[${i + 1}] Score:${a.score ?? "?"} | ${a.caseType || "?"} | Stage:${stage} | Urgency:${urgency} | KB:${kb} | Source:${src} | Targeting:${ready} | Defendant:${defendant} | Fund:${fund} | "${headline}"`;
  }).join("\n");

  // ── 4. SYNTHESIZE WITH CLAUDE SONNET ───────────────────────────────────────
  try {
    const synthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYNTHESIS_PROMPT,
        messages: [{
          role: "user",
          content: `Synthesize these ${leads.length} leads into ranked case opportunities:\n\n${leadSummaries}`,
        }],
      }),
    });

    const synthData = await synthRes.json();
    const text = synthData.content?.map(b => b.text || "").join("") || "[]";

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error("No JSON array in synthesis response. Raw:", text.slice(0, 500));
      throw new Error("Synthesis did not return a JSON array");
    }

    const opportunities = JSON.parse(match[0]);
    console.log(`Opportunities synthesis: ${opportunities.length} opportunities from ${leads.length} leads`);

    const result = {
      opportunities,
      generatedAt: new Date().toISOString(),
      leadCount: leads.length,
    };

    // Cache for 6 hours
    await kv.set("opportunities:latest", JSON.stringify(result), { ex: CACHE_TTL_SECONDS });

    return res.status(200).json(result);
  } catch (e) {
    console.error("Synthesis failed:", e.message);
    return res.status(500).json({ error: `Synthesis failed: ${e.message}` });
  }
}
