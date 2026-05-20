// POST /api/enrich-settlement
// Body: { caseId, caption, defendants: ["..."], claimPortalUrl? }
//
// Uses Claude to extract settlement administrator details, per-claimant
// amounts, claim requirements, and claim portal URLs for a given case.
// Results are returned to the UI for review before saving — not auto-saved.

import { kv } from "@vercel/kv";
import { KEYS } from "../src/lib/tcpaSchema.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  return (await r.json()).content?.[0]?.text || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { caseId, caption, defendants = [], claimPortalUrl } = req.body || {};
  if (!caption && !caseId) return res.status(400).json({ error: "caption or caseId required" });

  // Load existing case data to give Claude context
  let existingCase = null;
  if (caseId) {
    const raw = await kv.get(KEYS.case(caseId)).catch(() => null);
    if (raw) existingCase = typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  const caseName   = caption || existingCase?.caption || "";
  const defNames   = defendants.length ? defendants : (existingCase?.defendants || []).map(d => d.displayName);
  const portalHint = claimPortalUrl || existingCase?.settlement?.claimPortalUrl || "";

  const prompt = `You are a legal research assistant for a plaintiff litigation firm.

Extract settlement administrator details for this class action lawsuit from your knowledge. If you don't know a specific field with confidence, return null — do NOT guess.

Case: ${caseName}
Defendants: ${defNames.join(", ")}
${portalHint ? `Known claim portal: ${portalHint}` : ""}

Return ONLY a JSON object with these fields (null if unknown):
{
  "adminName": "full name of the settlement administrator company",
  "adminPhone": "toll-free phone number for claimants",
  "adminEmail": "email address for claimant inquiries",
  "adminWebsite": "URL of the administrator's website",
  "claimPortalUrl": "direct URL to file a claim",
  "claimWindowCloses": "YYYY-MM-DD deadline",
  "perClaimantRange": "e.g. $75 flat or $20-$40",
  "totalFund": "total settlement fund e.g. $5,975,000",
  "claimRequirements": "who qualifies — exact class definition or eligibility criteria"
}`;

  try {
    const raw = callClaude(prompt);
    const text = await raw;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(200).json({ settlement: null, note: "Claude could not extract details" });
    const settlement = JSON.parse(m[0]);
    // Strip null values
    const clean = Object.fromEntries(Object.entries(settlement).filter(([, v]) => v !== null && v !== ""));
    return res.status(200).json({ settlement: clean, source: "claude-knowledge" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
