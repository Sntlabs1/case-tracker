// POST /api/analyze — shared non-streaming Claude endpoint for all frontend features
// Body: { prompt, system?, maxTokens?, tools? }
// Returns: { text }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Whitelist of tool types that callers are permitted to enable.
// Only Anthropic server-side tools that require no client-side execution are allowed.
const ALLOWED_TOOLS = ['web_search_20250305'];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, system, maxTokens } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  // Cap maxTokens to prevent runaway usage.
  const safeMaxTokens = Math.min(parseInt(maxTokens, 10) || 2048, 4096);

  // Filter requested tools against the server-side whitelist.
  // Arbitrary tool injection from unauthenticated callers is blocked.
  const rawTools = Array.isArray(req.body.tools) ? req.body.tools : [];
  const tools = rawTools.filter(t => ALLOWED_TOOLS.includes(t.type || t.name));

  try {
    const body = {
      model: "claude-opus-4-8",
      max_tokens: safeMaxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) body.system = system;
    if (tools.length > 0) body.tools = tools;

    // web_search_20250305 is an Anthropic server-side tool that requires a beta header.
    const needsWebSearchBeta = tools.some(t => t.type === 'web_search_20250305');
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };
    if (needsWebSearchBeta) headers["anthropic-beta"] = "web-search-2025-03-05";

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `Anthropic error ${r.status}`);

    // Extract all text content blocks (web_search responses interleave web_search_result
    // and text blocks; we only forward the text to the client).
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text || "")
      .filter(Boolean)
      .join("\n");
    if (!text) {
      return res.status(502).json({ error: 'Model returned no text content', stop_reason: data.stop_reason });
    }
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
