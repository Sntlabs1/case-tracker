// Vercel serverless function — POST /api/intake-screen
// Screens a caller's profile against top 150 active leads to find qualifying class actions.
// Body: { name, state, age, injuries, medications, products, occupation, notes }

import { kv } from "@vercel/kv";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BATCH_SIZE = 20;   // leads per Claude call
const MAX_CALLS  = 6;    // max parallel Claude calls → 120 leads max
const LEADS_FETCH = 150;
const TIMEOUT_MS = 50000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function claudeJSON(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

async function callClaude(systemPrompt, userContent, maxTokens = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
    const data = await res.json();
    return data.content?.map(b => b.text || "").join("") || "[]";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Build lead summary for the prompt ────────────────────────────────────────

function leadSummary(lead, idx) {
  const a = lead.analysis || {};
  const pp = a.plaintiffProfile || {};
  const cp = a.classProfile || {};
  const tl = a.timeline || {};
  return [
    `[${idx}] ID:${lead.id} | "${lead.title}"`,
    `  caseType: ${a.caseType || "unknown"}`,
    `  score: ${a.score ?? lead.score ?? "?"}`,
    `  classification: ${a.classification || "?"}`,
    `  requiredInjury: ${pp.requiredInjury || a.requiredInjury || "not specified"}`,
    `  productOrMedication: ${pp.productOrMedication || a.productOrMedication || "not specified"}`,
    `  demographics: ${cp.demographics || pp.demographics || a.demographics || "any"}`,
    `  geographicScope: ${pp.geographicScope || a.geographicScope || cp.geographicScope || "nationwide"}`,
    `  injuryTimeframe: ${pp.injuryTimeframe || tl.injuryTimeframe || a.injuryTimeframe || "not specified"}`,
    `  disqualifiers: ${pp.disqualifiers || a.disqualifiers || "none stated"}`,
    `  acquisitionHook: ${pp.acquisitionHook || a.acquisitionHook || "not specified"}`,
    `  estimatedFee: ${a.estimatedFee || a.feeEstimate || "not specified"}`,
    `  urgencyNote: ${a.urgencyNote || a.daysToAct || ""}`,
  ].join("\n");
}

// ─── System prompt for batch scoring ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a plaintiff intake specialist at a class action law firm. You receive a caller's profile and a batch of active class action leads. For each lead, score how well the caller qualifies as a plaintiff (0-100) and decide whether to proceed with intake.

Scoring guide:
- 75-100: Strong match — caller clearly meets core requirements (injury, product/medication, timeframe, geography)
- 50-74: Possible match — caller meets some requirements; needs follow-up questions to confirm
- 30-49: Weak match — one key requirement met but others unclear or unlikely
- 0-29: No match — caller's profile clearly does not meet the case requirements

Return ONLY a JSON array (no markdown, no explanation) with one object per lead:
[
  {
    "leadId": "<lead id string>",
    "score": <0-100 integer>,
    "qualifies": <true if score >= 50, false otherwise>,
    "reason": "<1 sentence explaining the score — be specific about what matches or doesn't>",
    "intakeScript": ["<question 1>", "<question 2>", "<question 3 if needed>"],
    "urgencyNote": "<any deadline or statute of limitations note, or empty string>"
  },
  ...
]

intakeScript: Write 2-3 specific questions a paralegal would ask this caller RIGHT NOW to confirm they qualify. Reference the actual case requirements (specific drug names, injury types, time periods, states). Do not write generic questions.

If a lead's information is insufficient to score meaningfully, give it a score of 10 with qualifies:false and reason explaining the data gap.`;

// ─── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { name, state, age, injuries, medications, products, occupation, notes } = req.body || {};

  if (!injuries && !medications && !products) {
    return res.status(400).json({ error: "At least one of injuries, medications, or products is required" });
  }

  // ── 1. Fetch top 150 lead IDs from KV ───────────────────────────────────────
  let ids = [];
  try {
    ids = await kv.zrange("leads_by_score", 0, -1, { rev: true });
    ids = (ids || []).slice(0, LEADS_FETCH);
  } catch (e) {
    return res.status(500).json({ error: `KV fetch failed: ${e.message}` });
  }

  if (!ids.length) {
    return res.status(200).json({ matches: [], total: 0, message: "No leads in database yet" });
  }

  // ── 2. Batch-fetch lead records ──────────────────────────────────────────────
  const pipeline = kv.pipeline();
  for (const id of ids) pipeline.get(`lead:${id}`);
  const raw = await pipeline.exec();

  const leads = raw
    .map(r => {
      if (!r) return null;
      try { return typeof r === "string" ? JSON.parse(r) : r; }
      catch { return null; }
    })
    .filter(Boolean);

  if (!leads.length) {
    return res.status(200).json({ matches: [], total: 0 });
  }

  // ── 3. Build caller profile string ──────────────────────────────────────────
  const callerProfile = [
    `Caller: ${name || "Anonymous"}`,
    `State: ${state || "not provided"}`,
    `Age: ${age || "not provided"}`,
    `Injuries/Conditions: ${injuries || "none stated"}`,
    `Medications/Drugs: ${medications || "none stated"}`,
    `Products/Devices: ${products || "none stated"}`,
    `Occupation: ${occupation || "not provided"}`,
    `Additional notes: ${notes || "none"}`,
  ].join("\n");

  // ── 4. Split leads into batches, run parallel Claude calls ──────────────────
  const batches = [];
  for (let i = 0; i < Math.min(leads.length, MAX_CALLS * BATCH_SIZE); i += BATCH_SIZE) {
    batches.push(leads.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.allSettled(
    batches.map(async (batch, batchIdx) => {
      const leadsText = batch
        .map((lead, idx) => leadSummary(lead, batchIdx * BATCH_SIZE + idx + 1))
        .join("\n\n");

      const userContent = `CALLER PROFILE:\n${callerProfile}\n\n---\n\nACTIVE LEADS TO SCORE (batch ${batchIdx + 1}):\n\n${leadsText}`;

      const text = await callClaude(SYSTEM_PROMPT, userContent, 3000);
      return { batch, scored: claudeJSON(text) };
    })
  );

  // ── 5. Merge results — join scored data back to lead metadata ────────────────
  // Build a quick lookup: leadId → lead record
  const leadMap = {};
  for (const lead of leads) {
    leadMap[String(lead.id)] = lead;
  }

  const allMatches = [];

  for (const result of batchResults) {
    if (result.status !== "fulfilled") continue;
    const { batch, scored } = result.value;

    for (const item of scored) {
      const lid = String(item.leadId);
      // Find lead by id — scored item's leadId matches lead.id
      const lead = leadMap[lid] || batch.find(l => String(l.id) === lid);
      if (!lead) continue;

      const a = lead.analysis || {};
      const pp = a.plaintiffProfile || {};

      allMatches.push({
        leadId:        lid,
        leadTitle:     lead.title || "Untitled Lead",
        caseType:      a.caseType || lead.caseType || "Unknown",
        score:         typeof item.score === "number" ? item.score : 0,
        qualifies:     !!item.qualifies,
        reason:        item.reason || "",
        intakeScript:  Array.isArray(item.intakeScript) ? item.intakeScript : [],
        urgencyNote:   item.urgencyNote || a.urgencyNote || "",
        requiredInjury: pp.requiredInjury || a.requiredInjury || "",
        estimatedFee:  a.estimatedFee || a.feeEstimate || "",
        leadScore:     a.score ?? lead.score ?? 0,
        classification: a.classification || "",
        source:        lead.source || "",
        url:           lead.url || "",
      });
    }
  }

  // Sort descending by caller match score
  allMatches.sort((a, b) => b.score - a.score);

  return res.status(200).json({
    matches: allMatches,
    total:   allMatches.length,
    callerName: name || "Anonymous",
    leadsScanned: leads.length,
  });
}
