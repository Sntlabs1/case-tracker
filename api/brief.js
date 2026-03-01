// POST /api/brief — generate a Plaintiff Acquisition Brief for a single lead

const BRIEF_PROMPT = `You are a senior plaintiff litigation strategist. Given an intelligence lead about a potential class action, produce a one-page Plaintiff Acquisition Brief for the firm's intake team.

Return ONLY a JSON object (no markdown, no explanation). Schema:
{
  "targetDemographics": "who we are looking for — age, geography, product use, exposure window",
  "outreachScript": "exact 2-3 sentence phone/text script for intake team to use",
  "qualificationCriteria": ["criterion 1", "criterion 2", "criterion 3"],
  "disqualifiers": ["disqualifier 1", "disqualifier 2"],
  "intakeQuestions": ["question 1", "question 2", "question 3", "question 4", "question 5"],
  "intakeDocs": ["document 1", "document 2", "document 3"],
  "whereToFind": ["channel 1", "channel 2", "channel 3"],
  "geographicHotspots": ["location 1", "location 2"],
  "competitorNote": "which plaintiff firms are likely already working this and what that means",
  "urgencyNote": "why speed matters — SOL, first-mover window, consolidation risk"
}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { context } = req.body;
  if (!context) return res.status(400).json({ error: "context required" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: BRIEF_PROMPT,
        messages: [{ role: "user", content: `Generate a Plaintiff Acquisition Brief for this lead:\n\n${context}` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Anthropic API error ${response.status}`);

    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    const brief = JSON.parse(match[0]);
    return res.status(200).json({ brief });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
