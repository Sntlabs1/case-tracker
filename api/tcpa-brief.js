// AI-generated case brief for a single TCPA / FDCPA / FCRA case, with KV
// caching so repeated views don't re-pay Anthropic tokens.
//
// GET  /api/tcpa-brief?id=<caseId>          → cached brief or { brief: null }
// POST /api/tcpa-brief  body: { id }        → generate, store, return

import { kv } from "@vercel/kv";
import { KEYS } from "../src/lib/tcpaSchema.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BRIEF_TTL = 30 * 24 * 3600; // 30 days

const SYSTEM_PROMPT =
  "You are a senior plaintiffs' attorney specializing in TCPA / FDCPA / FCRA " +
  "class actions. Write a concise case brief for a partner deciding whether to " +
  "pursue this matter. Reference the actual defendant, statute, and conduct. " +
  "Return ONLY valid JSON — no markdown, no commentary.";

function buildUserPrompt(c) {
  return `Analyze this case and return a JSON object with these exact keys:
{
  "summary": "<2-3 sentences: what the case is about, who the defendant is, what conduct is alleged>",
  "whoQualifies": "<2 sentences: who can be a class member — e.g. consumers in [state] who received [type] calls between [dates]>",
  "damagesExposure": "<1-2 sentences: typical statutory damages range under this statute and what the defendant's exposure is at scale>",
  "settlementTrajectory": "<1-2 sentences: where this case sits in the litigation lifecycle and what the next likely milestone is>",
  "intakeAngle": "<2 sentences: the most efficient way to find qualifying plaintiffs — phone records, debt collection letters, credit reports, etc. — and what to ask in a screening call>",
  "redFlags": ["<short specific risk>", "..."]
}

CASE DATA:
Caption: ${c.caption}
Statute: ${c.caseType}
Court: ${c.court?.name || "Unknown"} (${c.court?.jurisdiction || "unknown"})
Docket: ${c.court?.docket || "—"}
Filed: ${c.filingDate || "—"}
Status: ${c.status}
Defendants: ${(c.defendants || []).map((d) => d.displayName).join(", ") || "—"}
Conduct alleged: ${c.conductDescription || "—"}
Settlement fund: ${c.settlement?.totalFund ?? "—"}
Source: ${c.source}${c.sourceUrl ? ` (${c.sourceUrl})` : ""}`;
}

async function generateBrief(c) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(c) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Brief returned no JSON object");
  return JSON.parse(m[0]);
}

const briefKey = (id) => `tcpa:brief:${id}`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "id required" });
    const cached = await kv.get(briefKey(id)).catch(() => null);
    if (!cached) return res.status(200).json({ brief: null });
    const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
    return res.status(200).json({ brief: parsed.brief, generatedAt: parsed.generatedAt });
  }

  if (req.method === "POST") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });

    const caseRaw = await kv.get(KEYS.case(id));
    if (!caseRaw) return res.status(404).json({ error: "case not found" });
    const c = typeof caseRaw === "string" ? JSON.parse(caseRaw) : caseRaw;

    try {
      const brief = await generateBrief(c);
      const generatedAt = new Date().toISOString();
      await kv.set(briefKey(id), JSON.stringify({ brief, generatedAt }), { ex: BRIEF_TTL });
      return res.status(200).json({ brief, generatedAt, cached: false });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
}
