// Per-client TCPA / FDCPA / FCRA eligibility report.
//
// Pure functions only — no KV, no HTTP. The caller (api/client-report.js)
// supplies the client record and the match results from /api/match-cases.
// We shape them into a structured report object that the same module can
// render as HTML, CSV, or JSON.

import { estimateRecovery, formatUSD } from "./recoveryEstimate.js";
import { claimGuidance } from "./claimGuidance.js";

const DISCLAIMER = "This report is auto-generated from public docket data and the platform's TCPA case database. It is informational and does NOT constitute legal advice. Eligibility is preliminary and subject to attorney review and the rules of each settlement administrator. Statute-of-limitations dates are based on available data and may be inaccurate; consult counsel before relying on any deadline. Recovery estimates are based on statutory minimums (47 USC § 227(b)(3) and equivalents) and known settlement amounts; actual recovery depends on case-by-case proof and class-administration outcomes.";

// ── Top-level builder ────────────────────────────────────────────────────────
// matchResult is the body returned from /api/match-cases (mode=client-to-cases):
//   { matches: [{ id, score, qualifies, kind: "tcpa"|"lead", case?, lead?, ...}], total, ... }
export function buildClientReport({ client, matchResult }) {
  const allMatches = Array.isArray(matchResult?.matches) ? matchResult.matches : [];
  const tcpa = allMatches.filter((m) => m.kind === "tcpa" && m.case);
  const leads = allMatches.filter((m) => m.kind === "lead" && m.lead);

  // Partition TCPA matches into qualifying vs disqualified for transparency
  const qualifying = tcpa.filter((m) => m.qualifies && m.score >= 50);
  const watchlist = tcpa.filter((m) => !m.qualifies && m.score >= 50);
  const disqualified = tcpa.filter((m) => (m.disqualifyingFactors || []).length > 0);

  // Attach recovery estimate + claim guidance to each match.
  //   recovery: $ floor/ceiling (src/lib/recoveryEstimate.js)
  //   guidance: what to prove, what to collect, where to file (src/lib/claimGuidance.js)
  const attachEnrichment = (m) => {
    const est = estimateRecovery(client, m.case, { isQualifying: m.qualifies && m.score >= 50 });
    const guidance = claimGuidance(m.case, client);
    return { match: m, estimate: est, guidance };
  };
  const qualifyingWithEst   = qualifying.map(attachEnrichment);
  const watchlistWithEst    = watchlist.map(attachEnrichment);
  const disqualifiedWithEst = disqualified.map(attachEnrichment);

  // Roll up total potential recovery across QUALIFYING matches only.
  // (Watchlist + disqualified are excluded — they're speculative.)
  const totalFloor   = qualifyingWithEst.reduce((acc, x) => acc + (x.estimate.floor || 0), 0);
  const totalCeiling = qualifyingWithEst.reduce((acc, x) => acc + (x.estimate.ceiling || 0), 0);
  const totalMidpoint = (totalFloor + totalCeiling) / 2;

  return {
    version: 2, // bumped: now includes recovery estimates
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    client: clientSummary(client),
    summary: {
      tcpaCasesEvaluated: tcpa.length,
      qualifyingCases: qualifying.length,
      watchlistCases: watchlist.length,
      disqualifiedCases: disqualified.length,
      massTortLeads: leads.length,
      strongMatches: qualifying.filter((m) => m.score >= 75).length,
      claimWindowsClosingSoon: qualifying.filter((m) => {
        const closes = m.case?.settlement?.claimWindowCloses;
        const d = daysUntil(closes);
        return d !== null && d >= 0 && d <= 30;
      }).length,
      recovery: {
        floor:    totalFloor,
        ceiling:  totalCeiling,
        midpoint: totalMidpoint,
        formatted: {
          floor:    formatUSD(totalFloor),
          ceiling:  formatUSD(totalCeiling),
          midpoint: formatUSD(totalMidpoint),
        },
      },
    },
    qualifyingCases:    qualifyingWithEst.map(({ match, estimate, guidance }) => ({ ...formatTcpaMatch(match), estimate, guidance })),
    watchlistCases:     watchlistWithEst.map(({ match, estimate, guidance }) => ({ ...formatTcpaMatch(match), estimate, guidance })),
    disqualifiedCases:  disqualifiedWithEst.map(({ match, estimate, guidance }) => ({ ...formatTcpaMatch(match), estimate, guidance })),
    massTortLeads:      leads.slice(0, 25).map(formatLeadMatch),
  };
}

function clientSummary(c) {
  return {
    id: c.id,
    name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown",
    email: c.email || null,
    phone: c.phone || null,
    state: c.state || null,
    city: c.city || null,
    age: c.age ?? null,
    sourceFirm: c.sourceFirm || null,
    ingestSource: c.ingestSource || null,
    creditorHistory: (c.collectionsHistory || []).map((e) => ({
      creditor: e.creditor || null,
      debtBuyer: e.debtBuyer || null,
      status: e.status || null,
      dateRange: e.dateRange || null,
      contactMethods: e.contactMethods || [],
    })),
    tcpaOptOut: c.tcpaOptOut === true,
  };
}

function formatTcpaMatch(m) {
  const c = m.case || {};
  const closes = c.settlement?.claimWindowCloses;
  return {
    caseId: c.id,
    caption: c.caption,
    caseType: c.caseType,
    defendants: (c.defendants || []).map((d) => d.displayName),
    court: c.court?.name,
    state: c.court?.state,
    jurisdiction: c.court?.jurisdiction,
    docket: c.court?.docket,
    citation: c.court?.citation,
    filingDate: c.filingDate,
    status: c.status,
    claimWindowOpens: c.settlement?.claimWindowOpens,
    claimWindowCloses: closes,
    daysToClaim: daysUntil(closes),
    settlementFund: c.settlement?.totalFund,
    perClaimantRange: c.settlement?.perClaimantRange,
    sourceUrl: c.sourceUrl,
    score: m.score,
    qualifies: m.qualifies,
    matchType: m.matchType,
    confidence: m.confidence,
    confidenceSource: m.confidenceSource,
    matchingFactors: m.matchingFactors || [],
    disqualifyingFactors: m.disqualifyingFactors || [],
    reason: m.reason,
  };
}

function formatLeadMatch(m) {
  const l = m.lead || {};
  const a = l.analysis || {};
  return {
    leadId: l.id,
    headline: a.headline || l.title,
    caseType: a.caseType,
    score: m.score,
    qualifies: m.qualifies,
    reason: m.reason,
    requiredInjury: a.plaintiffProfile?.requiredInjury,
    product: a.plaintiffProfile?.productOrMedication,
    url: l.url,
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

// ── Renderers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtClaimWindow(report) {
  if (!report) return "—";
  if (report.daysToClaim === null) return "—";
  if (report.daysToClaim < 0) return "Window closed";
  if (report.daysToClaim <= 7) return `URGENT — ${report.daysToClaim} days left`;
  if (report.daysToClaim <= 30) return `${report.daysToClaim} days left`;
  return `${report.daysToClaim} days`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(report) {
  const css = `
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;background:#fff;max-width:880px;margin:0 auto;padding:32px;font-size:13px;line-height:1.5}
    h1{font-size:24px;margin:0 0 4px;color:#0b0c14;letter-spacing:-0.01em}
    h2{font-size:16px;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #C8442F;color:#0b0c14}
    h3{font-size:13px;margin:18px 0 6px;color:#0b0c14;font-weight:700}
    .subtitle{color:#666;font-size:12px;margin-bottom:24px}
    .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
    .meta-cell{padding:10px 12px;background:#f7f7fa;border-radius:6px;border:1px solid #e5e5ee}
    .meta-label{font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.06em;font-weight:700;margin-bottom:2px}
    .meta-value{font-size:13px;color:#1a1a2e;font-weight:600}
    .stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0 24px}
    .stat{padding:14px 12px;background:#fff;border:1px solid #d8d8e0;border-radius:8px;text-align:center}
    .stat-num{font-size:24px;font-weight:800;line-height:1;color:#C8442F}
    .stat-label{font-size:10px;color:#666;margin-top:4px;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:11px}
    th{text-align:left;padding:8px 10px;background:#f0f0f5;font-size:10px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #d0d0d8}
    td{padding:10px;border-bottom:1px solid #ececf2;vertical-align:top}
    tr:last-child td{border-bottom:none}
    .score-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;min-width:34px;text-align:center}
    .score-high{background:#dcfce7;color:#166534}
    .score-mid{background:#fef3c7;color:#92400e}
    .score-low{background:#fed7aa;color:#9a3412}
    .urgent{color:#b91c1c;font-weight:700}
    .case-title{font-weight:600;color:#0b0c14;font-size:12px;margin-bottom:2px}
    .case-meta{color:#666;font-size:10px}
    .defendants{color:#444;font-size:11px;margin-top:3px}
    .factors{font-size:10px;color:#444;margin-top:4px;line-height:1.4}
    .pos{color:#15803d}
    .neg{color:#b91c1c}
    .creditor-history{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .creditor-chip{padding:4px 10px;background:#f0f0f5;border-radius:14px;font-size:11px;color:#444;border:1px solid #d8d8e0}
    .disclaimer{margin-top:32px;padding:14px 16px;background:#fff8e6;border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#78350f;line-height:1.5}
    .empty{font-style:italic;color:#888;padding:16px;text-align:center;border:1px dashed #d0d0d8;border-radius:6px}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #d8d8e0;font-size:10px;color:#888;text-align:center}
    a{color:#C8442F;text-decoration:none}
    a:hover{text-decoration:underline}
    @media print{body{padding:18px;font-size:11px;max-width:none}.no-print{display:none}h2{page-break-after:avoid}table,tr,td{page-break-inside:avoid}}
  `;

  const c = report.client;
  const s = report.summary;
  const generatedDate = new Date(report.generatedAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric", hour:"numeric", minute:"2-digit" });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TCPA Eligibility Report — ${escapeHtml(c.name)}</title>
<style>${css}</style>
</head>
<body>

<h1>TCPA / FDCPA / FCRA Eligibility Report</h1>
<div class="subtitle">Generated ${escapeHtml(generatedDate)} for ${escapeHtml(c.name)}</div>

<h2>Plaintiff</h2>
<div class="meta-grid">
  <div class="meta-cell"><div class="meta-label">Name</div><div class="meta-value">${escapeHtml(c.name)}</div></div>
  <div class="meta-cell"><div class="meta-label">State</div><div class="meta-value">${escapeHtml(c.state || "—")}${c.city ? ", " + escapeHtml(c.city) : ""}</div></div>
  <div class="meta-cell"><div class="meta-label">Source</div><div class="meta-value">${escapeHtml(c.ingestSource || c.sourceFirm || "—")}</div></div>
  ${c.email ? `<div class="meta-cell"><div class="meta-label">Email</div><div class="meta-value">${escapeHtml(c.email)}</div></div>` : ""}
  ${c.phone ? `<div class="meta-cell"><div class="meta-label">Phone</div><div class="meta-value">${escapeHtml(c.phone)}</div></div>` : ""}
  ${c.age ? `<div class="meta-cell"><div class="meta-label">Age</div><div class="meta-value">${escapeHtml(String(c.age))}</div></div>` : ""}
</div>
${c.creditorHistory.length ? `
<h3>Creditor history (basis for matching)</h3>
<div class="creditor-history">
  ${c.creditorHistory.map((e) => `<span class="creditor-chip">${escapeHtml(e.creditor || e.debtBuyer || "—")}${e.status ? ` <span style="color:#888">· ${escapeHtml(e.status)}</span>` : ""}</span>`).join("")}
</div>` : ""}

<h2>Summary</h2>
<div class="stat-row">
  <div class="stat" style="background:#dcfce7;border-color:#bbf7d0"><div class="stat-num" style="color:#15803d;font-size:20px">${escapeHtml(s.recovery?.formatted?.floor || "$0")} – ${escapeHtml(s.recovery?.formatted?.ceiling || "$0")}</div><div class="stat-label">Estimated recovery</div></div>
  <div class="stat"><div class="stat-num" style="color:#16a34a">${s.qualifyingCases}</div><div class="stat-label">Qualifying cases</div></div>
  <div class="stat"><div class="stat-num" style="color:#ea580c">${s.claimWindowsClosingSoon}</div><div class="stat-label">Claim windows closing &lt; 30d</div></div>
  <div class="stat"><div class="stat-num" style="color:#666">${s.tcpaCasesEvaluated}</div><div class="stat-label">Cases evaluated</div></div>
</div>

<h2>Qualifying cases (${report.qualifyingCases.length})</h2>
${renderCaseTable(report.qualifyingCases) || `<div class="empty">No qualifying TCPA cases for this plaintiff at this time.</div>`}

${report.qualifyingCases.length ? `
<h2>Filing playbook — what to do, per match</h2>
<p style="font-size:11px;color:#666;margin:0 0 14px">For each qualifying match, this is the pathway, deadline, what the plaintiff must prove, and what documents to collect from them at intake.</p>
${report.qualifyingCases.map(renderGuidance).join("")}
` : ""}

${report.watchlistCases.length ? `
<h2>Watchlist (${report.watchlistCases.length})</h2>
<p style="font-size:11px;color:#666;margin:0 0 10px">Strong score but disqualified or incomplete data — worth re-evaluating with attorney review.</p>
${renderCaseTable(report.watchlistCases)}
` : ""}

${report.massTortLeads.length ? `
<h2>Mass-tort leads (${report.massTortLeads.length})</h2>
<p style="font-size:11px;color:#666;margin:0 0 10px">Non-TCPA matters where this plaintiff may also qualify.</p>
<table>
  <thead><tr><th>Score</th><th>Lead</th><th>Case type</th><th>Why</th></tr></thead>
  <tbody>
    ${report.massTortLeads.map((m) => `
      <tr>
        <td><span class="score-pill ${scoreClass(m.score)}">${m.score}</span></td>
        <td><div class="case-title">${escapeHtml(m.headline || "—")}</div></td>
        <td>${escapeHtml(m.caseType || "—")}</td>
        <td style="font-size:10px;color:#444">${escapeHtml(m.reason || "")}</td>
      </tr>
    `).join("")}
  </tbody>
</table>
` : ""}

<div class="disclaimer">
  <strong>Important:</strong> ${escapeHtml(report.disclaimer)}
</div>

<div class="footer">
  TCPA Eligibility Report v${report.version} · Generated ${escapeHtml(generatedDate)} · Plaintiff ID: ${escapeHtml(c.id)}
</div>

</body>
</html>`;
}

function renderCaseTable(matches) {
  if (!matches.length) return "";
  return `<table>
  <thead><tr>
    <th>Score</th>
    <th>Case</th>
    <th>Estimated $</th>
    <th>Court</th>
    <th>Status</th>
    <th>Claim deadline</th>
  </tr></thead>
  <tbody>
    ${matches.map((m) => `
      <tr>
        <td><span class="score-pill ${scoreClass(m.score)}">${m.score}</span></td>
        <td>
          <div class="case-title">${escapeHtml(m.caption || "—")}</div>
          ${m.defendants.length ? `<div class="defendants">vs. ${escapeHtml(m.defendants.join(", "))}</div>` : ""}
          ${m.matchingFactors.length ? `<div class="factors"><span class="pos">+ ${m.matchingFactors.map(escapeHtml).join("</span> <span class=\"pos\">+ ")}</span></div>` : ""}
          ${m.disqualifyingFactors.length ? `<div class="factors"><span class="neg">− ${m.disqualifyingFactors.map(escapeHtml).join("</span> <span class=\"neg\">− ")}</span></div>` : ""}
        </td>
        <td>
          ${m.estimate ? `
            <div style="font-weight:700;color:#15803d">${escapeHtml(formatUSD(m.estimate.floor))} – ${escapeHtml(formatUSD(m.estimate.ceiling))}</div>
            <div style="font-size:9px;color:#666;margin-top:2px">${escapeHtml(m.estimate.method.replace(/_/g, ' '))}${m.estimate.violations > 1 ? ` · ${m.estimate.violations} violations` : ""}</div>
          ` : "—"}
        </td>
        <td><div class="case-meta">${escapeHtml(m.court || "—")}</div></td>
        <td><div class="case-meta">${escapeHtml(m.status || "—")}</div></td>
        <td><div class="case-meta ${m.daysToClaim !== null && m.daysToClaim <= 30 && m.daysToClaim >= 0 ? "urgent" : ""}">${escapeHtml(fmtClaimWindow(m))}</div></td>
      </tr>
    `).join("")}
  </tbody>
</table>`;
}

function scoreClass(score) {
  if (score >= 75) return "score-high";
  if (score >= 50) return "score-mid";
  return "score-low";
}

function actionablePill(actionable) {
  if (actionable === "now")
    return `<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;background:#dcfce7;color:#15803d;border:1px solid #86efac">ACTIONABLE NOW</span>`;
  if (actionable === "if_certified")
    return `<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;border:1px solid #fcd34d">IF CLASS CERTIFIED</span>`;
  if (actionable === "closed")
    return `<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db">CLOSED — BENCHMARK</span>`;
  return `<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe">REVIEW REQUIRED</span>`;
}

function renderGuidance(m) {
  const g = m.guidance;
  if (!g) return "";
  return `
<div style="margin-bottom:20px;padding:16px 18px;background:#fafafa;border:1px solid #e5e5ee;border-radius:8px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:13px;color:#0b0c14;margin-bottom:2px">${escapeHtml(m.caption || "—")}</div>
      <div style="font-size:10px;color:#666">${escapeHtml(g.caseType)} · ${escapeHtml(g.statute || "")}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      ${actionablePill(g.actionable)}
      ${g.deadline ? `<div style="font-size:10px;color:#b91c1c;font-weight:700;margin-top:4px">Deadline: ${escapeHtml(fmtDate(g.deadline))}</div>` : ""}
    </div>
  </div>

  <div style="padding:10px 12px;background:#fff;border-radius:6px;border:1px solid #e5e5ee;margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:#0b0c14;margin-bottom:4px">${escapeHtml(g.headline || "")}</div>
    <div style="font-size:11px;color:#444;line-height:1.5">${escapeHtml(g.filingMechanism || "")}</div>
    ${g.portalUrl ? `<div style="font-size:10px;margin-top:6px"><a href="${escapeHtml(g.portalUrl)}" target="_blank">Claim portal ↗</a></div>` : ""}
    ${g.seedCitation ? `<div style="font-size:9px;color:#888;margin-top:4px">Settlement reference: ${escapeHtml(g.seedCitation)}</div>` : ""}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:700;margin-bottom:6px">What must be proved</div>
      <ul style="margin:0;padding-left:18px;font-size:10px;color:#333;line-height:1.5">
        ${(g.elementsToPlead || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
      </ul>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:700;margin-bottom:6px">Documents to collect from plaintiff</div>
      <ul style="margin:0;padding-left:18px;font-size:10px;color:#333;line-height:1.5">
        ${(g.documentsToCollect || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("")}
      </ul>
    </div>
  </div>

  ${g.factualQuestionsForIntake?.length ? `
    <div style="margin-top:12px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:700;margin-bottom:6px">Intake questions to confirm eligibility</div>
      <ul style="margin:0;padding-left:18px;font-size:10px;color:#333;line-height:1.5">
        ${g.factualQuestionsForIntake.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}
      </ul>
    </div>
  ` : ""}

  ${g.redFlags?.length ? `
    <div style="margin-top:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;font-weight:700;margin-bottom:4px">Red flags — disqualifies the match if any apply</div>
      <ul style="margin:0;padding-left:18px;font-size:10px;color:#7f1d1d;line-height:1.5">
        ${g.redFlags.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
    </div>
  ` : ""}

  <div style="margin-top:10px;font-size:10px;color:#666;display:flex;justify-content:space-between;gap:10px">
    <div>Recovery: <strong style="color:#15803d">${escapeHtml(formatUSD(m.estimate?.floor || 0))} – ${escapeHtml(formatUSD(m.estimate?.ceiling || 0))}</strong> (${escapeHtml(g.knownPerClaimant || g.perViolationStatutory || "—")})</div>
    ${g.classPeriod?.start || g.classPeriod?.end ? `<div>Class period: ${escapeHtml(fmtDate(g.classPeriod.start))} → ${escapeHtml(fmtDate(g.classPeriod.end))}</div>` : ""}
  </div>
</div>`;
}

// ── CSV export ───────────────────────────────────────────────────────────────
export function renderCsv(report) {
  const c = report.client;
  const rows = [];
  // Header
  rows.push([
    "Plaintiff Name", "Plaintiff ID", "State", "Source",
    "Rank", "Case Caption", "Defendants", "Court", "Jurisdiction",
    "Filed Date", "Status", "Claim Window Closes", "Days To Claim",
    "Settlement Fund", "Per Claimant",
    "Recovery Floor $", "Recovery Ceiling $", "Recovery Midpoint $",
    "Recovery Method", "Violations Pled",
    "Score", "Qualifies",
    "Match Type", "Confidence", "Matching Factors", "Disqualifying Factors",
    "Citation", "Docket", "Source URL", "Bucket",
  ]);
  const buckets = [
    ["qualifying",   report.qualifyingCases],
    ["watchlist",    report.watchlistCases],
    ["disqualified", report.disqualifiedCases],
  ];
  let rank = 0;
  for (const [bucket, list] of buckets) {
    for (const m of list) {
      rank++;
      const est = m.estimate || {};
      rows.push([
        c.name, c.id, c.state, c.ingestSource || c.sourceFirm || "",
        rank, m.caption, m.defendants.join("; "), m.court, m.jurisdiction,
        m.filingDate, m.status, m.claimWindowCloses, m.daysToClaim ?? "",
        m.settlementFund || "", m.perClaimantRange || "",
        est.floor ?? "", est.ceiling ?? "", est.midpoint ?? "",
        est.method || "", est.violations ?? "",
        m.score, m.qualifies ? "yes" : "no",
        m.matchType || "", m.confidence ?? "",
        (m.matchingFactors || []).join("; "),
        (m.disqualifyingFactors || []).join("; "),
        m.citation || "", m.docket || "", m.sourceUrl || "", bucket,
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
