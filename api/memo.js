// Vercel serverless function — generate a full litigation memo for a lead
// POST /api/memo  { lead: { ...full lead object } }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { lead } = req.body || {};
  if (!lead) return res.status(400).json({ error: "lead required" });

  const a = lead.analysis || {};
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const caseData = `
CASE: ${a.headline || lead.title}
SOURCE: ${lead.source || "Unknown"} | DATE: ${lead.pubDate ? new Date(lead.pubDate).toLocaleDateString() : "Unknown"}
SCORE: ${a.score ?? "N/A"} | CONFIDENCE: ${a.confidence ?? "N/A"}% | CLASSIFICATION: ${a.classification || "N/A"}
JOIN OR CREATE: ${a.joinOrCreate || "N/A"}
CASE TYPE: ${a.caseType || "N/A"} | SUB-CATEGORY: ${a.subCategory || "N/A"}
CASE STAGE: ${a.caseStage || "N/A"}

EXECUTIVE SUMMARY: ${a.executiveSummary || "N/A"}
DESCRIPTION: ${(lead.description || "").slice(0, 800)}

DEFENDANT:
  Name: ${a.defendantProfile?.name || "Unknown"}
  Type: ${a.defendantProfile?.type || "Unknown"}
  Financial Health: ${a.defendantProfile?.financialHealth || "Unknown"}
  Bankruptcy Risk: ${a.defendantProfile?.bankruptcyRisk || "Unknown"}
  Prior Litigation: ${a.defendantProfile?.priorLitigation || "Unknown"}
  Defense Strategy: ${a.defendantProfile?.defenseLikelyStrategy || "Unknown"}
  Vulnerability: ${a.defendantProfile?.vulnerability || "Unknown"}

PLAINTIFF PROFILE:
  Demographics: ${a.plaintiffProfile?.demographics || "Unknown"}
  Required Injury: ${a.plaintiffProfile?.requiredInjury || "Unknown"}
  Injury Timeframe: ${a.plaintiffProfile?.injuryTimeframe || "Unknown"}
  Geographic Hotspots: ${(a.plaintiffProfile?.geographicHotspots || []).join(", ") || "Unknown"}
  Where to Find: ${(a.plaintiffProfile?.whereToFind || []).join(", ") || "Unknown"}
  Disqualifiers: ${a.plaintiffProfile?.disqualifiers || "Unknown"}
  Acquisition Hook: ${a.plaintiffProfile?.acquisitionHook || "Unknown"}

CLASS PROFILE:
  Estimated Size: ${a.classProfile?.estimatedSize || "Unknown"}
  Geographic Scope: ${a.classProfile?.geographicScope || "Unknown"}
  Commonality: ${a.classProfile?.commonalityStrength || "Unknown"}

CAUSES OF ACTION: ${JSON.stringify(a.causesOfAction || [])}

DAMAGES MODEL:
  Theory: ${a.damagesModel?.theory || "Unknown"}
  Per Claimant: ${a.damagesModel?.perClaimantRange || "Unknown"}
  Total Fund: ${a.damagesModel?.totalFundEstimate || "Unknown"}
  Fee to Firm (33%): ${a.damagesModel?.feeToFirmAt33Pct || "Unknown"}
  Comcast Compliant: ${a.damagesModel?.comcastCompliant ?? "Unknown"}

EXISTING LITIGATION:
  MDL Consolidated: ${a.existingLitigation?.mdlConsolidated ?? "Unknown"}
  Settlement Status: ${a.existingLitigation?.settlementStatus || "Unknown"}
  Active Federal Cases: ${a.existingLitigation?.activeFederalCases || "Unknown"}
  Lead Firms: ${(a.existingLitigation?.leadFirmsInvolved || []).join(", ") || "Unknown"}
  Opportunity Assessment: ${a.existingLitigation?.opportunityAssessment || "Unknown"}

REGULATORY STATUS:
  FDA Action: ${a.regulatoryStatus?.fdaAction || "None"}
  CPSC Action: ${a.regulatoryStatus?.cpscAction || "None"}
  NHTSA Action: ${a.regulatoryStatus?.nhtsaAction || "None"}
  EPA Action: ${a.regulatoryStatus?.epaAction || "None"}
  DOJ/AG Action: ${a.regulatoryStatus?.dojOrAgAction || "None"}

TIMELINE:
  Urgency: ${a.timeline?.urgencyLevel || "Unknown"}
  Urgency Reason: ${a.timeline?.urgencyReason || "Unknown"}
  Years to Resolution: ${a.timeline?.yearsToResolution || "Unknown"}
  SOL: ${a.timeline?.statuteOfLimitationsNote || "Unknown"}
  Next Milestone: ${a.timeline?.nextMilestone || "Unknown"}
  Opportunity Window: ${a.timeline?.opportunityWindow || "Unknown"}

TOP RISK: ${a.topRisk || "Unknown"}
WHY ACT NOW: ${a.whyActNow || "Unknown"}
KB REPLICATION GRADE: ${a.kbReplicationGrade || "Unknown"}
KB ANALOGUES: ${JSON.stringify(a.kbAnalogues || [])}
SIGNALS: ${JSON.stringify(a.signalsAnalysis || {})}
RISK MATRIX: ${JSON.stringify(a.riskMatrix || [])}
IMMEDIATE NEXT STEPS: ${JSON.stringify(a.immediateNextSteps || [])}
`.trim();

  const systemPrompt = `You are a senior partner at a plaintiff class action law firm drafting internal litigation memoranda. Write in clear, direct legal prose. Be specific — cite actual facts from the case data, not generic statements. Use professional memo format. Do not use markdown headers with ##; use ALL CAPS section headers followed by a line break. Be thorough but tight — no filler.`;

  const userPrompt = `Draft a full internal litigation memorandum for the following plaintiff acquisition opportunity. Use this exact structure:

MEMORANDUM

TO: Plaintiff Acquisition Committee
FROM: Intelligence Unit
DATE: ${today}
RE: [Case name and defendant]
CLASSIFICATION: ATTORNEY-CLIENT PRIVILEGED — WORK PRODUCT

─────────────────────────────────────────────────────────

EXECUTIVE SUMMARY

[3-4 sentences: what happened, who was harmed, why this is actionable, and the recommendation (pursue / investigate / pass).]

─────────────────────────────────────────────────────────

CASE BACKGROUND

[2-3 paragraphs: the underlying facts, harm mechanism, how this became known, and current litigation status.]

─────────────────────────────────────────────────────────

DEFENDANT ANALYSIS

[Company, financial profile, prior litigation history, likely defense strategy, key vulnerabilities. Be specific.]

─────────────────────────────────────────────────────────

LEGAL THEORIES

[List each cause of action with a one-paragraph analysis: elements, how the facts satisfy each element, key evidentiary needs, and likelihood of surviving a motion to dismiss.]

─────────────────────────────────────────────────────────

CLASS DEFINITION AND CERTIFICATION PROSPECTS

[Proposed class definition. Analysis of Rule 23(a) and 23(b)(3) requirements — numerosity, commonality, typicality, adequacy, predominance, superiority. Specific obstacles and how to address them.]

─────────────────────────────────────────────────────────

PLAINTIFF PROFILE AND ACQUISITION STRATEGY

[Who qualifies, disqualifiers, where to find them, what documentation they need, recommended acquisition channels and messaging. Include the acquisition hook.]

─────────────────────────────────────────────────────────

DAMAGES MODEL

[Per-claimant range, total fund estimate, fee to firm. Damages theory and Comcast v. Behrend compliance analysis.]

─────────────────────────────────────────────────────────

RISK ASSESSMENT

[The top 3-5 risks with severity and concrete mitigation steps for each. Be specific — not generic risks.]

─────────────────────────────────────────────────────────

COMPETITIVE LANDSCAPE

[Which firms are already in this space. First-mover assessment. Consolidation risk. MDL status if applicable.]

─────────────────────────────────────────────────────────

STATUTE OF LIMITATIONS

[SOL analysis — what period applies, when it started running, and the hard deadline to file.]

─────────────────────────────────────────────────────────

KNOWLEDGE BASE PRECEDENT

[Reference the analogous KB cases and what they teach about this case — what worked, what failed, replication grade and what it means for strategy here.]

─────────────────────────────────────────────────────────

RECOMMENDATION AND IMMEDIATE ACTION ITEMS

[Clear go / no-go / investigate recommendation with reasoning. Then a numbered list of specific action items for the next 30 days.]

─────────────────────────────────────────────────────────

Here is the full case intelligence:

${caseData}`;

  // Stream the memo back
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        stream: true,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(110000),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      res.write(`data: ${JSON.stringify({ type: "error", error: { message: `Anthropic ${upstream.status}: ${txt.slice(0, 200)}` } })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: "error", error: { message: e.message } })}\n\n`);
    res.end();
  }
}
