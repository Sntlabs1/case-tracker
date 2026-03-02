// POST /api/intake-site — generate a complete plaintiff intake website for a case
// Body: { lead: { analysis: {...}, title: "...", ... } }
// Returns: { id, previewUrl, defendant, caseName, generatedAt }
// The generated HTML is stored in KV for 30 days and served by api/intake.js

import { kv } from "@vercel/kv";
import { createHash } from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INTAKE_TTL = 30 * 24 * 3600; // 30 days

function generateId(seed) {
  return createHash("sha256").update(seed + Date.now()).digest("hex").slice(0, 12);
}

const INTAKE_SYSTEM_PROMPT = `You are a legal web developer building a case inquiry website for a law firm. Generate a complete, self-contained HTML page that allows people affected by a legal matter to learn about their rights, check if they may qualify for legal representation, and submit their contact information for a free case review.

PAGE SECTIONS (in order):
1. Navigation — firm name "Your Law Firm", phone "(555) 000-0000", "Free Case Review" button
2. Hero — headline about the legal matter, one-sentence summary, "Check If You Qualify" anchor button
3. Background section — 3-4 plain-language paragraphs explaining the legal matter, who may be affected, and what their rights are
4. Eligibility section — bullet checklist of qualifying criteria with checkboxes (HTML checkbox inputs, disabled, some pre-checked as examples), "Start Free Review" button anchoring to the contact form
5. Contact form (id="contact-form"):
   - Name, email, phone, city, state/territory dropdown, zip
   - Case-relevant fields based on the matter (dates, product names, relevant yes/no questions as checkboxes)
   - "Describe your situation" textarea
   - Document upload field (type="file", multiple)
   - Submit button; on submit: preventDefault, validate required fields, replace form with a styled confirmation message
6. Records to locate — checklist of documents that may support the claim, with note that the firm assists with gathering them
7. Representation agreement summary — card explaining the contingency fee structure (no upfront cost, fee only if successful), what the firm handles, typed name field + agreement checkbox + auto-filled date
8. Common questions — 5 Q&A items relevant to this type of matter
9. Footer — firm name, "Attorney advertising. Prior results do not guarantee similar outcomes.", bar number placeholder

TECHNICAL:
- Return ONLY raw HTML starting with <!DOCTYPE html> — no markdown, no code fences
- Self-contained: all CSS inline in <style> tag, all JS inline in <script> tag
- Google Fonts CDN allowed: Montserrat (headings) + Inter (body)
- Colors: body background #0a0f1e, card background #111827, gold accent #c4a44a, white text, green #22c55e
- Mobile-responsive via CSS flexbox/grid and media queries
- Smooth scroll, sticky nav, modern card styling with shadows
- Professional, trustworthy law firm aesthetic — NOT a template site, looks custom-built

CRITICAL:
- Return ONLY the raw HTML. No markdown code fences. No explanation text. Start with exactly: <!DOCTYPE html>
- The page must be 100% functional as a standalone .html file
- All JavaScript must be inline in <script> tags
- Form submission uses JavaScript: event.preventDefault(), validate fields, show inline thank-you message replacing the form`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { lead } = req.body;
  if (!lead) return res.status(400).json({ error: "lead required" });

  const a = lead.analysis || {};

  // Build a compact, information-rich case summary for Claude
  const lines = [
    `Defendant: ${a.defendantProfile?.name || "Unknown"}`,
    `Case Type: ${a.caseType || "Unknown"}`,
    `Headline: ${a.headline || lead.title || ""}`,
    `Executive Summary: ${a.executiveSummary || ""}`,
    a.plaintiffProfile?.requiredInjury ? `Required Injury: ${a.plaintiffProfile.requiredInjury}` : null,
    a.plaintiffProfile?.demographics ? `Target Demographics: ${a.plaintiffProfile.demographics}` : null,
    a.plaintiffProfile?.injuryTimeframe ? `Injury Timeframe: ${a.plaintiffProfile.injuryTimeframe}` : null,
    a.plaintiffProfile?.disqualifiers ? `Disqualifiers: ${a.plaintiffProfile.disqualifiers}` : null,
    (a.plaintiffProfile?.documentationNeeded || []).length
      ? `Documents Needed: ${a.plaintiffProfile.documentationNeeded.join(", ")}` : null,
    (a.plaintiffProfile?.whereToFind || []).length
      ? `Where Plaintiffs Are Found: ${a.plaintiffProfile.whereToFind.join(", ")}` : null,
    a.damagesModel?.perClaimantRange ? `Per-Claimant Damages: ${a.damagesModel.perClaimantRange}` : null,
    a.damagesModel?.totalFundEstimate ? `Total Fund Estimate: ${a.damagesModel.totalFundEstimate}` : null,
    a.timeline?.statuteOfLimitationsNote ? `Statute of Limitations: ${a.timeline.statuteOfLimitationsNote}` : null,
    a.timeline?.urgencyReason ? `Urgency: ${a.timeline.urgencyReason}` : null,
    (a.causesOfAction || []).length
      ? `Legal Claims: ${a.causesOfAction.map(c => c.name).join(", ")}` : null,
    (a.plaintiffProfile?.geographicHotspots || []).length
      ? `Geographic Hotspots: ${a.plaintiffProfile.geographicHotspots.join(", ")}` : null,
    a.plaintiffProfile?.acquisitionHook ? `Key Message Hook: ${a.plaintiffProfile.acquisitionHook}` : null,
    a.regulatoryStatus?.fdaAction ? `FDA Action: ${a.regulatoryStatus.fdaAction}` : null,
    a.regulatoryStatus?.nhtsaAction ? `NHTSA Action: ${a.regulatoryStatus.nhtsaAction}` : null,
    a.regulatoryStatus?.cpscAction ? `CPSC Action: ${a.regulatoryStatus.cpscAction}` : null,
    a.defendantProfile?.vulnerability ? `Defendant Vulnerability: ${a.defendantProfile.vulnerability}` : null,
    a.caseStage ? `Case Stage: ${a.caseStage}` : null,
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
        max_tokens: 8000,
        system: INTAKE_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Generate the complete plaintiff intake website for this class action case:\n\n${lines}`,
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Anthropic error ${response.status}`);

    const html = (data.content || []).map(b => b.text || "").join("").trim();

    // Strip markdown fences if Claude wrapped it anyway
    const cleanHtml = html
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    if (!cleanHtml.toLowerCase().startsWith("<!doctype") && !cleanHtml.toLowerCase().startsWith("<html")) {
      throw new Error("Generated content is not valid HTML");
    }

    const defendant = a.defendantProfile?.name || "Unknown";
    const caseName = a.headline || lead.title || "Case Intake";
    const id = generateId(lead.id || caseName);

    // Store HTML and metadata in KV (30-day TTL)
    await kv.set(`intake:${id}`, cleanHtml, { ex: INTAKE_TTL });
    await kv.set(`intake:meta:${id}`, JSON.stringify({
      defendant,
      caseName,
      caseType: a.caseType || "Unknown",
      leadId: lead.id || null,
      generatedAt: new Date().toISOString(),
    }), { ex: INTAKE_TTL });

    return res.status(200).json({
      id,
      previewUrl: `/api/intake?id=${id}`,
      defendant,
      caseName,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
