// POST /api/case-summary — generate a comprehensive attorney case memo
// Body: { caseData: { title, company, description, caseType, ... } }
// Returns: { memo: { bottomLine, goNoGo, background, legalTheory, classAnalysis,
//                    financialAnalysis, litigationLandscape, keyRisks[], strategicRecommendation } }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a senior plaintiff litigation partner at a top class action firm. Write a comprehensive internal case evaluation memo for a case under consideration. Your audience is the firm's partners deciding whether to take this case.

Write with authority and specificity. Reference the actual defendant, product, injury type, and case facts. Every section should have substance — no generic filler.

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "goNoGo": "GO | NO-GO | INVESTIGATE",
  "bottomLine": "<2-3 sentences: verdict upfront — is this worth pursuing, why, and what the key driver is>",
  "background": "<3-4 paragraphs: what the defendant did or failed to do; what the underlying harm is; the timeline of events; why this is a viable legal matter now>",
  "legalTheory": "<2-3 paragraphs: what legal claims apply and why they hold; how liability attaches; which legal elements are clearly met vs. those that need development; analogous precedents>",
  "classAnalysis": "<2 paragraphs: who is in the class and how large it is; numerosity and geographic scope; commonality — what common question drives the case; typicality and adequacy prospects; likely class certification obstacles>",
  "financialAnalysis": "<2 paragraphs: how the damages fund was sized; per-claimant range and methodology; firm fee at 33% contingency; why the economics justify the investment; Comcast model compliance or concerns>",
  "litigationLandscape": "<2 paragraphs: what cases are already filed; MDL status or consolidation prospects; who the lead plaintiff firms are and how aggressive they are; where in the litigation lifecycle this case sits; first-mover advantage assessment>",
  "keyRisks": [
    { "risk": "<specific risk>", "severity": "High|Medium|Low", "mitigation": "<specific mitigation strategy>" }
  ],
  "strategicRecommendation": "<2-3 paragraphs: concrete recommendation with reasoning; what to do in the next 30 days; what signals to watch that would change the calculus; any conditions on the recommendation>"
}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { caseData } = req.body;
  if (!caseData) return res.status(400).json({ error: "caseData required" });

  const c = caseData;

  // Build a comprehensive case brief for Claude to analyze
  const context = [
    `CASE: ${c.title}`,
    `DEFENDANT: ${c.company || "Unknown"}`,
    `CASE TYPE: ${c.caseType || "Unknown"}`,
    `CURRENT STATUS: ${c.status || "Unknown"} | Priority: ${c.priority || "Unknown"}`,
    c.caseStage ? `LITIGATION STAGE: ${c.caseStage}` : null,
    c.description ? `\nEXECUTIVE SUMMARY:\n${c.description}` : null,
    c.caseStageRationale ? `STAGE RATIONALE: ${c.caseStageRationale}` : null,
    // Financial
    c.fundEstimate ? `ESTIMATED FUND: ${c.fundEstimate}` : null,
    c.perClaimant ? `PER-CLAIMANT RANGE: ${c.perClaimant}` : null,
    c.feeToFirm ? `FIRM FEE (33%): ${c.feeToFirm}` : null,
    c.damagesTheory ? `DAMAGES THEORY: ${c.damagesTheory}` : null,
    // Class
    c.affectedPop ? `AFFECTED POPULATION: ${c.affectedPop}` : null,
    c.jurisdiction ? `GEOGRAPHIC SCOPE: ${c.jurisdiction}` : null,
    c.targetDemographics ? `TARGET DEMOGRAPHICS: ${c.targetDemographics}` : null,
    c.requiredInjury ? `REQUIRED INJURY/CONDITION: ${c.requiredInjury}` : null,
    c.disqualifiers ? `DISQUALIFIERS: ${c.disqualifiers}` : null,
    // Legal
    c.causesOfAction?.length ? `CAUSES OF ACTION: ${c.causesOfAction.join(", ")}` : null,
    // Timeline
    c.urgency ? `URGENCY LEVEL: ${c.urgency}` : null,
    c.urgencyReason ? `URGENCY REASON: ${c.urgencyReason}` : null,
    c.sol ? `STATUTE OF LIMITATIONS: ${c.sol}` : null,
    c.yearsToResolution ? `ESTIMATED YEARS TO RESOLUTION: ${c.yearsToResolution}` : null,
    c.nextMilestone ? `NEXT MILESTONE: ${c.nextMilestone}` : null,
    c.opportunityWindow ? `OPPORTUNITY WINDOW: ${c.opportunityWindow}` : null,
    // Defendant
    c.defendantFinancialHealth ? `DEFENDANT FINANCIAL HEALTH: ${c.defendantFinancialHealth}` : null,
    c.defendantBankruptcyRisk ? `DEFENDANT BANKRUPTCY RISK: ${c.defendantBankruptcyRisk}` : null,
    c.defenseLikelyStrategy ? `LIKELY DEFENSE STRATEGY: ${c.defenseLikelyStrategy}` : null,
    // Litigation landscape
    c.existingMDLNumber ? `EXISTING MDL: MDL ${c.existingMDLNumber}` : null,
    c.activeFederalCases ? `ACTIVE FEDERAL CASES: ${c.activeFederalCases}` : null,
    c.leadFirmsInvolved?.length ? `LEAD FIRMS ALREADY INVOLVED: ${c.leadFirmsInvolved.join(", ")}` : null,
    // Judge
    c.assignedJudge ? `ASSIGNED JUDGE: ${c.assignedJudge}${c.assignedJudgeCourt ? ` (${c.assignedJudgeCourt})` : ""}` : null,
    // KB
    c.kbGrade ? `KB REPLICATION GRADE: ${c.kbGrade}` : null,
    c.kbComparativeAssessment ? `\nKB COMPARATIVE ASSESSMENT:\n${c.kbComparativeAssessment}` : null,
    c.kbAnalogues?.length ? `ANALOGOUS KB CASES: ${c.kbAnalogues.map(k => `${k.caseName} (${k.rating}, KB#${k.caseId})`).join("; ")}` : null,
    c.kbStrategicPlaybook?.length ? `\nKB STRATEGIC PLAYBOOK:\n${c.kbStrategicPlaybook.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : null,
    // Risk
    c.topRisk ? `TOP IDENTIFIED RISK: ${c.topRisk}` : null,
    // Score
    c.score ? `VIABILITY SCORE: ${c.score}/100` : null,
    c.whyItScored ? `SCORING RATIONALE: ${c.whyItScored}` : null,
    c.scoreDimensions ? `SCORE DIMENSIONS: Liability ${c.scoreDimensions.liabilityCertainty}/20 · Certifiability ${c.scoreDimensions.certifiability}/20 · Economic Upside ${c.scoreDimensions.economicUpside}/20 · Plaintiff Pipeline ${c.scoreDimensions.plaintiffPipeline}/20 · First Mover ${c.scoreDimensions.firstMoverWindow}/20` : null,
    // Immediate steps
    c.immediateNextSteps?.length ? `\nIDENTIFIED NEXT STEPS:\n${c.immediateNextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : null,
    // Notes
    c.notes ? `\nATTORNEY NOTES:\n${c.notes}` : null,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Write the full case evaluation memo for:\n\n${context}`,
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Anthropic error ${response.status}`);

    const text = (data.content || []).map(b => b.text || "").join("").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in case summary response");

    const memo = JSON.parse(match[0]);
    return res.status(200).json({ memo, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
