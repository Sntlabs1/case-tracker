// POST /api/analyze — shared non-streaming Claude endpoint for all frontend features
// Body: { prompt, system?, maxTokens?, tools? }
// Returns: { text }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, system, maxTokens = 1500, tools } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `Anthropic error ${r.status}`);

    const text = (data.content || []).map(b => b.text || "").filter(Boolean).join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
