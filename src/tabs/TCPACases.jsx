import { useState, useEffect, useMemo } from "react";
import { Card, Btn } from "../components/UI.jsx";

const STATUS_COLORS = {
  active:       "#3b82f6",
  settled:      "#f59e0b",
  claim_open:   "#22c55e",
  claim_closed: "#6b7280",
  dismissed:    "#ef4444",
};
const STATUS_LABELS = {
  active:       "Active",
  settled:      "Settled",
  claim_open:   "Claim Window Open",
  claim_closed: "Claim Window Closed",
  dismissed:    "Dismissed",
};

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatPill({ label, value, color = "var(--accent)" }) {
  return (
    <div style={{ padding: "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || "#6b7280";
  return (
    <span style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4,
      background: `${color}20`, color, border: `1px solid ${color}40`, fontWeight: 600,
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const SOURCE_LABELS = {
  CourtListener:   { short: "CL",   color: "#8b5cf6" },
  TopClassActions: { short: "TCA",  color: "#06b6d4" },
  "ClassAction.org": { short: "CA", color: "#0ea5e9" },
  tcpaworld:       { short: "TW",   color: "#ec4899" },
  unicourt:        { short: "UC",   color: "#f97316" },
  trellis:         { short: "TR",   color: "#84cc16" },
  FCC:             { short: "FCC",  color: "#a78bfa" },
  stateAG:         { short: "AG",   color: "#14b8a6" },
  manual:          { short: "MAN",  color: "#6b7280" },
};

function SourceBadge({ source }) {
  const meta = SOURCE_LABELS[source] || { short: source?.slice(0, 3).toUpperCase() || "?", color: "#6b7280" };
  return (
    <span title={source} style={{
      fontSize: 9, padding: "1px 5px", borderRadius: 3,
      background: `${meta.color}1f`, color: meta.color,
      border: `1px solid ${meta.color}33`, fontWeight: 700,
      letterSpacing: "0.04em",
    }}>
      {meta.short}
    </span>
  );
}

function fmtRelativeTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return iso;
  const delta = Date.now() - t;
  const min = Math.round(delta / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function SourcesPanel({ stats, busy, onRun }) {
  const sources = ["courtlistener", "tcpaworld", "classaction", "unicourt", "trellis", "fcc"];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Ingest Sources</div>
        <Btn small onClick={() => onRun("daily")} disabled={busy}>
          {busy ? "Running…" : "Run daily"}
        </Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {sources.map((s) => {
          const st = stats?.[s];
          const ok = st && !st.errors;
          const hasRun = !!st?.ranAt;
          const dotColor = !hasRun ? "#6b7280" : ok ? "#22c55e" : "#f59e0b";
          return (
            <div key={s} style={{
              padding: "8px 10px", borderRadius: 7,
              background: "var(--bg-surface2)", border: "1px solid var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{s}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-6)", marginBottom: 2 }}>
                {hasRun ? `Last ${fmtRelativeTime(st.ranAt)}` : "Never run"}
              </div>
              {hasRun && (
                <div style={{ fontSize: 10, color: "var(--text-5)" }}>
                  {st.created != null ? `+${st.created} new` : ""}
                  {st.updated ? ` · ${st.updated} upd` : ""}
                  {st.errors ? ` · ${st.errors} err` : ""}
                  {st.totalComplaints != null ? ` · ${st.totalComplaints} complaints` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ClaimCountdown({ closes }) {
  const days = daysUntil(closes);
  if (days === null) return null;
  let color = "#22c55e";
  let label = `${days}d to claim`;
  if (days < 0) { color = "#6b7280"; label = "Window closed"; }
  else if (days <= 7) { color = "#ef4444"; label = `${days}d left`; }
  else if (days <= 30) { color = "#f59e0b"; label = `${days}d left`; }
  return (
    <span style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4,
      background: `${color}20`, color, border: `1px solid ${color}40`, fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function CaseRow({ tcase, onSelect, selected }) {
  const [hov, setHov] = useState(false);
  const defendants = (tcase.defendants || []).map(d => d.displayName).join(", ") || "—";
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onSelect}
      style={{
        display: "flex", gap: 12, alignItems: "center", padding: "10px 14px",
        borderRadius: 8, cursor: "pointer", transition: "all 0.13s",
        background: selected ? "rgba(94,234,212,0.08)" : hov ? "var(--bg-surface)" : "transparent",
        border: `1px solid ${selected ? "rgba(94,234,212,0.3)" : hov ? "var(--border-hov)" : "var(--border)"}`,
        marginBottom: 4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {tcase.caption}
          </span>
          <StatusBadge status={tcase.status} />
          <ClaimCountdown closes={tcase.settlement?.claimWindowCloses} />
          <span style={{ fontSize: 10, color: "var(--text-7)" }}>{tcase.caseType}</span>
          {tcase.source && <SourceBadge source={tcase.source} />}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-5)" }}>
          Defendants: {defendants}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 2 }}>
          {tcase.court?.name || "—"} · Filed {fmtDate(tcase.filingDate)}
          {tcase.settlement?.totalFund ? ` · Fund ${tcase.settlement.totalFund}` : ""}
        </div>
      </div>
    </div>
  );
}

function EligibleClientRow({ match, rank }) {
  const [exp, setExp] = useState(false);
  const c = match.client || {};
  const sc = match.score >= 75 ? "#22c55e" : match.score >= 50 ? "#f59e0b" : match.score >= 30 ? "#fb923c" : "#ef4444";
  return (
    <div
      onClick={() => setExp(x => !x)}
      style={{
        padding: "10px 12px", borderRadius: 8, marginBottom: 6,
        background: "var(--bg-surface2)", border: "1px solid var(--border)", cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 40, flexShrink: 0, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", fontWeight: 700 }}>#{rank}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: sc, lineHeight: 1.1 }}>{match.score}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 2 }}>
            {c.firstName} {c.lastName}
            {c.state && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-6)" }}>{c.state}</span>}
            {match.qualifies && <span style={{ marginLeft: 8, fontSize: 9, color: "#22c55e", fontWeight: 700 }}>QUALIFIES</span>}
            {match.confidenceSource && (
              <span style={{ marginLeft: 8, fontSize: 9, color: "var(--text-7)" }}>via {match.confidenceSource}</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-5)" }}>{match.reason}</div>
        </div>
      </div>
      {exp && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          {match.matchingFactors?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Matching Factors</div>
              {match.matchingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>+ {f}</div>)}
            </div>
          )}
          {match.disqualifyingFactors?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Disqualifying Factors</div>
              {match.disqualifyingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "#f87171" }}>− {f}</div>)}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-6)", display: "flex", gap: 12 }}>
            {c.email && <a href={`mailto:${c.email}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{c.email}</a>}
            {c.phone && <span>{c.phone}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function CaseBrief({ tcase }) {
  const [brief, setBrief] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(null);

  // Try the KV cache on mount. If a brief was already generated for this case,
  // show it instantly. Otherwise show the "Generate" CTA.
  useEffect(() => {
    setBrief(null);
    setGeneratedAt(null);
    setError(null);
    setChecking(true);
    fetch(`/api/tcpa-brief?id=${encodeURIComponent(tcase.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.brief) {
          setBrief(d.brief);
          setGeneratedAt(d.generatedAt || null);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [tcase.id]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/tcpa-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tcase.id }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setBrief(d.brief);
      setGeneratedAt(d.generatedAt || new Date().toISOString());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (checking) {
    return (
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Case Brief</div>
        <div style={{ fontSize: 11, color: "var(--text-6)" }}>Loading…</div>
      </div>
    );
  }

  if (!brief && !loading && !error) {
    return (
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Case Brief</div>
          <Btn small onClick={generate}>Generate Brief</Btn>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-6)" }}>
          AI-generated 1-page memo: case summary, who qualifies, damages exposure, intake angle, red flags. Cached for 30 days.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Case Brief</div>
          {generatedAt && (
            <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 2 }}>
              Generated {fmtRelativeTime(generatedAt)}
            </div>
          )}
        </div>
        {brief && <button onClick={generate} style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>Re-generate</button>}
      </div>

      {loading && (
        <div style={{ fontSize: 11, color: "var(--text-5)", padding: "16px 0", textAlign: "center" }}>
          Drafting brief…
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "#ef4444", padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)" }}>
          {error}
        </div>
      )}

      {brief && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            ["Summary",              brief.summary],
            ["Who qualifies",        brief.whoQualifies],
            ["Damages exposure",     brief.damagesExposure],
            ["Settlement trajectory",brief.settlementTrajectory],
            ["Intake angle",         brief.intakeAngle],
          ].map(([k, v]) => v ? (
            <div key={k}>
              <div style={{ fontSize: 9, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, marginBottom: 5 }}>{k}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>{v}</div>
            </div>
          ) : null)}
          {brief.redFlags?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#ef4444", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, marginBottom: 5 }}>Red flags</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-3)", lineHeight: 1.55 }}>
                {brief.redFlags.map((r, i) => <li key={i} style={{ marginBottom: 3 }}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EVENT_LABELS = {
  settlement_preliminary: { label: "Preliminary settlement",   color: "#f59e0b" },
  settlement_final:       { label: "Final settlement approval", color: "#22c55e" },
  claim_window_opens:     { label: "Claim window opened",       color: "#22c55e" },
  claim_window_closes:    { label: "Claim window closing",      color: "#ef4444" },
  mtd_filed:              { label: "Motion to dismiss filed",   color: "#3b82f6" },
  mtd_granted:            { label: "Motion to dismiss granted", color: "#ef4444" },
  mtd_denied:             { label: "Motion to dismiss denied",  color: "#22c55e" },
  class_cert_granted:     { label: "Class certified",           color: "#22c55e" },
  class_cert_denied:      { label: "Class cert denied",         color: "#ef4444" },
  transfer_mdl:           { label: "Transferred to MDL",        color: "#8b5cf6" },
  voluntary_dismissal:    { label: "Voluntarily dismissed",     color: "#6b7280" },
  stay_ordered:           { label: "Stay ordered",              color: "#6b7280" },
  other_filing:           { label: "Docket activity",           color: "#6b7280" },
};

function TrackingHistory({ caseId }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/tcpa-cases?id=${encodeURIComponent(caseId)}&history=1`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setHistory(Array.isArray(d.history) ? d.history : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [caseId]);

  async function runTracker() {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/agents?run=case-tracker`);
      await r.json();
      // The agent walks priority queue, so single-case turnaround isn't guaranteed.
      // Re-poll history after a beat.
      setTimeout(load, 1500);
    } catch {
      setRefreshing(false);
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Tracking history</div>
          <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>
            Settlement, motion-to-dismiss, class cert and other docket events recorded by the case-tracker agent.
          </div>
        </div>
        <Btn small variant="secondary" onClick={runTracker} disabled={refreshing}>
          {refreshing ? "Running…" : "Run tracker"}
        </Btn>
      </div>

      {loading && <div style={{ fontSize: 11, color: "var(--text-5)", padding: "10px 0" }}>Loading history…</div>}
      {error && <div style={{ fontSize: 11, color: "#ef4444", padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>{error}</div>}
      {!loading && !error && (!history || history.length === 0) && (
        <div style={{ fontSize: 11, color: "var(--text-6)", padding: "16px 12px", background: "var(--bg-surface2)", borderRadius: 6, textAlign: "center" }}>
          No events recorded yet. The tracker checks active cases on a daily schedule, or click "Run tracker".
        </div>
      )}
      {!loading && !error && history && history.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {history.map((ev, i) => {
            const meta = EVENT_LABELS[ev.type] || { label: ev.type, color: "#6b7280" };
            return (
              <div key={i} style={{
                padding: "8px 12px", background: "var(--bg-surface2)", borderRadius: 6,
                border: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "flex-start",
              }}>
                <div style={{ width: 8, minWidth: 8, marginTop: 4, height: 8, borderRadius: "50%", background: meta.color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                    {ev.date && <span style={{ fontSize: 10, color: "var(--text-6)" }}>{fmtDate(ev.date)}</span>}
                    {ev.confidence !== undefined && (
                      <span style={{ fontSize: 10, color: ev.confidence >= 80 ? "#22c55e" : "var(--text-6)" }}>
                        conf {ev.confidence}
                      </span>
                    )}
                    {ev.source && <span style={{ fontSize: 10, color: "var(--text-7)" }}>via {ev.source}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{ev.summary}</div>
                  {ev.settlementAmount && (
                    <div style={{ fontSize: 11, color: "#22c55e", marginTop: 3 }}>Fund: {ev.settlementAmount}</div>
                  )}
                  {ev.url && (
                    <a href={ev.url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none", marginTop: 3, display: "inline-block" }}>
                      source ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CaseDetail({ tcase, onClose }) {
  const [matches, setMatches] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState(null);

  async function runMatch() {
    setMatchLoading(true);
    setMatchError(null);
    try {
      const r = await fetch("/api/match-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "case-to-clients", caseId: tcase.id, caseType: "TCPA" }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMatches(d);
    } catch (e) {
      setMatchError(e.message);
    }
    setMatchLoading(false);
  }

  const closes = tcase.settlement?.claimWindowCloses;
  const closingDays = daysUntil(closes);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>
            {tcase.caption}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <StatusBadge status={tcase.status} />
            <ClaimCountdown closes={closes} />
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "rgba(100,120,220,0.12)", color: "#8090d0", border: "1px solid rgba(100,120,220,0.2)", fontWeight: 600 }}>
              {tcase.caseType}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-5)" }}>
            {tcase.court?.name || "—"} · {tcase.court?.jurisdiction || "—"}
            {tcase.court?.docket ? ` · Docket ${tcase.court.docket}` : ""}
          </div>
          {tcase.sourceUrl && (
            <div style={{ marginTop: 8 }}>
              <a
                href={tcase.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11, color: "var(--accent)",
                  textDecoration: "none", display: "inline-flex",
                  alignItems: "center", gap: 5, fontWeight: 600,
                  padding: "4px 10px", borderRadius: 999,
                  background: "var(--accent-soft)",
                  border: "1px solid rgba(94,234,212,0.25)",
                }}
              >
                View on {tcase.source} ↗
              </a>
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[
          ["Filed", fmtDate(tcase.filingDate)],
          ["Class period", `${fmtDate(tcase.classPeriod?.start)} → ${fmtDate(tcase.classPeriod?.end)}`],
          ["Settlement fund", tcase.settlement?.totalFund || "—"],
          ["Per-claimant", tcase.settlement?.perClaimantRange || "—"],
          ["Claim opens", fmtDate(tcase.settlement?.claimWindowOpens)],
          ["Claim closes", fmtDate(closes)],
          ["Geographic scope", tcase.geographicScope || "—"],
          ["NOS", tcase.natureOfSuit || "—"],
        ].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>{v}</div>
          </div>
        ))}
      </div>

      {tcase.defendants?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Defendants</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tcase.defendants.map((d, i) => (
              <span key={i} style={{ fontSize: 11, padding: "3px 8px", background: "var(--bg-surface2)", borderRadius: 5, color: "var(--text-2)", border: "1px solid var(--border)" }}>
                {d.displayName} {d.role && d.role !== "primary" && <span style={{ color: "var(--text-7)", marginLeft: 4 }}>{d.role}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {tcase.classDefinition && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Class definition</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>
            {tcase.classDefinition}
          </div>
        </div>
      )}

      {tcase.conductDescription && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Conduct</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
            {tcase.conductDescription}
          </div>
        </div>
      )}

      {tcase.eligibleStates?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Eligible states</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{tcase.eligibleStates.join(", ")}</div>
        </div>
      )}

      {/* AI-generated brief — Summary / Who qualifies / Damages / Trajectory / Intake / Red flags */}
      <CaseBrief tcase={tcase} />

      <TrackingHistory caseId={tcase.id} />

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Eligible Clients</div>
          {!matches && (
            <Btn small onClick={runMatch} disabled={matchLoading}>
              {matchLoading ? "Matching…" : "Find Eligible Clients"}
            </Btn>
          )}
          {matches && (
            <button onClick={() => setMatches(null)} style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>
              Re-run
            </button>
          )}
        </div>

        {matchError && (
          <div style={{ fontSize: 11, color: "#ef4444", padding: "8px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)" }}>
            {matchError}
          </div>
        )}

        {matchLoading && (
          <div style={{ fontSize: 11, color: "var(--text-5)", padding: "16px 0", textAlign: "center" }}>
            Scoring all clients against this case…
          </div>
        )}

        {matches && (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 10 }}>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>{matches.qualifying || 0}</span> qualifying out of{" "}
              <span style={{ fontWeight: 600 }}>{matches.total || 0}</span> clients
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {(matches.matches || []).slice(0, 50).map((m, i) => (
                <EligibleClientRow key={m.id || i} match={m} rank={i + 1} />
              ))}
              {(matches.matches || []).length === 0 && (
                <div style={{ fontSize: 11, color: "var(--text-6)", textAlign: "center", padding: "16px 0" }}>
                  No clients matched.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TCPACases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [defendantQ, setDefendantQ] = useState("");
  const [selectedCase, setSelectedCase] = useState(null);
  const [view, setView] = useState("all"); // "all" | "closing" | "by-defendant"
  const [ingestStats, setIngestStats] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [rollup, setRollup] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/tcpa-cases");
      const d = await r.json();
      setCases(Array.isArray(d.cases) ? d.cases : []);
    } catch {
      setCases([]);
    }
    setLoading(false);
  }
  async function loadStats() {
    try {
      const r = await fetch("/api/tcpa-ingest?stats=1");
      const d = await r.json();
      setIngestStats(d.stats || {});
    } catch {
      setIngestStats({});
    }
  }
  async function loadRollup() {
    try {
      const r = await fetch("/api/agents?rollup=freshness");
      const d = await r.json();
      setRollup(d.rollup || null);
    } catch {
      setRollup(null);
    }
  }
  async function runIngest(mode) {
    setIngesting(true);
    try {
      await fetch(`/api/tcpa-ingest?source=all&mode=${mode}`);
      await Promise.all([load(), loadStats()]);
    } catch {
      // surfaced via stats panel error count on next load
    }
    setIngesting(false);
  }
  useEffect(() => { load(); loadStats(); loadRollup(); }, []);

  async function runDefendantSearch() {
    if (!defendantQ.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/tcpa-cases?defendant=${encodeURIComponent(defendantQ.trim())}`);
      const d = await r.json();
      setCases(Array.isArray(d.cases) ? d.cases : []);
    } catch {
      setCases([]);
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return cases.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (stateFilter) {
        const st = stateFilter.toUpperCase();
        const courtMatch = c.court?.state === st;
        const eligibleMatch = (c.eligibleStates || []).includes(st);
        if (!courtMatch && !eligibleMatch) return false;
      }
      if (searchQ) {
        const ql = searchQ.toLowerCase();
        const hay = `${c.caption || ""} ${(c.defendants || []).map(d => d.displayName).join(" ")} ${c.conductDescription || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (view === "closing") {
        const days = daysUntil(c.settlement?.claimWindowCloses);
        if (days === null || days < 0 || days > 30) return false;
      }
      return true;
    });
  }, [cases, statusFilter, stateFilter, searchQ, view]);

  // Stats — prefer the freshness-agent rollup (server-side, fast). Fall back
  // to client-computed values when the rollup hasn't been built yet.
  const tcpaCounts = rollup?.counts?.tcpaCases;
  const total = tcpaCounts?.total ?? cases.length;
  const claimOpen = tcpaCounts?.byStatus?.claim_open ?? cases.filter(c => c.status === "claim_open").length;
  const closingSoon = rollup?.watchlist?.closingSoon?.length ?? cases.filter(c => {
    const d = daysUntil(c.settlement?.claimWindowCloses);
    return d !== null && d >= 0 && d <= 30;
  }).length;
  // Sum of disclosed settlement funds in MILLIONS (matches the StatPill label).
  // Rollup stores raw dollars; convert. Client-side fallback summed millions
  // already (legacy convention) so its value is used as-is.
  const totalFundMillions = tcpaCounts?.totalFundDollars != null
    ? Math.round(tcpaCounts.totalFundDollars / 1_000_000)
    : cases.reduce((acc, c) => {
        const raw = c.settlement?.totalFund;
        if (raw == null) return acc;
        const s = String(raw);
        const m = s.match(/[\d.]+/);
        if (!m) return acc;
        const n = parseFloat(m[0]);
        if (!isFinite(n)) return acc;
        const isBillions = /b/i.test(s);
        return acc + n * (isBillions ? 1000 : 1);
      }, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Total Cases"           value={total}            color="var(--accent)" />
        <StatPill label="Claim Windows Open"    value={claimOpen || "—"} color="#22c55e" />
        <StatPill label="Closing in 30 Days"    value={closingSoon || "—"} color="#f59e0b" />
        <StatPill label="Tracked Settlements ($M)" value={totalFundMillions ? Math.round(totalFundMillions) : "—"} color="#3b82f6" />
      </div>

      <SourcesPanel stats={ingestStats} busy={ingesting} onRun={runIngest} />

      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "all",       label: `All Cases (${total})` },
          { id: "closing",   label: `Closing Soon (${closingSoon})` },
        ].map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            padding: "9px 18px", border: "none", background: "transparent",
            borderBottom: view === v.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: view === v.id ? "var(--text-1)" : "var(--text-5)",
            fontWeight: view === v.id ? 700 : 400, fontSize: 13, cursor: "pointer", marginBottom: -1,
          }}>
            {v.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search caption, conduct, defendants…"
              style={{ flex: 1, minWidth: 180, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_LABELS).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
              <option value="">All States</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              value={defendantQ}
              onChange={e => setDefendantQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runDefendantSearch(); }}
              placeholder="Search by defendant (e.g. Capital One)…"
              style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
            />
            <Btn small onClick={runDefendantSearch} disabled={!defendantQ.trim()}>Search</Btn>
            {defendantQ && <Btn small variant="secondary" onClick={() => { setDefendantQ(""); load(); }}>Clear</Btn>}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
            Showing {filtered.length} of {total} cases
          </div>

          {loading ? (
            <div style={{ fontSize: 12, color: "var(--text-5)", textAlign: "center", padding: "32px 0" }}>Loading TCPA cases…</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 13, color: "var(--text-5)", marginBottom: 12 }}>
                {total === 0 ? "No TCPA cases in database yet. Seed via POST /api/tcpa-cases or wait for the scanner to populate." : "No cases match these filters."}
              </div>
            </div>
          ) : (
            <div style={{ maxHeight: 700, overflowY: "auto" }}>
              {filtered.map(c => (
                <CaseRow
                  key={c.id}
                  tcase={c}
                  selected={selectedCase?.id === c.id}
                  onSelect={() => setSelectedCase(c)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          {!selectedCase ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-6)", fontSize: 12 }}>
              Click a case to view full details and find eligible clients
            </div>
          ) : (
            <CaseDetail tcase={selectedCase} onClose={() => setSelectedCase(null)} />
          )}
        </Card>
      </div>
    </div>
  );
}
