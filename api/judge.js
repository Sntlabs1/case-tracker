// POST /api/judge — research a federal judge's class action profile
// Body: { judgeName: "...", court: "...", mdlNumber: "...", caseType: "..." }
// Uses Claude Sonnet with built-in web_search to pull real ruling history

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const JUDGE_SYSTEM_PROMPT = `You are a senior plaintiff litigation strategist researching a federal judge for a class action or MDL case.

Use the web_search tool to research:
1. The judge's background (court, appointing president, years on bench)
2. Their class certification rulings — grant rate and reasoning patterns
3. Their Daubert / expert witness tendencies
4. Their MDL management style (scheduling aggressiveness, bellwether approach, settlement pressure)
5. Any notable class action, mass tort, or MDL cases they presided over

Suggested searches: "[judge name] class certification ruling", "[judge name] MDL class action", "[judge name] Daubert", "[judge name] [court] opinion class action"

After researching, return ONLY a valid JSON object — no markdown, no text before or after the JSON:
{
  "name": "<full official name>",
  "court": "<full court name — e.g. 'U.S. District Court, S.D.N.Y.'>",
  "appointedBy": "<President + year — e.g. 'Obama, 2013'>",
  "yearsOnBench": <integer or null>,
  "plaintiffFriendlyScore": <0-10 where 10 = most plaintiff-friendly, based on documented rulings>,
  "classCertGrantRate": "<e.g. '~65%' or 'Unknown'>",
  "daubert": "admit-leaning | exclude-leaning | balanced | unknown",
  "mdlExperience": "extensive | moderate | limited | none",
  "avgDaysToClassCert": <integer estimated days from filing to class cert ruling, or null>,
  "notableRulings": [
    {
      "case": "<case name>",
      "year": <year>,
      "ruling": "<what they ruled and why it matters to a plaintiff firm>",
      "plaintiffResult": "favorable | unfavorable | mixed"
    }
  ],
  "keyTendencies": [
    "<specific documented tendency 1 — cite a ruling or pattern>",
    "<specific documented tendency 2>",
    "<specific documented tendency 3>"
  ],
  "riskFlags": [
    "<specific risk for plaintiff firms — cite basis>"
  ],
  "strategyTips": [
    "<specific action to take or avoid with this judge>",
    "<specific tip 2>",
    "<specific tip 3>"
  ],
  "overallAssessment": "<2-3 sentences: net assessment for a plaintiff firm — good draw, bad draw, or neutral, and specifically why>",
  "dataQuality": "high | medium | low",
  "dataQualityNote": "<confidence note — e.g. '12 class action opinions analyzed' or 'Recently appointed; limited published record'>"
}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { judgeName, court, mdlNumber, caseType } = req.body;
  if (!judgeName) return res.status(400).json({ error: "judgeName required" });

  const userMessage = [
    `Research this federal judge for a plaintiff law firm evaluating a class action case:`,
    `Judge: ${judgeName}`,
    court ? `Court: ${court}` : null,
    mdlNumber ? `MDL Number: ${mdlNumber}` : null,
    caseType ? `Case Type: ${caseType}` : null,
    `\nSearch for their actual ruling history on class certification, Daubert motions, and MDL management. Be specific — cite real cases and rulings, not generic observations.`,
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
        system: JUDGE_SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Anthropic error ${response.status}`);

    // Extract text blocks (tool result blocks contain search output; text block = final response)
    const text = (data.content || []).map(b => b.text || "").filter(Boolean).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in judge research response");

    const profile = JSON.parse(match[0]);
    return res.status(200).json({ profile, judgeName, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
