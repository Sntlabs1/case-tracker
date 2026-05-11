// Platform Intelligence Chat — server-side proxy that gives Claude tools to
// query the live KV store (cases, defendants, leads, source health) so it can
// answer questions about the actual platform state, not just the static KB.
//
// Protocol:
//   POST /api/chat  body: { messages: [...], system: "..." }
//   Response: SSE stream of events:
//     event: tool_use   data: { name, input }      (one per tool call requested)
//     event: tool_result data: { name, ok }        (one per tool call result)
//     data: <Anthropic SSE event>                  (final assistant message stream)
//     event: done       data: {}
//
// We loop server-side (up to MAX_TOOL_TURNS) executing tools, then stream the
// final assistant text to the browser. The client renders tool_use chips in
// the UI for transparency.

import { TOOL_SCHEMAS, executeTool } from "./_chat-tools.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_TOOL_TURNS = 6;
const MODEL = "claude-sonnet-4-6";

function emitSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function callAnthropic({ system, messages, stream }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      stream: !!stream,
      system,
      tools: TOOL_SCHEMAS,
      messages,
    }),
  });
  return res;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages: incoming, system } = req.body || {};
  if (!incoming?.length) return res.status(400).json({ error: "messages required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Working copy — we may append assistant + tool_result turns to it.
  const messages = JSON.parse(JSON.stringify(incoming));

  try {
    // ── Tool loop: up to MAX_TOOL_TURNS rounds of tool_use → tool_result. ────
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      // Non-streaming for the tool-decision step — we need the full response
      // to inspect for tool_use blocks.
      const upstream = await callAnthropic({ system, messages, stream: false });
      if (!upstream.ok) {
        const txt = await upstream.text();
        emitSse(res, "error", { message: `Anthropic ${upstream.status}: ${txt.slice(0, 300)}` });
        return res.end();
      }
      const data = await upstream.json();
      const blocks = data.content || [];
      const toolUses = blocks.filter((b) => b.type === "tool_use");

      if (toolUses.length === 0) {
        // No more tools — emit the final text directly and finish.
        for (const block of blocks) {
          if (block.type === "text" && block.text) {
            // Mimic the SSE chunk shape the client already parses.
            emitSse(res, null, {
              type: "content_block_delta",
              delta: { type: "text_delta", text: block.text },
            });
          }
        }
        emitSse(res, "done", { stopReason: data.stop_reason, usage: data.usage });
        return res.end();
      }

      // Surface tool calls to the UI before running them.
      for (const tu of toolUses) {
        emitSse(res, "tool_use", { name: tu.name, input: tu.input, id: tu.id });
      }

      // Append the assistant turn (with its tool_use blocks) to the conversation.
      messages.push({ role: "assistant", content: blocks });

      // Execute each tool and build a single user message containing all tool_results.
      const toolResultBlocks = [];
      for (const tu of toolUses) {
        const result = await executeTool(tu.name, tu.input);
        const isError = !!result?.error;
        emitSse(res, "tool_result", {
          name: tu.name,
          id: tu.id,
          ok: !isError,
          ...(isError ? { error: result.error } : { summary: summarizeToolResult(tu.name, result) }),
        });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 50_000), // cap at 50KB per result
          is_error: isError,
        });
      }
      messages.push({ role: "user", content: toolResultBlocks });
    }

    // Hit the turn cap without a final answer — surface as an error.
    emitSse(res, "error", { message: `tool loop exceeded ${MAX_TOOL_TURNS} turns without a final answer` });
    res.end();
  } catch (e) {
    emitSse(res, "error", { message: e.message });
    res.end();
  }
}

// Return a one-line summary of a tool result for the UI chip — keeps the chat
// transcript compact while still showing the user what was retrieved.
function summarizeToolResult(name, result) {
  if (name === "search_cases")        return `${result.total ?? 0} cases matched`;
  if (name === "search_leads")        return `${result.total ?? 0} leads matched`;
  if (name === "search_defendants")   return `${result.total ?? 0} defendants matched`;
  if (name === "get_defendant_cases") return `${result.total ?? 0} cases for this defendant`;
  if (name === "get_case")            return result.case?.caption || "case loaded";
  if (name === "get_platform_state")  {
    const c = result.counts?.tcpaCases?.total;
    const l = result.counts?.leads?.total;
    return `state: ${c ?? "?"} cases · ${l ?? "?"} leads`;
  }
  if (name === "get_source_health")   {
    const h = result.byHealth || {};
    return `sources: ${h.green || 0} healthy · ${h.yellow || 0} degraded · ${h.red || 0} down`;
  }
  return "";
}
