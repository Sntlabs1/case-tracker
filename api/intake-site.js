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

const INTAKE_SYSTEM_PROMPT = `You are a plaintiff law firm web developer. Generate a complete, self-contained HTML intake website for a class action lawsuit. This page will be shared with potential plaintiffs to explain the case, qualify them, collect their contact information, have them sign a contingency fee agreement, and request documents.

REQUIRED SECTIONS:
1. Navigation bar — firm name placeholder ("Your Law Firm"), phone placeholder, "Free Consultation" button
2. Hero — large headline ("Were you harmed by [product/defendant]?"), sub-headline explaining the case in one sentence, a bold stat or deadline if available, "See If You Qualify" CTA button
3. "What Happened" — plain-English 3-4 paragraph explanation of the defendant's alleged misconduct, who was affected, and why this lawsuit exists. No legal jargon.
4. "Do You Qualify?" — eligibility checklist (use <input type="checkbox" disabled checked/unchecked>) showing specific criteria. Include a "Start Your Free Claim Review" button at the bottom.
5. Intake Form — the most important section. Fields must be case-specific:
   - Full legal name, email, phone, city, state, zip
   - Injury/exposure-specific fields (generate based on case type)
   - Approximate date of injury/use/exposure
   - Brief description textarea
   - Qualifying checkboxes (did you use X product? Did you experience Y injury?)
   - File upload placeholder for key documents
   - Submit button "Submit My Claim for Review"
   - Form uses onsubmit with JavaScript to show a thank-you message (no real backend needed)
6. "Documents to Gather" — styled checklist of specific documents needed for the case, with a note that the firm will help gather them
7. Contingency Fee Agreement — styled as a legal agreement card:
   - "No fees unless we win" headline
   - 33% contingency fee explanation
   - What the firm covers (filing fees, expert costs, etc.)
   - E-signature: typed name input + checkbox "I agree to the terms above" + date auto-filled
   - Submit agreement button (JS-handled, shows confirmation)
8. FAQ — 5-6 relevant questions and answers specific to this case type
9. Footer — firm name, disclaimer ("This is attorney advertising. Prior results do not guarantee similar outcomes."), state bar disclaimer

DESIGN REQUIREMENTS:
- Fully self-contained HTML — inline all CSS, no external CSS files
- You MAY use Google Fonts CDN: <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
- Color scheme: background #0a0f1e (dark navy), cards #111827, accent #c4a44a (gold), text white, success #22c55e, danger #ef4444
- Mobile responsive with CSS media queries
- Smooth scroll behavior
- Modern card UI with border-radius, subtle shadows
- Sticky navigation
- Section IDs for anchor links: #qualify, #form, #documents, #fee-agreement, #faq
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
