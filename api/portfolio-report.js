// Portfolio-level recovery report — aggregates the per-client TCPA / FDCPA /
// FCRA eligibility analysis across every client in a partner's universe.
//
// GET /api/portfolio-report?partner=credit_com&format=html|csv|json
//   ?partner=<id>        filter to one partner (defaults to all clients)
//   ?fresh=1             skip cached snapshots, force re-aggregate
//   ?topN=50             top-N defendant / case tables (default 50)
//
// Pipeline:
//   1. List clients in scope (clients_by_partner:${pid} if set; else all).
//   2. For each, read cached per-client report from tcpa:client_report:${id}.
//      If missing or ?fresh=1, generate via generateClientReport().
//   3. Aggregate: total estimated recovery (floor/ceiling), breakdown by
//      status / method / case type, top defendants & cases by exposure,
//      cases with claim windows closing in 30 days.
//
// Snapshot cached at tcpa:portfolio_report:${pid} for 6 hours.

import { kv } from "@vercel/kv";
import { generateClientReport } from "./client-report.js";
import { formatUSD } from "../src/lib/intelligence/recoveryEstimate.js";

const SNAPSHOT_KEY = (pid) => `tcpa:portfolio_report:${pid || "all"}`;
const SNAPSHOT_TTL = 6 * 3600; // 6 hours

async function listClientIds(partnerId) {
  if (partnerId) {
    const ids = await kv.zrange(`clients_by_partner:${partnerId}`, 0, -1).catch(() => []);
    if (ids?.length) return ids;
  }
  // Fallback (or no partner filter): walk all clients
  return (await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => [])) || [];
}

async function loadClient(id) {
  const raw = await kv.get(`client:${id}`).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function loadClientReport(id) {
  const raw = await kv.get(`tcpa:client_report:${id}`).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function emptyAgg() {
  return { floor: 0, ceiling: 0, midpoint: 0, matches: 0, clients: 0 };
}

function accumulate(agg, est) {
  agg.floor    += est.floor    || 0;
  agg.ceiling  += est.ceiling  || 0;
  agg.midpoint += est.midpoint || 0;
  agg.matches  += 1;
}

async function buildPortfolio({ partnerId, fresh, topN = 50 }) {
  const startedAt = Date.now();
  const ids = await listClientIds(partnerId);
  if (!ids.length) {
    return {
      version: 1, generatedAt: new Date().toISOString(),
      partnerId: partnerId || "all", clientsTotal: 0, clientsAnalyzed: 0,
      totals: emptyAgg(),
      byStatus: {}, byCaseType: {}, byMethod: {},
      topDefendants: [], topCases: [], urgentClaims: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const totals = emptyAgg();
  const byStatus = {};
  const byCaseType = {};
  const byMethod = {};
  const defendantAgg = {};  // canonicalId-ish key → { name, ...agg, clientSet }
  const caseAgg = {};        // caseId → { caption, status, ...agg, clientSet }
  const urgentClaims = [];   // matches with claim deadline < 30 days

  let analyzed = 0;
  let withRecovery = 0;
  let errors = 0;

  // Iterate clients in batches; load cached reports in parallel within each
  // batch. Falls back to fresh compute when the snapshot is missing.
  const BATCH = 50;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const reports = await Promise.all(slice.map(async (id) => {
      let report = null;
      if (!fresh) report = await loadClientReport(id);
      if (report) return { id, report };
      try {
        const client = await loadClient(id);
        if (!client) return { id, report: null };
        report = await generateClientReport(client, { topN: 200 });
        return { id, report };
      } catch (e) {
        return { id, error: e.message };
      }
    }));

    for (const { id, report, error } of reports) {
      if (error || !report) {
        if (error) errors++;
        continue;
      }
      analyzed++;
      const clientTotalFloor   = report.summary?.recovery?.floor   || 0;
      const clientTotalCeiling = report.summary?.recovery?.ceiling || 0;
      if (clientTotalFloor > 0 || clientTotalCeiling > 0) withRecovery++;

      for (const m of (report.qualifyingCases || [])) {
        const est = m.estimate;
        if (!est) continue;
        accumulate(totals, est);

        const st = m.status || "active";
        byStatus[st] = byStatus[st] || emptyAgg();
        accumulate(byStatus[st], est);

        byCaseType[m.caseType] = byCaseType[m.caseType] || emptyAgg();
        accumulate(byCaseType[m.caseType], est);

        byMethod[est.method] = byMethod[est.method] || emptyAgg();
        accumulate(byMethod[est.method], est);

        // Per-defendant exposure
        for (const dName of (m.defendants || [])) {
          const key = dName.toLowerCase();
          defendantAgg[key] = defendantAgg[key] || { displayName: dName, ...emptyAgg(), clientSet: new Set() };
          accumulate(defendantAgg[key], est);
          defendantAgg[key].clientSet.add(id);
        }

        // Per-case exposure
        if (m.caseId) {
          caseAgg[m.caseId] = caseAgg[m.caseId] || {
            caseId: m.caseId, caption: m.caption, status: m.status,
            caseType: m.caseType, court: m.court, defendants: m.defendants,
            claimWindowCloses: m.claimWindowCloses, daysToClaim: m.daysToClaim,
            ...emptyAgg(), clientSet: new Set(),
          };
          accumulate(caseAgg[m.caseId], est);
          caseAgg[m.caseId].clientSet.add(id);
        }

        // Urgent claims (≤ 30d)
        if (m.daysToClaim !== null && m.daysToClaim !== undefined && m.daysToClaim >= 0 && m.daysToClaim <= 30) {
          urgentClaims.push({
            clientId: id,
            caseId: m.caseId, caption: m.caption, defendants: m.defendants,
            daysToClaim: m.daysToClaim, claimWindowCloses: m.claimWindowCloses,
            estimate: est,
          });
        }
      }
    }
  }

  // Finalize: convert clientSet → count and pick top N
  const topDefendants = Object.values(defendantAgg)
    .map((d) => ({
      displayName: d.displayName,
      floor: d.floor, ceiling: d.ceiling, midpoint: d.midpoint,
      matches: d.matches, clients: d.clientSet.size,
    }))
    .sort((a, b) => b.ceiling - a.ceiling)
    .slice(0, topN);
  const topCases = Object.values(caseAgg)
    .map((c) => ({
      caseId: c.caseId, caption: c.caption, caseType: c.caseType,
      status: c.status, court: c.court, defendants: c.defendants,
      claimWindowCloses: c.claimWindowCloses, daysToClaim: c.daysToClaim,
      floor: c.floor, ceiling: c.ceiling, midpoint: c.midpoint,
      matches: c.matches, clients: c.clientSet.size,
    }))
    .sort((a, b) => b.ceiling - a.ceiling)
    .slice(0, topN);
  urgentClaims.sort((a, b) => a.daysToClaim - b.daysToClaim);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    partnerId: partnerId || "all",
    clientsTotal: ids.length,
    clientsAnalyzed: analyzed,
    clientsWithRecovery: withRecovery,
    errors,
    totals: { ...totals, clients: withRecovery },
    totalsFormatted: {
      floor: formatUSD(totals.floor),
      ceiling: formatUSD(totals.ceiling),
      midpoint: formatUSD(totals.midpoint),
    },
    byStatus,
    byCaseType,
    byMethod,
    topDefendants,
    topCases,
    urgentClaims: urgentClaims.slice(0, 100),
    durationMs: Date.now() - startedAt,
  };
}

// ── Renderers ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderHtml(report) {
  const css = `
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;background:#fff;max-width:1100px;margin:0 auto;padding:32px;font-size:13px;line-height:1.5}
    h1{font-size:26px;margin:0 0 4px;color:#0b0c14;letter-spacing:-0.01em}
    h2{font-size:17px;margin:32px 0 14px;padding-bottom:6px;border-bottom:2px solid #C8442F;color:#0b0c14}
    .subtitle{color:#666;font-size:12px;margin-bottom:24px}
    .hero{background:linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%);border:1px solid #86efac;border-radius:12px;padding:28px 24px;margin-bottom:24px}
    .hero-num{font-size:42px;font-weight:800;color:#14532d;line-height:1.1;letter-spacing:-0.02em}
    .hero-range{font-size:16px;color:#15803d;margin-top:8px;font-weight:600}
    .hero-meta{font-size:11px;color:#166534;margin-top:14px}
    .stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .stat{padding:14px 12px;background:#fff;border:1px solid #d8d8e0;border-radius:8px;text-align:center}
    .stat-num{font-size:22px;font-weight:800;line-height:1;color:#C8442F}
    .stat-label{font-size:10px;color:#666;margin-top:4px;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:11px}
    th{text-align:left;padding:8px 10px;background:#f0f0f5;font-size:10px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #d0d0d8}
    td{padding:10px;border-bottom:1px solid #ececf2;vertical-align:top}
    .dollar{font-weight:700;color:#15803d;white-space:nowrap}
    .urgent{color:#b91c1c;font-weight:700}
    .pill{display:inline-block;font-size:9px;padding:2px 7px;border-radius:10px;font-weight:700;background:#e0e7ff;color:#3730a3}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #d8d8e0;font-size:10px;color:#888;text-align:center}
    .disclaimer{margin-top:24px;padding:14px 16px;background:#fff8e6;border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#78350f;line-height:1.5}
    @media print{body{padding:18px;font-size:11px}h2{page-break-after:avoid}table,tr,td{page-break-inside:avoid}}
  `;
  const date = new Date(report.generatedAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric", hour:"numeric", minute:"2-digit" });
  const f = report.totalsFormatted || { floor:"$0", ceiling:"$0", midpoint:"$0" };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Portfolio Recovery Report — ${escapeHtml(report.partnerId)}</title><style>${css}</style></head>
<body>
<h1>TCPA / FDCPA / FCRA Portfolio Recovery Report</h1>
<div class="subtitle">Partner: <strong>${escapeHtml(report.partnerId)}</strong> · Generated ${escapeHtml(date)}</div>

<div class="hero">
  <div style="font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Estimated total recoverable</div>
  <div class="hero-num">${escapeHtml(f.floor)} – ${escapeHtml(f.ceiling)}</div>
  <div class="hero-range">Midpoint: ${escapeHtml(f.midpoint)}</div>
  <div class="hero-meta">
    Across ${report.clientsWithRecovery} of ${report.clientsAnalyzed} analyzed plaintiffs in ${report.totals.matches} qualifying (plaintiff, case) matches.
  </div>
</div>

<h2>Coverage</h2>
<div class="stat-row">
  <div class="stat"><div class="stat-num">${report.clientsTotal.toLocaleString()}</div><div class="stat-label">Clients in scope</div></div>
  <div class="stat"><div class="stat-num">${report.clientsAnalyzed.toLocaleString()}</div><div class="stat-label">Analyzed</div></div>
  <div class="stat"><div class="stat-num" style="color:#16a34a">${report.clientsWithRecovery.toLocaleString()}</div><div class="stat-label">With qualifying matches</div></div>
  <div class="stat"><div class="stat-num" style="color:#ea580c">${report.urgentClaims.length}</div><div class="stat-label">Claim windows &lt; 30d</div></div>
</div>

<h2>Top defendants by exposure</h2>
${report.topDefendants.length ? `
<table>
  <thead><tr><th>Defendant</th><th>Plaintiffs</th><th>Matches</th><th style="text-align:right">Floor – Ceiling</th></tr></thead>
  <tbody>
    ${report.topDefendants.slice(0, 20).map((d) => `
      <tr>
        <td><strong>${escapeHtml(d.displayName)}</strong></td>
        <td>${d.clients}</td>
        <td>${d.matches}</td>
        <td style="text-align:right"><span class="dollar">${escapeHtml(formatUSD(d.floor))} – ${escapeHtml(formatUSD(d.ceiling))}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>
` : `<div style="font-style:italic;color:#888;padding:16px;text-align:center;border:1px dashed #d0d0d8;border-radius:6px">No defendants matched yet</div>`}

<h2>Top cases by exposure</h2>
${report.topCases.length ? `
<table>
  <thead><tr><th>Case</th><th>Plaintiffs</th><th>Status</th><th>Deadline</th><th style="text-align:right">Floor – Ceiling</th></tr></thead>
  <tbody>
    ${report.topCases.slice(0, 20).map((c) => `
      <tr>
        <td>
          <div style="font-weight:600">${escapeHtml(c.caption)}</div>
          ${c.defendants?.length ? `<div style="font-size:10px;color:#666">vs. ${escapeHtml(c.defendants.join(", "))}</div>` : ""}
          <span class="pill">${escapeHtml(c.caseType || "?")}</span>
        </td>
        <td>${c.clients}</td>
        <td>${escapeHtml(c.status || "?")}</td>
        <td class="${c.daysToClaim !== null && c.daysToClaim <= 30 ? "urgent" : ""}">${escapeHtml(fmtDate(c.claimWindowCloses))}</td>
        <td style="text-align:right"><span class="dollar">${escapeHtml(formatUSD(c.floor))} – ${escapeHtml(formatUSD(c.ceiling))}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>
` : `<div style="font-style:italic;color:#888;padding:16px;text-align:center;border:1px dashed #d0d0d8;border-radius:6px">No cases matched yet</div>`}

${report.urgentClaims.length ? `
<h2>Urgent — claim windows closing within 30 days</h2>
<table>
  <thead><tr><th>Days left</th><th>Case</th><th>Closes</th><th style="text-align:right">Per claimant</th></tr></thead>
  <tbody>
    ${report.urgentClaims.slice(0, 30).map((u) => `
      <tr>
        <td class="urgent">${u.daysToClaim}d</td>
        <td>
          <div style="font-weight:600">${escapeHtml(u.caption || "—")}</div>
          ${u.defendants?.length ? `<div style="font-size:10px;color:#666">vs. ${escapeHtml(u.defendants.join(", "))}</div>` : ""}
        </td>
        <td>${escapeHtml(fmtDate(u.claimWindowCloses))}</td>
        <td style="text-align:right"><span class="dollar">${escapeHtml(formatUSD(u.estimate?.floor || 0))} – ${escapeHtml(formatUSD(u.estimate?.ceiling || 0))}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>
` : ""}

<h2>Breakdown by case status</h2>
<table>
  <thead><tr><th>Status</th><th>Matches</th><th style="text-align:right">Floor – Ceiling</th></tr></thead>
  <tbody>
    ${Object.entries(report.byStatus).sort((a,b) => b[1].ceiling - a[1].ceiling).map(([k, v]) => `
      <tr>
        <td><strong>${escapeHtml(k)}</strong></td>
        <td>${v.matches}</td>
        <td style="text-align:right"><span class="dollar">${escapeHtml(formatUSD(v.floor))} – ${escapeHtml(formatUSD(v.ceiling))}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>

<h2>Breakdown by case type</h2>
<table>
  <thead><tr><th>Type</th><th>Matches</th><th style="text-align:right">Floor – Ceiling</th></tr></thead>
  <tbody>
    ${Object.entries(report.byCaseType).sort((a,b) => b[1].ceiling - a[1].ceiling).map(([k, v]) => `
      <tr>
        <td><strong>${escapeHtml(k)}</strong></td>
        <td>${v.matches}</td>
        <td style="text-align:right"><span class="dollar">${escapeHtml(formatUSD(v.floor))} – ${escapeHtml(formatUSD(v.ceiling))}</span></td>
      </tr>
    `).join("")}
  </tbody>
</table>

<div class="disclaimer">
  <strong>Methodology.</strong> Recovery estimates apply TCPA / FDCPA / FCRA statutory minimums (47 USC § 227(b)(3) and equivalents) plus per-claimant settlement amounts where known. Floor uses lowest defensible per-violation amount; ceiling uses willful-violation maximums. Numbers assume at least one violation pled per defendant in each plaintiff's collections history. Actual recovery depends on case-by-case proof, class membership verification, and settlement-administration outcomes. Not legal advice.
</div>

<div class="footer">
  Portfolio Recovery Report v${report.version} · ${report.clientsAnalyzed.toLocaleString()} plaintiffs analyzed in ${(report.durationMs / 1000).toFixed(1)}s
</div>
</body></html>`;
}

function renderCsv(report) {
  const rows = [];
  rows.push(["Section","Key","Plaintiffs","Matches","Floor $","Ceiling $","Midpoint $"]);
  rows.push(["Total","Portfolio", report.clientsWithRecovery, report.totals.matches, report.totals.floor, report.totals.ceiling, report.totals.midpoint]);
  for (const [k, v] of Object.entries(report.byStatus))  rows.push(["By status",   k, "",            v.matches, v.floor, v.ceiling, v.midpoint]);
  for (const [k, v] of Object.entries(report.byCaseType)) rows.push(["By case type", k, "",            v.matches, v.floor, v.ceiling, v.midpoint]);
  for (const d of report.topDefendants)                   rows.push(["Top defendant", d.displayName, d.clients, d.matches, d.floor, d.ceiling, d.midpoint]);
  for (const c of report.topCases)                        rows.push(["Top case",      c.caption,     c.clients, c.matches, c.floor, c.ceiling, c.midpoint]);
  for (const u of report.urgentClaims)                    rows.push(["Urgent",        `${u.caption} (closes ${u.claimWindowCloses})`, 1, 1, u.estimate?.floor || 0, u.estimate?.ceiling || 0, u.estimate?.midpoint || 0]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { partner, format = "html", fresh, topN, meta } = req.query || {};
  const partnerId = partner ? String(partner).toLowerCase() : null;

  if (meta) {
    const raw = await kv.get(SNAPSHOT_KEY(partnerId)).catch(() => null);
    if (!raw) return res.status(200).json({ exists: false });
    const cached = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.status(200).json({
      exists: true,
      generatedAt: cached.generatedAt,
      clientsAnalyzed: cached.clientsAnalyzed,
      clientsWithRecovery: cached.clientsWithRecovery,
      totals: cached.totals,
      totalsFormatted: cached.totalsFormatted,
    });
  }

  try {
    let report = null;
    if (!fresh) {
      const raw = await kv.get(SNAPSHOT_KEY(partnerId)).catch(() => null);
      if (raw) report = typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    if (!report) {
      report = await buildPortfolio({ partnerId, fresh: !!fresh, topN: parseInt(topN) || 50 });
      await kv.set(SNAPSHOT_KEY(partnerId), JSON.stringify(report), { ex: SNAPSHOT_TTL }).catch(() => {});
    }

    if (format === "json") return res.status(200).json({ report });
    if (format === "csv") {
      const fname = `portfolio-${partnerId || "all"}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      return res.status(200).send(renderCsv(report));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(renderHtml(report));
  } catch (e) {
    return res.status(500).json({ error: e.message || "portfolio-report failed" });
  }
}
