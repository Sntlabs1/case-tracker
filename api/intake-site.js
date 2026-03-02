// POST /api/intake-site — generate a plaintiff intake website for a case
// Strategy: Claude generates JSON content only; HTML is built from a hardcoded template
// This avoids content filter issues with asking Claude to generate HTML intake forms

import { kv } from "@vercel/kv";
import { createHash } from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INTAKE_TTL = 30 * 24 * 3600; // 30 days

function generateId(seed) {
  return createHash("sha256").update(seed + Date.now()).digest("hex").slice(0, 12);
}

// Claude generates ONLY structured JSON text content — no HTML, no filter issues
const CONTENT_SYSTEM_PROMPT = `You write informational web copy for law firm case pages. Given a legal matter, produce structured page content as JSON.

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "caseTitle": "<short title, e.g. 'Johnson & Johnson Talcum Powder Litigation'>",
  "heroHeadline": "<compelling headline for people who may be affected, e.g. 'Did You Develop Cancer After Using Johnson Talcum Powder?'>",
  "heroSubheadline": "<1 sentence: who may qualify and what the firm offers, e.g. 'People diagnosed with ovarian cancer after using J&J baby powder may qualify for compensation. Free case review.'>",
  "urgencyNote": "<why act soon — deadline, statute of limitations, or competing firm activity. Keep under 15 words. Omit if not applicable.>",
  "backgroundParagraphs": [
    "<paragraph 1 — what the defendant did or failed to do>",
    "<paragraph 2 — who was affected and how>",
    "<paragraph 3 — what legal action is being pursued>"
  ],
  "eligibilityCriteria": [
    "<specific criterion 1>",
    "<criterion 2>",
    "<criterion 3>",
    "<criterion 4>"
  ],
  "disqualifiers": [
    "<hard disqualifier 1>",
    "<disqualifier 2>"
  ],
  "caseFormFields": [
    { "label": "<field label>", "type": "text|date|select|checkbox", "placeholder": "<placeholder text or empty string>", "options": ["<opt1>", "<opt2>"] }
  ],
  "documentsNeeded": [
    "<document 1>",
    "<document 2>",
    "<document 3>",
    "<document 4>"
  ],
  "faq": [
    { "q": "<question 1>", "a": "<answer 1>" },
    { "q": "<question 2>", "a": "<answer 2>" },
    { "q": "<question 3>", "a": "<answer 3>" },
    { "q": "<question 4>", "a": "<answer 4>" },
    { "q": "<question 5>", "a": "<answer 5>" }
  ]
}

caseFormFields should be 3-5 case-specific fields beyond the standard contact fields. Examples: date of diagnosis, product name/model, duration of use, specific yes/no questions as checkbox type. For select type, include options array. For others, options can be empty array.`;

// ─── HTML TEMPLATE BUILDER ────────────────────────────────────────────────────
// Builds a complete, professional, self-contained HTML page from the JSON content

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(c) {
  const criteriaHtml = (c.eligibilityCriteria || []).map(item =>
    `<li class="criteria-item"><span class="icon-check">&#10003;</span><span>${esc(item)}</span></li>`
  ).join("");

  const disqualHtml = (c.disqualifiers || []).length
    ? `<div class="disq-label">You likely do not qualify if:</div><ul class="disq-list">${
        (c.disqualifiers || []).map(d =>
          `<li class="disq-item"><span class="icon-x">&#10007;</span><span>${esc(d)}</span></li>`
        ).join("")
      }</ul>`
    : "";

  const bgHtml = (c.backgroundParagraphs || []).map(p => `<p>${esc(p)}</p>`).join("");

  const caseFieldsHtml = (c.caseFormFields || []).map(f => {
    const name = esc(f.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (f.type === "select" && (f.options || []).length) {
      return `<div class="fg"><label>${esc(f.label)}</label><select name="${name}"><option value="">-- Select --</option>${
        f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("")
      }</select></div>`;
    }
    if (f.type === "checkbox") {
      return `<div class="fg fg-full"><label class="cb-label"><input type="checkbox" name="${name}"><span>${esc(f.label)}</span></label></div>`;
    }
    return `<div class="fg"><label>${esc(f.label)}</label><input type="${esc(f.type || "text")}" name="${name}" placeholder="${esc(f.placeholder || "")}"></div>`;
  }).join("");

  const docsHtml = (c.documentsNeeded || []).map((d, i) =>
    `<li class="doc-item"><input type="checkbox" id="d${i}"><label for="d${i}">${esc(d)}</label></li>`
  ).join("");

  const faqHtml = (c.faq || []).map((item, i) =>
    `<div class="faq-item" onclick="this.classList.toggle('open')">
      <div class="faq-q"><span>${esc(item.q)}</span><span class="faq-arr">&#9662;</span></div>
      <div class="faq-a">${esc(item.a)}</div>
    </div>`
  ).join("");

  const urgencyBanner = c.urgencyNote
    ? `<div class="urgency-note">&#9888; ${esc(c.urgencyNote)}</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.caseTitle)} — Free Case Review</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:#0a0f1e;color:#e0e0e0;line-height:1.6}
h1,h2,h3,h4{font-family:'Montserrat',sans-serif}
a{color:inherit;text-decoration:none}

/* NAV */
nav{position:sticky;top:0;z-index:100;background:rgba(10,15,30,.97);backdrop-filter:blur(8px);border-bottom:1px solid rgba(196,164,74,.2);padding:14px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.nav-firm{font-family:'Montserrat',sans-serif;font-weight:800;font-size:18px;color:#c4a44a;letter-spacing:.04em}
.nav-phone{font-size:13px;color:#777}
.nav-btn{background:#c4a44a;color:#0a0f1e;font-family:'Montserrat',sans-serif;font-weight:700;font-size:13px;padding:8px 18px;border-radius:6px;border:none;cursor:pointer;white-space:nowrap}
.nav-btn:hover{background:#d4b45a}

/* HERO */
.hero{padding:80px 24px 60px;text-align:center;background:linear-gradient(180deg,#0d1628 0%,#0a0f1e 100%);border-bottom:1px solid rgba(196,164,74,.15)}
.hero h1{font-size:clamp(26px,5vw,46px);font-weight:800;color:#fff;margin-bottom:18px;line-height:1.2;max-width:820px;margin-left:auto;margin-right:auto}
.hero p{font-size:17px;color:#aaa;max-width:620px;margin:0 auto 32px}
.hero-cta{display:inline-block;background:#c4a44a;color:#0a0f1e;font-family:'Montserrat',sans-serif;font-weight:800;font-size:16px;padding:16px 40px;border-radius:8px;border:none;cursor:pointer;transition:background .2s}
.hero-cta:hover{background:#d4b45a}
.urgency-note{margin-top:22px;font-size:13px;color:#ef4444;font-weight:600}

/* LAYOUT */
.wrap{max-width:900px;margin:0 auto;padding:60px 24px}
.sec-label{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#c4a44a;margin-bottom:10px}
.sec-title{font-size:clamp(22px,4vw,30px);font-weight:800;color:#fff;margin-bottom:20px}
.card{background:#111827;border-radius:12px;padding:28px 32px;border:1px solid rgba(255,255,255,.06);margin-bottom:20px;box-shadow:0 4px 24px rgba(0,0,0,.3)}
hr.div{border:none;border-top:1px solid rgba(255,255,255,.05)}
@media(max-width:600px){.card{padding:20px 18px}}

/* BACKGROUND */
.bg-text p{color:#b0b0c8;line-height:1.8;margin-bottom:16px;font-size:15px}

/* ELIGIBILITY */
.criteria-list,.disq-list{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:16px}
.criteria-item,.disq-item{display:flex;gap:12px;align-items:flex-start;font-size:14px;color:#d0d0e8;padding:10px 14px;background:rgba(255,255,255,.03);border-radius:8px}
.icon-check{color:#22c55e;font-weight:700;font-size:15px;flex-shrink:0;margin-top:1px}
.icon-x{color:#ef4444;font-weight:700;font-size:15px;flex-shrink:0;margin-top:1px}
.disq-label{font-size:12px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.08em;margin:18px 0 10px}
.qualify-btn{display:block;width:100%;text-align:center;background:#22c55e;color:#0a0f1e;font-family:'Montserrat',sans-serif;font-weight:800;font-size:15px;padding:16px;border-radius:8px;border:none;cursor:pointer;margin-top:22px;transition:background .2s}
.qualify-btn:hover{background:#16a34a}

/* FORM */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:600px){.form-grid{grid-template-columns:1fr}}
.fg{display:flex;flex-direction:column;gap:6px}
.fg-full{grid-column:1/-1}
.fg label{font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.06em}
.fg input,.fg select,.fg textarea{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#e0e0f0;font-family:'Inter',sans-serif;font-size:14px;padding:10px 14px;border-radius:8px;outline:none;transition:border-color .2s}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-color:#c4a44a}
.fg textarea{resize:vertical;min-height:100px}
.fg select option{background:#111827}
.cb-label{display:flex;gap:10px;align-items:center;font-size:14px;color:#d0d0e8;cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0}
.form-note{font-size:12px;color:#555;margin:16px 0 12px;grid-column:1/-1}
.form-submit{width:100%;background:#c4a44a;color:#0a0f1e;font-family:'Montserrat',sans-serif;font-weight:800;font-size:16px;padding:16px;border-radius:8px;border:none;cursor:pointer;margin-top:10px;transition:background .2s}
.form-submit:hover{background:#d4b45a}
.form-success{display:none;text-align:center;padding:44px 20px}
.form-success h3{font-size:22px;color:#22c55e;margin-bottom:12px}
.form-success p{color:#888;font-size:15px}

/* DOCUMENTS */
.doc-list{list-style:none;display:flex;flex-direction:column;gap:10px}
.doc-item{display:flex;gap:12px;align-items:flex-start;font-size:14px;color:#d0d0e8}
.doc-item input[type="checkbox"]{margin-top:3px;accent-color:#c4a44a;width:16px;height:16px;flex-shrink:0;cursor:pointer}
.doc-item label{cursor:pointer;line-height:1.5}
.doc-note{margin-top:16px;font-size:13px;color:#555;font-style:italic}

/* FEE */
.fee-card{background:linear-gradient(135deg,#111827 0%,#0d1628 100%);border:1px solid rgba(196,164,74,.3);border-radius:12px;padding:32px}
.fee-hl{font-size:22px;font-weight:800;color:#c4a44a;margin-bottom:8px}
.fee-sub{color:#888;font-size:14px;margin-bottom:22px}
.fee-pts{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:26px}
.fee-pts li{display:flex;gap:10px;font-size:14px;color:#d0d0e8}
.fee-pts li::before{content:"✓";color:#22c55e;font-weight:700;flex-shrink:0}
.fee-row{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:end;margin-bottom:14px}
@media(max-width:600px){.fee-row{grid-template-columns:1fr}}
.fee-sig{background:rgba(255,255,255,.05);border:1px solid rgba(196,164,74,.3);color:#e0e0f0;font-size:14px;padding:10px 14px;border-radius:8px;width:100%;outline:none;font-style:italic}
.fee-date{font-size:13px;color:#555;white-space:nowrap;padding-bottom:12px}
.fee-agree{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#888;margin-bottom:16px;cursor:pointer}
.fee-agree input{margin-top:2px;accent-color:#c4a44a;width:16px;height:16px;flex-shrink:0;cursor:pointer}
.fee-ack-btn{background:rgba(196,164,74,.15);color:#c4a44a;border:1px solid rgba(196,164,74,.4);font-family:'Montserrat',sans-serif;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;cursor:pointer;transition:background .2s}
.fee-ack-btn:hover{background:rgba(196,164,74,.25)}
.fee-confirmed{display:none;padding:14px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;color:#22c55e;font-size:14px;text-align:center;margin-top:12px}

/* FAQ */
.faq-item{border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer}
.faq-q{display:flex;justify-content:space-between;align-items:center;padding:18px 4px;font-size:15px;font-weight:600;color:#e0e0f0;gap:12px}
.faq-arr{color:#c4a44a;font-size:18px;flex-shrink:0;transition:transform .2s}
.faq-a{max-height:0;overflow:hidden;color:#888;font-size:14px;line-height:1.7;transition:max-height .3s ease,padding .3s ease;padding:0 4px}
.faq-item.open .faq-a{max-height:400px;padding:0 4px 18px}
.faq-item.open .faq-arr{transform:rotate(180deg)}

/* FOOTER */
footer{background:#060b18;border-top:1px solid rgba(255,255,255,.05);padding:32px 24px;text-align:center}
.footer-firm{font-family:'Montserrat',sans-serif;font-weight:700;color:#c4a44a;font-size:16px;margin-bottom:10px}
.footer-disc{font-size:11px;color:#444;line-height:1.6;max-width:700px;margin:0 auto}
</style>
</head>
<body>

<nav>
  <div class="nav-firm">Your Law Firm</div>
  <div class="nav-phone">(555) 000-0000</div>
  <a href="#contact-form" class="nav-btn">Free Case Review</a>
</nav>

<div class="hero">
  <h1>${esc(c.heroHeadline)}</h1>
  <p>${esc(c.heroSubheadline)}</p>
  <a href="#contact-form" class="hero-cta">See If You Qualify &mdash; Free Review</a>
  ${urgencyBanner}
</div>

<hr class="div">

<div class="wrap" id="background">
  <div class="sec-label">What Happened</div>
  <div class="sec-title">The Legal Matter Explained</div>
  <div class="card bg-text">${bgHtml}</div>
</div>

<hr class="div">

<div class="wrap" id="qualify">
  <div class="sec-label">Eligibility</div>
  <div class="sec-title">Do You Qualify?</div>
  <div class="card">
    <p style="color:#888;font-size:14px;margin-bottom:18px">You may qualify for legal representation if you meet the following criteria:</p>
    <ul class="criteria-list">${criteriaHtml}</ul>
    ${disqualHtml}
    <a href="#contact-form" class="qualify-btn">Start Your Free Case Review</a>
  </div>
</div>

<hr class="div">

<div class="wrap" id="contact-form">
  <div class="sec-label">Get Started</div>
  <div class="sec-title">Free Case Review</div>
  <div class="card">
    <div id="form-wrap">
      <form id="intake-form" novalidate>
        <div class="form-grid">
          <div class="fg"><label>Full Legal Name *</label><input type="text" name="full_name" placeholder="First and Last Name" required></div>
          <div class="fg"><label>Email Address *</label><input type="email" name="email" placeholder="you@example.com" required></div>
          <div class="fg"><label>Phone Number *</label><input type="tel" name="phone" placeholder="(555) 000-0000" required></div>
          <div class="fg"><label>State</label>
            <select name="state"><option value="">-- Select State --</option>
            <option>Alabama</option><option>Alaska</option><option>Arizona</option><option>Arkansas</option><option>California</option><option>Colorado</option><option>Connecticut</option><option>Delaware</option><option>Florida</option><option>Georgia</option><option>Hawaii</option><option>Idaho</option><option>Illinois</option><option>Indiana</option><option>Iowa</option><option>Kansas</option><option>Kentucky</option><option>Louisiana</option><option>Maine</option><option>Maryland</option><option>Massachusetts</option><option>Michigan</option><option>Minnesota</option><option>Mississippi</option><option>Missouri</option><option>Montana</option><option>Nebraska</option><option>Nevada</option><option>New Hampshire</option><option>New Jersey</option><option>New Mexico</option><option>New York</option><option>North Carolina</option><option>North Dakota</option><option>Ohio</option><option>Oklahoma</option><option>Oregon</option><option>Pennsylvania</option><option>Rhode Island</option><option>South Carolina</option><option>South Dakota</option><option>Tennessee</option><option>Texas</option><option>Utah</option><option>Vermont</option><option>Virginia</option><option>Washington</option><option>West Virginia</option><option>Wisconsin</option><option>Wyoming</option>
            </select>
          </div>
          <div class="fg"><label>City</label><input type="text" name="city" placeholder="Your city"></div>
          <div class="fg"><label>ZIP Code</label><input type="text" name="zip" placeholder="00000"></div>
          ${caseFieldsHtml}
          <div class="fg fg-full"><label>Describe Your Situation *</label><textarea name="description" placeholder="Please describe what happened and how it affected you..." required></textarea></div>
          <div class="fg fg-full"><label>Supporting Documents (optional)</label><input type="file" name="documents" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
          <p class="form-note">By submitting you agree to be contacted about your potential claim. No attorney-client relationship is formed until a signed retainer agreement is in place.</p>
        </div>
        <button type="submit" class="form-submit">Submit My Information for a Free Review</button>
      </form>
      <div class="form-success" id="form-success">
        <h3>&#10003; We Received Your Information</h3>
        <p>A member of our team will contact you within 24&ndash;48 hours to discuss your situation.</p>
        <p style="margin-top:12px;font-size:13px;color:#555">Urgent questions? Call us at (555) 000-0000.</p>
      </div>
    </div>
  </div>
</div>

<hr class="div">

<div class="wrap" id="documents">
  <div class="sec-label">Preparation</div>
  <div class="sec-title">Records to Locate</div>
  <div class="card">
    <p style="color:#888;font-size:14px;margin-bottom:18px">Gathering these records now will help move your case forward. Our team can assist with obtaining anything you are missing.</p>
    <ul class="doc-list">${docsHtml}</ul>
    <p class="doc-note">Don&rsquo;t worry if you cannot locate everything. We work with records services and can often obtain them on your behalf.</p>
  </div>
</div>

<hr class="div">

<div class="wrap" id="fee-agreement">
  <div class="sec-label">Our Agreement</div>
  <div class="sec-title">No Fee Unless We Win</div>
  <div class="fee-card">
    <div class="fee-hl">Contingency Fee Representation</div>
    <div class="fee-sub">You pay nothing upfront. Our fee is only collected from any recovery we obtain for you.</div>
    <ul class="fee-pts">
      <li>No upfront costs or retainer fees required</li>
      <li>We advance all litigation costs (filing fees, experts, depositions)</li>
      <li>If we do not recover for you, you owe us nothing</li>
      <li>You will receive a full written retainer agreement before any work begins</li>
      <li>You may end the representation at any time</li>
    </ul>
    <div class="fee-row">
      <div>
        <label style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px">Type Your Full Name to Acknowledge</label>
        <input type="text" id="fee-name" class="fee-sig" placeholder="Full legal name">
      </div>
      <div class="fee-date" id="fee-date"></div>
    </div>
    <label class="fee-agree">
      <input type="checkbox" id="fee-check">
      <span>I acknowledge the contingency fee structure above. I understand this is not a binding retainer &mdash; a full written agreement will be provided separately.</span>
    </label>
    <button class="fee-ack-btn" onclick="feeAck()">Acknowledge Terms</button>
    <div class="fee-confirmed" id="fee-confirmed">&#10003; Acknowledged. We will send a full retainer agreement for your review within 24 hours.</div>
  </div>
</div>

<hr class="div">

<div class="wrap" id="faq">
  <div class="sec-label">Questions &amp; Answers</div>
  <div class="sec-title">Common Questions</div>
  <div class="card">${faqHtml}</div>
</div>

<footer>
  <div class="footer-firm">Your Law Firm</div>
  <div class="footer-disc">Attorney advertising. The information on this page is for general informational purposes and does not constitute legal advice. Submitting information does not create an attorney-client relationship. Prior results do not guarantee a similar outcome. State Bar No.: [XXXX].</div>
</footer>

<script>
document.getElementById('intake-form').addEventListener('submit',function(e){
  e.preventDefault();
  var n=this.full_name.value.trim(),em=this.email.value.trim(),ph=this.phone.value.trim(),ds=this.description.value.trim();
  if(!n||!em||!ph||!ds){alert('Please fill in all required fields.');return;}
  document.getElementById('form-wrap').querySelector('form').style.display='none';
  document.getElementById('form-success').style.display='block';
});
var fd=document.getElementById('fee-date');
if(fd){fd.textContent=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});}
function feeAck(){
  var nm=document.getElementById('fee-name').value.trim(),cb=document.getElementById('fee-check').checked;
  if(!nm){alert('Please type your full name.');return;}
  if(!cb){alert('Please check the acknowledgement box.');return;}
  document.querySelector('.fee-ack-btn').style.display='none';
  document.getElementById('fee-confirmed').style.display='block';
}
</script>
</body>
</html>`;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { lead } = req.body;
  if (!lead) return res.status(400).json({ error: "lead required" });

  const a = lead.analysis || {};

  const caseContext = [
    `Defendant: ${a.defendantProfile?.name || "Unknown"}`,
    `Case Type: ${a.caseType || "Unknown"}`,
    `Case Headline: ${a.headline || lead.title || ""}`,
    `Summary: ${a.executiveSummary || ""}`,
    a.plaintiffProfile?.requiredInjury ? `Qualifying condition: ${a.plaintiffProfile.requiredInjury}` : null,
    a.plaintiffProfile?.demographics ? `Target audience: ${a.plaintiffProfile.demographics}` : null,
    a.plaintiffProfile?.injuryTimeframe ? `Relevant timeframe: ${a.plaintiffProfile.injuryTimeframe}` : null,
    a.plaintiffProfile?.disqualifiers ? `Disqualifiers: ${a.plaintiffProfile.disqualifiers}` : null,
    (a.plaintiffProfile?.documentationNeeded || []).length
      ? `Records needed: ${a.plaintiffProfile.documentationNeeded.join(", ")}` : null,
    a.damagesModel?.perClaimantRange ? `Potential recovery per person: ${a.damagesModel.perClaimantRange}` : null,
    a.timeline?.statuteOfLimitationsNote ? `Filing deadline: ${a.timeline.statuteOfLimitationsNote}` : null,
    a.timeline?.urgencyReason ? `Urgency reason: ${a.timeline.urgencyReason}` : null,
    (a.causesOfAction || []).length
      ? `Legal theories: ${a.causesOfAction.map(c => c.name).join(", ")}` : null,
    a.plaintiffProfile?.acquisitionHook ? `Key message: ${a.plaintiffProfile.acquisitionHook}` : null,
    a.regulatoryStatus?.fdaAction ? `FDA action: ${a.regulatoryStatus.fdaAction}` : null,
    a.regulatoryStatus?.nhtsaAction ? `NHTSA action: ${a.regulatoryStatus.nhtsaAction}` : null,
    a.regulatoryStatus?.cpscAction ? `CPSC action: ${a.regulatoryStatus.cpscAction}` : null,
  ].filter(Boolean).join("\n");

  try {
    // Step 1: Claude generates JSON content only (no HTML — avoids content filters)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: CONTENT_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Write the page content for this legal case:\n\n${caseContext}`,
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Anthropic error ${response.status}`);

    const rawText = (data.content || []).map(b => b.text || "").join("").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in content response");

    const content = JSON.parse(jsonMatch[0]);

    // Step 2: Build HTML from hardcoded template — no content filter risk
    const html = buildHtml(content);

    const defendant = a.defendantProfile?.name || "Unknown";
    const caseName = a.headline || lead.title || "Case";
    const id = generateId(lead.id || caseName);

    await kv.set(`intake:${id}`, html, { ex: INTAKE_TTL });
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
