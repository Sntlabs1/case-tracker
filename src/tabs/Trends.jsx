import { useState } from "react";
import { Card } from "../components/UI.jsx";
import INSIGHTS from "../data/creditInsights.json";

// Deep-dive analytics on the credit.com / Lexington Law corpus — the same
// trends and findings as the Credit.com Interactive Report, rendered live in
// the app. Data is a precomputed aggregate snapshot (src/data/creditInsights.json)
// extracted from the DuckDB pass over the 9.87GB raw corpus, so this tab is
// self-contained and never depends on a live scan.

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────

const fmtN = (n) => (n || n === 0 ? Number(n).toLocaleString() : "—");
function fmtCompact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
const pct = (x) => (x == null ? "—" : `${x}%`);

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = "var(--accent)" }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.05 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "#e0e0f0", marginTop: 5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

function SectionTitle({ n, title, note }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", display: "flex", alignItems: "baseline", gap: 8 }}>
        {n != null && <span style={{ color: "var(--accent)", fontSize: 12 }}>{n}</span>}
        <span>{title}</span>
      </div>
      {note && <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>{note}</div>}
    </div>
  );
}

// Horizontal labelled bars. rows: [{label, value, sub, color}], scaled to max.
function HBars({ rows, fmt = fmtN, max }) {
  const top = max ?? Math.max(...rows.map((r) => r.value || 0), 1);
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11 }}>
            <span style={{ color: "#c8c8e0" }}>{r.label}</span>
            <span style={{ color: "#888" }}>{r.sub ?? fmt(r.value)}</span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max((r.value / top) * 100, r.value > 0 ? 1.5 : 0)}%`, background: r.color || "var(--accent)", borderRadius: 4, transition: "width .4s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Histogram from [[x, count], ...] pairs.
function Histogram({ hist, height = 130, color = "var(--accent)", marker }) {
  const max = Math.max(...hist.map((h) => h[1]), 1);
  const n = hist.length;
  const w = 620;
  const bw = Math.max(2, Math.floor(w / n) - 1);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={Math.max(n * (bw + 1), 300)} height={height + 26} style={{ display: "block" }}>
        {hist.map(([x, c], i) => {
          const h = Math.max((c / max) * height, c > 0 ? 1 : 0);
          const px = i * (bw + 1);
          return (
            <g key={i}>
              <rect x={px} y={height - h} width={bw} height={h} fill={color} opacity={0.85} rx={1} />
              {i % Math.ceil(n / 12) === 0 && (
                <text x={px + bw / 2} y={height + 16} textAnchor="middle" fill="#555" fontSize={9}>{x}</text>
              )}
            </g>
          );
        })}
        {marker != null && (() => {
          const idx = hist.findIndex((h) => h[0] >= marker);
          const mx = (idx < 0 ? n - 1 : idx) * (bw + 1);
          return <line x1={mx} y1={0} x2={mx} y2={height} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" />;
        })()}
        <line x1={0} y1={height} x2={n * (bw + 1)} y2={height} stroke="#333" strokeWidth={1} />
      </svg>
    </div>
  );
}

// Step funnel: rows of [label, n, note] narrowing down.
function Funnel({ rows, fmt = fmtN }) {
  const top = rows[0]?.[1] || 1;
  return (
    <div>
      {rows.map(([label, val, note], i) => {
        const w = Math.max((val / top) * 100, 8);
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: "#c8c8e0" }}>{label}</span>
              <span style={{ color: "#888" }}>{fmt(val)}{i > 0 && top ? ` · ${Math.round((val / top) * 100)}%` : ""}</span>
            </div>
            <div style={{ height: 22, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden", position: "relative" }}>
              <div style={{ height: "100%", width: `${w}%`, background: `linear-gradient(90deg, var(--accent), rgba(45,125,149,0.5))`, borderRadius: 4 }} />
            </div>
            {note && <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{note}</div>}
          </div>
        );
      })}
    </div>
  );
}

// Index bars centered at 1.0 (over/under-represented vs US baseline).
function IndexBars({ rows }) {
  return (
    <div>
      {rows.map((r, i) => {
        const over = r.index >= 1;
        const w = Math.min(Math.abs(r.index - 1) * 100, 100);
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 50px", gap: 8, alignItems: "center", marginBottom: 7 }}>
            <span style={{ fontSize: 11, color: "#c8c8e0" }}>{r.label}<span style={{ color: "#555", marginLeft: 5 }}>{r.ages}</span></span>
            <div style={{ display: "flex", alignItems: "center", height: 14 }}>
              <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                {!over && <div style={{ height: 10, width: `${w}%`, background: "#B83E2C", borderRadius: "3px 0 0 3px" }} />}
              </div>
              <div style={{ width: 1, height: 14, background: "#555" }} />
              <div style={{ flex: 1 }}>
                {over && <div style={{ height: 10, width: `${w}%`, background: "#22c55e", borderRadius: "0 3px 3px 0" }} />}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: over ? "#22c55e" : "#B83E2C", textAlign: "right" }}>{r.index.toFixed(2)}×</span>
          </div>
        );
      })}
    </div>
  );
}

const BAND_COLORS = ["#B83E2C", "#f97316", "#f59e0b", "#2D7D95", "#22c55e"];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function Trends() {
  const [pop, setPop] = useState("lex");      // lex | ccom
  const [scoreMode, setScoreMode] = useState("calib"); // calib | raw
  const d = INSIGHTS;

  const cov = d.coverage[pop] || {};
  const sc = (d.score[pop] || {})[scoreMode] || {};
  const dist = d.distress[pop] || {};
  const types = pop === "lex" ? d.creditor.lex_types : d.creditor.ccom_types;

  // Geography: states ranked by representation index for the active population.
  const idxKey = pop === "lex" ? "lex_index" : "ccom_index";
  const userKey = pop === "lex" ? "lex_users" : "ccom_users";
  const topStates = [...d.states].sort((a, b) => b[idxKey] - a[idxKey]).slice(0, 12);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Data Trends &amp; Insights</h2>
        <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
          Deep-dive analytics on the credit.com / Lexington Law corpus — coverage, score distribution, geography,
          generations, creditors, distress signals, contactability, and monetization. Snapshot generated {d.meta.generated}.
        </p>
      </div>

      {/* Population toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[
          { k: "lex", label: `Lexington Law — ${fmtCompact(d.coverage.lex.total)} people` },
          { k: "ccom", label: `Credit.com — ${fmtCompact(d.coverage.ccom.total)} people` },
        ].map(({ k, label }) => (
          <button key={k} onClick={() => setPop(k)}
            style={{ fontSize: 12, padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontWeight: 600,
              background: pop === k ? "rgba(45,125,149,0.25)" : "rgba(255,255,255,0.04)",
              color: pop === k ? "var(--accent)" : "#777" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Headline stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="People in file" value={fmtCompact(cov.total)} sub={pop.toUpperCase()} />
        <StatCard label="Scored / has tradelines" value={fmtCompact(cov.scored)} color="#22c55e" sub={`${Math.round((cov.scored / cov.total) * 100)}% coverage`} />
        <StatCard label="Named-defendant union" value={fmtCompact(d.monetize.defendant_union)} color="#B83E2C" sub="distinct consumers" />
        <StatCard label="Call-ready (TCPA)" value={fmtCompact(d.monetize.call_ready)} color="#f59e0b" sub="consent + phone" />
        <StatCard label="Charge-off / collection" value={pct(dist.chargeoff_collection)} color="#ef4444" sub="of scored file" />
        <StatCard label="Unique accounts" value={fmtCompact(d.creditor.summary.unique_accounts)} color="#2D7D95" sub={`${fmtCompact(d.creditor.summary.entities)} creditor entities`} />
      </div>

      {/* ── Coverage funnel + Score distribution ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, marginBottom: 20 }}>
        <Card>
          <SectionTitle n="1" title="Population & coverage" note="Who is in the file and who carries scoreable tradelines." />
          <Funnel rows={
            pop === "lex"
              ? [
                  ["People in file", cov.total, null],
                  ["Scored (≥1 tradeline)", cov.scored, null],
                  ["Unscored — no tradeline", cov.unscored_no_tradeline, "thin / no-hit"],
                  ["Unscored — inquiry/PR only", cov.unscored_inq_pr_only, null],
                ]
              : [
                  ["People in file", cov.total, null],
                  ["Scored", cov.scored, null],
                  ["Unscored", cov.unscored, null],
                ]
          } fmt={fmtN} />
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <SectionTitle n="2" title="Credit-score distribution" note={`${scoreMode === "calib" ? "Calibrated proxy score" : "Raw proxy score"} · ${pct(sc.pct_below_580)} below 580 (subprime).`} />
            <div style={{ display: "flex", gap: 6 }}>
              {[["calib", "Calibrated"], ["raw", "Raw"]].map(([k, l]) => (
                <button key={k} onClick={() => setScoreMode(k)}
                  style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: scoreMode === k ? "rgba(45,125,149,0.2)" : "rgba(255,255,255,0.04)",
                    color: scoreMode === k ? "var(--accent)" : "#666" }}>{l}</button>
              ))}
            </div>
          </div>
          {sc.hist && <Histogram hist={sc.hist} marker={580} />}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginTop: 12 }}>
            {[["p10", "p10"], ["p25", "p25"], ["median", "Median"], ["p75", "p75"], ["p90", "p90"]].map(([k, l]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e0e0f0" }}>{sc[k]}</div>
                <div style={{ fontSize: 10, color: "#666" }}>{l}</div>
              </div>
            ))}
          </div>
          {sc.bands && (
            <div style={{ marginTop: 14, display: "flex", height: 26, borderRadius: 5, overflow: "hidden" }}>
              {sc.bands.map((b, i) => (
                <div key={i} title={`${b[0]}: ${fmtN(b[1])} (${b[2]}%)`}
                  style={{ width: `${b[2]}%`, background: BAND_COLORS[i], display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {b[2] >= 8 && <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>{b[2]}%</span>}
                </div>
              ))}
            </div>
          )}
          {sc.bands && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
              {sc.bands.map((b, i) => (
                <span key={i} style={{ fontSize: 10, color: "#888", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: BAND_COLORS[i] }} />
                  {b[0]} ({b[3]}–{b[4]})
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Geography + Generations ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <Card>
          <SectionTitle n="3" title="Geography — over-represented states"
            note={`Representation index vs population (1.0 = national average of ${pop === "lex" ? d.meta.lex_nat_per1k : d.meta.ccom_nat_per1k} per 1k).`} />
          <HBars rows={topStates.map((s) => ({
            label: s.state,
            value: s[idxKey],
            sub: `${s[idxKey].toFixed(2)}× · ${fmtCompact(s[userKey])} users`,
            color: s[idxKey] >= 1 ? "#22c55e" : "#B83E2C",
          }))} fmt={(v) => `${v.toFixed(2)}×`} max={Math.max(...topStates.map((s) => s[idxKey]))} />
        </Card>

        <Card>
          <SectionTitle n="4" title="Generations — representation index"
            note="Share of the LEX file vs US adult population. Green = over-indexed." />
          <IndexBars rows={d.gens.map((g) => ({ label: g.cohort, ages: g.ages, index: g.index }))} />
          <div style={{ fontSize: 10, color: "#555", marginTop: 8 }}>
            Millennials &amp; Gen X dominate (1.4–1.5×); Gen Z and Silent are sharply under-represented.
          </div>
        </Card>
      </div>

      {/* ── Top creditors ── */}
      <Card style={{ marginBottom: 20 }}>
        <SectionTitle n="5" title="Largest creditor entities (top 25 by consumers)"
          note={`${fmtCompact(d.creditor.summary.unique_accounts)} accounts across ${fmtCompact(d.creditor.summary.entities)} canonicalised entities · ${pct(Math.round(d.creditor.summary.derogatory / d.creditor.summary.unique_accounts * 100))} of accounts derogatory.`} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["#", "Creditor", "Type", "Consumers", "Accounts", "Derog.", "Derog. rate"].map((h, i) => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: i >= 3 ? "right" : "left", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.creditor.top_entities.map((e) => (
                <tr key={e.rank} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 8px", color: "#555" }}>{e.rank}</td>
                  <td style={{ padding: "6px 8px", color: "#e0e0f0", fontWeight: 600 }}>{e.name}</td>
                  <td style={{ padding: "6px 8px", color: "#888" }}>{e.type}</td>
                  <td style={{ padding: "6px 8px", color: "#c8c8e0", textAlign: "right" }}>{fmtCompact(e.consumers)}</td>
                  <td style={{ padding: "6px 8px", color: "#888", textAlign: "right" }}>{fmtCompact(e.accounts)}</td>
                  <td style={{ padding: "6px 8px", color: "#888", textAlign: "right" }}>{fmtCompact(e.derogatory)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: e.derog_rate >= 30 ? "#ef4444" : e.derog_rate >= 15 ? "#f59e0b" : "#22c55e" }}>{e.derog_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Account types + Bankruptcy by creditor ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <Card>
          <SectionTitle title={`Account types — ${pop.toUpperCase()}`} note="Share of accounts, with derogatory rate per type." />
          <HBars rows={types.slice(0, 9).map((t) => ({
            label: t.type,
            value: t.pct,
            sub: `${t.pct}% · ${t.derog_rate}% derog`,
            color: t.derog_rate >= 25 ? "#ef4444" : t.derog_rate >= 15 ? "#f59e0b" : "var(--accent)",
          }))} fmt={(v) => `${v}%`} max={Math.max(...types.map((t) => t.pct))} />
        </Card>

        <Card>
          <SectionTitle title="Bankruptcy rate by creditor (top 12)"
            note={`Base LEX bankruptcy rate ${d.creditor.bk_by_creditor.lex_base_bk_rate}% · ${fmtCompact(d.creditor.bk_by_creditor.lex_bk_users)} filers. Entities ≥50k consumers.`} />
          <HBars rows={d.creditor.bk_by_creditor.top25_by_rate.slice(0, 12).map((c) => ({
            label: c.name.length > 34 ? c.name.slice(0, 32) + "…" : c.name,
            value: c.bk_rate,
            sub: `${c.bk_rate}% · ${fmtCompact(c.bk_users)} filers`,
            color: "#B83E2C",
          }))} fmt={(v) => `${v}%`} />
        </Card>
      </div>

      {/* ── Distress + Contactability ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <Card>
          <SectionTitle n="6" title="Distress signals" note={`Share of the ${fmtCompact(dist.n)} scored ${pop.toUpperCase()} consumers carrying each signal.`} />
          <HBars rows={[
            { label: "Charge-off / in collection", value: dist.chargeoff_collection, color: "#ef4444" },
            { label: "120+ day late", value: dist.late120, color: "#f97316" },
            { label: "Repossession / foreclosure", value: dist.repo_foreclosure, color: "#f59e0b" },
            { label: "Bankruptcy on file", value: dist.bankruptcy, color: "#B83E2C" },
          ].filter((r) => r.value != null)} fmt={(v) => `${v}%`} max={100} />
        </Card>

        <Card>
          <SectionTitle n="7" title="Contactability" note="The reachable denominator behind every monetization estimate." />
          <Funnel rows={
            pop === "ccom"
              ? [
                  ["Base population", d.contact.ccom.base, null],
                  ["Has phone", d.contact.ccom.has_phone, null],
                  ["Marketing consent", d.contact.ccom.consent, null],
                  ["Phone authorized", d.contact.ccom.phone_auth, null],
                  ["Consent + phone-auth (callable)", d.contact.ccom.both, `${fmtN(d.contact.ccom.dnc)} DNC suppressed`],
                ]
              : [
                  ["Base population", d.contact.lex.base, null],
                  ["Has phone", d.contact.lex.has_phone, null],
                  ["Has email", d.contact.lex.has_email, null],
                  ["Has consent", d.contact.lex.has_consent, null],
                ]
          } fmt={fmtN} />
        </Card>
      </div>

      {/* ── Monetization segments ── */}
      <Card style={{ marginBottom: 20 }}>
        <SectionTitle n="8" title="Behavioural segments — monetization"
          note={`Gross ceiling ${d.monetize.gross_ceiling} (statutory, pre-overlap) · ${d.monetize.freshness_recent12_pct}% of tradelines reported in last 12 months.`} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Segment", "Definition", "Consumers", "Play", "Partners", "CPL"].map((h, i) => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: i === 2 ? "right" : "left", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.monetize.segments.map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 8px", color: "#e0e0f0", fontWeight: 600, whiteSpace: "nowrap" }}>{s[0]}</td>
                  <td style={{ padding: "6px 8px", color: "#888", maxWidth: 220 }}>{s[1]}</td>
                  <td style={{ padding: "6px 8px", color: "var(--accent)", textAlign: "right", fontWeight: 700 }}>{fmtCompact(s[2])}</td>
                  <td style={{ padding: "6px 8px", color: "#c8c8e0" }}>{s[3]}</td>
                  <td style={{ padding: "6px 8px", color: "#888" }}>{s[4]}</td>
                  <td style={{ padding: "6px 8px", color: "#22c55e", whiteSpace: "nowrap" }}>{s[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Claim funnel ── */}
      <Card style={{ marginBottom: 20 }}>
        <SectionTitle n="9" title="Defendant-to-filed-claim funnel"
          note={`From the ${fmtCompact(d.monetize.defendant_union)}-consumer named-defendant union to expected filed claims. Litigation model: ${d.monetize.litigation_model}.`} />
        <Funnel rows={d.monetize.funnel.map((f) => [f[0], f[1], f[2]])} fmt={fmtN} />
      </Card>

      <div style={{ fontSize: 11, color: "#555", marginTop: 8, lineHeight: 1.5 }}>
        Source: precomputed aggregate from the DuckDB pass over the raw credit.com / Lexington Law corpus (vintage 2017–2024).
        Score is a modeled proxy, not a bureau FICO. Recovery figures are statutory maximums over actionable claims, not expected value.
        Snapshot generated {d.meta.generated}.
      </div>
    </div>
  );
}
