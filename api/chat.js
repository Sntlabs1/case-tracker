// POST /api/chat — streaming proxy for Platform Intelligence Chat
// Body: { messages: [{role, content},...], system: "..." }
// Pipes Anthropic SSE stream back to the browser so the API key stays server-side

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "messages required" });

  // Stream SSE back to the browser
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
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        stream: true,
        system,
        messages,
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      res.write(`data: ${JSON.stringify({ type: "error", error: { message: `Anthropic ${upstream.status}: ${txt.slice(0, 300)}` } })}\n\n`);
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
