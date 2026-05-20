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

const POSTURE_LABELS = {
  new_filing:         { label: "New Filing",            color: "#3b82f6", hint: "Filed < 6 months ago" },
  discovery:          { label: "Discovery",             color: "#8b5cf6", hint: "Active discovery / depositions" },
  class_cert_pending: { label: "Class Cert Pending",    color: "#f59e0b", hint: "Motion for class certification briefed" },
  pre_trial:          { label: "Pre-Trial",             color: "#f97316", hint: "Class certified, approaching trial" },
  trial:              { label: "At Trial",              color: "#ef4444", hint: "Actively at trial" },
  post_trial:         { label: "Post-Trial",            color: "#ec4899", hint: "Verdict in, post-trial motions pending" },
  settlement_pending: { label: "Settlement Pending",    color: "#22c55e", hint: "Settlement reached, awaiting court approval" },
  mdl_pending:        { label: "MDL / Transfer",        color: "#06b6d4", hint: "JPML transfer order pending or entered" },
  appeal:             { label: "On Appeal",             color: "#a78bfa", hint: "Circuit court or SCOTUS appeal" },
  unknown:            { label: "Unknown",               color: "#6b7280", hint: "" },
};

function PostureBadge({ posture }) {
  const meta = POSTURE_LABELS[posture] || POSTURE_LABELS.unknown;
  return (
    <span title={meta.hint} style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4,
      background: `${meta.color}20`, color: meta.color,
      border: `1px solid ${meta.color}40`, fontWeight: 600, cursor: "default",
    }}>
      {meta.label}
    </span>
  );
}

function caseAgeLabel(filingDate) {
  if (!filingDate) return null;
  const months = Math.round((Date.now() - Date.parse(filingDate)) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1)  return "< 1 month old";
  if (months < 12) return `${months} months old`;
  const years = (months / 12).toFixed(1);
  return `${years} years old`;
}

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

// Quick-add: paste a URL or describe a case → Claude extracts it → saved instantly
function QuickAddCase({ onAdded }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/tcpa-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extract: text.trim() }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg(`Saved: ${d.case?.caption || "case added"}`);
      setText("");
      onAdded?.();
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
    setSaving(false);
  }

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Add a Known Case</div>
      <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
        Paste a case name, settlement URL, or description. Claude will extract the details and save it.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={"e.g. \"Capital One TCPA settlement $210M, claim deadline June 30 2026, https://capitalonetcpa.com\"\nor paste any article text about an open TCPA settlement"}
        style={{
          width: "100%", minHeight: 72, background: "var(--bg-input)",
          border: "1px solid var(--border)", borderRadius: 7, padding: "8px 12px",
          color: "var(--text-1)", fontSize: 12, resize: "vertical", outline: "none",
          boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <Btn small onClick={submit} disabled={saving || !text.trim()}>
          {saving ? "Extracting…" : "Add Case"}
        </Btn>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith("Error") ? "#ef4444" : "#22c55e" }}>{msg}</span>
        )}
      </div>
    </Card>
  );
}

function SourcesPanel({ stats, busy, onRun, lastResult }) {
  const sources = ["courtlistener", "tcpaworld", "classaction", "unicourt", "trellis", "fcc"];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Ingest Sources</div>
          <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 2 }}>Pull TCPA/FDCPA/FCRA cases from CourtListener, TopClassActions, ClassAction.org, FCC</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small variant="secondary" onClick={() => onRun("daily")} disabled={busy}>
            {busy ? "Running…" : "Run Daily Update"}
          </Btn>
          <Btn small onClick={() => onRun("backfill")} disabled={busy}>
            {busy ? "Running…" : "Run Full Backfill (2021–now)"}
          </Btn>
        </div>
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
      {lastResult && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 7, fontSize: 12,
          background: lastResult.ok === false ? "#ef444420" : "#22c55e20",
          border: `1px solid ${lastResult.ok === false ? "#ef4444" : "#22c55e"}40`,
          color: lastResult.ok === false ? "#ef4444" : "var(--text-2)",
        }}>
          {lastResult.ok === false
            ? `Error: ${lastResult.error || JSON.stringify(lastResult)}`
            : `Done — ${lastResult.totals?.created ?? 0} new cases, ${lastResult.totals?.updated ?? 0} updated, ${lastResult.totals?.errors ?? 0} errors. ${
                (lastResult.runs || []).filter(r => r.error).map(r => `${r.source}: ${r.error}`).join(" | ") || ""
              }`
          }
        </div>
      )}
    </Card>
  );
}

// Expand a compact index summary back to a display-ready shape.
// Index uses short keys to stay under KV size limits; the rest of the UI
// expects full key names. Full records pass through unchanged.
function expandCase(c) {
  if (!c) return c;
  if (c.caption) return c; // already full format
  return {
    id:          c.i,
    caption:     c.ca,
    status:      c.s,
    caseType:    c.t,
    casePosture: c.p,
    filingDate:  c.f,
    defendants:  (c.d || []).map(name => ({ displayName: name })),
    court:       { state: c.st, name: "", jurisdiction: "federal", docket: "", district: "" },
    settlement: {
      claimWindowCloses: c.cw,
      perClaimantRange:  c.pc,
      totalFund:         c.tf,
    },
    source:      c.sr,
    // Fields not in the compact index — empty defaults so CaseRow doesn't crash
    conductDescription: "",
    classDefinition:    "",
    geographicScope:    "nationwide",
    eligibleStates:     [],
    classPeriod:        { start: null, end: null },
    _isCompact:         true, // flag so CaseDetail knows to fetch the full record
  };
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
          {tcase.status === "active" && tcase.casePosture && tcase.casePosture !== "unknown" && <PostureBadge posture={tcase.casePosture} />}
          <ClaimCountdown closes={tcase.settlement?.claimWindowCloses} />
          <span style={{ fontSize: 10, color: "var(--text-7)" }}>{tcase.caseType}</span>
          {tcase.source && <SourceBadge source={tcase.source} />}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-5)" }}>
          {defendants}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 2 }}>
          {tcase.court?.name || "—"} · Filed {fmtDate(tcase.filingDate)} · {caseAgeLabel(tcase.filingDate)}
          {tcase.settlement?.perClaimantRange ? ` · ${tcase.settlement.perClaimantRange}/claimant` : ""}
          {tcase.settlement?.totalFund ? ` · $${Number(tcase.settlement.totalFund).toLocaleString()} fund` : ""}
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

// ── Claim Filing Panel ────────────────────────────────────────────────────────
function ClaimFilingPanel({ tcase }) {
  const [claims, setClaims] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filing, setFiling] = useState(null); // clientId being filed
  const [open, setOpen] = useState(false);

  const isClaimable = ["settled", "claim_open"].includes(tcase.status);
  if (!isClaimable) return null;

  async function loadClaims() {
    setLoading(true);
    try {
      const r = await fetch(`/api/claims?caseId=${encodeURIComponent(tcase.id)}`);
      const d = await r.json();
      setClaims(d.claims || []);
    } catch { setClaims([]); }
    setLoading(false);
  }

  async function fileClaim(client) {
    setFiling(client.id);
    try {
      const r = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId:          tcase.id,
          clientId:        client.id,
          clientName:      `${client.firstName || ""} ${client.lastName || ""}`.trim(),
          caseCaption:     tcase.caption,
          caseType:        tcase.caseType,
          defendant:       (tcase.defendants || [])[0]?.displayName || "",
          claimPortalUrl:  tcase.settlement?.claimPortalUrl || null,
          claimWindowCloses: tcase.settlement?.claimWindowCloses || null,
          estimatedPayout: tcase.settlement?.perClaimantRange || null,
        }),
      });
      await r.json();
      await loadClaims();
    } catch { /* ignore */ }
    setFiling(null);
  }

  async function updateStatus(claimId, status) {
    await fetch("/api/claims", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: claimId, status }),
    });
    await loadClaims();
  }

  const STATUS_COLORS = { identified: "#f59e0b", drafted: "#3b82f6", submitted: "#8b5cf6", confirmed: "#22c55e", paid: "#22c55e", rejected: "#ef4444", dismissed: "#6b7280" };
  const closingDays = tcase.settlement?.claimWindowCloses
    ? Math.ceil((Date.parse(tcase.settlement.claimWindowCloses) - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div style={{ marginBottom: 16, borderRadius: 8, border: "1px solid #22c55e40", background: "rgba(34,197,94,0.04)" }}>
      <div
        onClick={() => { setOpen(o => !o); if (!open && !claims) loadClaims(); }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer" }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e" }}>Claim Filing</span>
          {closingDays !== null && closingDays >= 0 && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: closingDays <= 14 ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.12)", color: closingDays <= 14 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
              {closingDays}d left to claim
            </span>
          )}
          {claims !== null && (
            <span style={{ fontSize: 10, color: "var(--text-5)" }}>{claims.length} claim{claims.length !== 1 ? "s" : ""} on file</span>
          )}
          {tcase.settlement?.claimPortalUrl && (
            <a href={tcase.settlement.claimPortalUrl} target="_blank" rel="noopener noreferrer"
               onClick={e => e.stopPropagation()}
               style={{ fontSize: 10, color: "#3b82f6", textDecoration: "none", fontWeight: 600 }}>
              Claim Portal ↗
            </a>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-5)" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {loading ? (
            <div style={{ fontSize: 11, color: "var(--text-5)", textAlign: "center", padding: "12px 0" }}>Loading claims…</div>
          ) : (
            <>
              {/* Existing claims */}
              {(claims || []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Filed claims</div>
                  {claims.map(c => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 4 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>{c.clientName}</div>
                        <div style={{ fontSize: 10, color: "var(--text-5)" }}>
                          {c.claimNumber ? `Claim #${c.claimNumber} · ` : ""}
                          {c.submittedAt ? `Submitted ${fmtDate(c.submittedAt)}` : `Created ${fmtDate(c.createdAt)}`}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: `${STATUS_COLORS[c.status] || "#6b7280"}20`, color: STATUS_COLORS[c.status] || "#6b7280", border: `1px solid ${STATUS_COLORS[c.status] || "#6b7280"}40`, fontWeight: 600 }}>
                          {c.status}
                        </span>
                        {c.status === "identified" && (
                          <button onClick={() => updateStatus(c.id, "submitted")}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#8b5cf6", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
                            Mark submitted
                          </button>
                        )}
                        {c.status === "submitted" && (
                          <button onClick={() => updateStatus(c.id, "confirmed")}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#22c55e", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
                            Mark confirmed
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick-file for eligible clients */}
              <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                File claim for a client
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <QuickFileSearch tcase={tcase} existingClientIds={new Set((claims || []).map(c => c.clientId))} onFile={fileClaim} filing={filing} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function QuickFileSearch({ tcase, existingClientIds, onFile, filing }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/clients?q=${encodeURIComponent(q)}&limit=20`);
      const d = await r.json();
      setResults(d.clients || []);
    } catch { setResults([]); }
    setSearching(false);
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search client by name, phone, or email…"
          style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
        />
        <button onClick={search} disabled={searching || !q.trim()}
          style={{ padding: "7px 14px", borderRadius: 6, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          {searching ? "…" : "Search"}
        </button>
      </div>
      {results !== null && (
        <div>
          {results.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-5)" }}>No clients found.</div>
          ) : results.map(c => {
            const alreadyFiled = existingClientIds.has(c.id);
            return (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 5, marginBottom: 3 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>{c.firstName} {c.lastName}</span>
                  <span style={{ fontSize: 10, color: "var(--text-5)", marginLeft: 8 }}>{c.state || "—"} · {c.email || c.phone || "—"}</span>
                </div>
                {alreadyFiled ? (
                  <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 600 }}>Already filed</span>
                ) : (
                  <button onClick={() => onFile(c)} disabled={filing === c.id}
                    style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "#22c55e", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {filing === c.id ? "Filing…" : "File claim"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CaseDetail({ tcase, onClose }) {
  const [detailTab, setDetailTab] = useState("overview");
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

      {/* Detail tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
        {[
          { id: "overview",   label: "Overview" },
          { id: "settlement", label: tcase.status === "claim_open" ? "Settlement ✓" : "Settlement" },
          { id: "posture",    label: "Case Posture" },
        ].map(t => (
          <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
            padding: "7px 14px", border: "none", background: "transparent", fontSize: 12,
            borderBottom: detailTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: detailTab === t.id ? "var(--text-1)" : "var(--text-5)",
            fontWeight: detailTab === t.id ? 700 : 400, cursor: "pointer", marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {detailTab === "overview" && (<>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            ["Filed",         fmtDate(tcase.filingDate)],
            ["Case age",      caseAgeLabel(tcase.filingDate)],
            ["Court",         tcase.court?.name || "—"],
            ["Docket",        tcase.court?.docket || "—"],
            ["Class period",  tcase.classPeriod?.start ? `${fmtDate(tcase.classPeriod.start)} → ${fmtDate(tcase.classPeriod.end)}` : "—"],
            ["Geographic scope", tcase.geographicScope || "nationwide"],
          ].filter(([, v]) => v && v !== "—").map(([l, v]) => (
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
                  {d.displayName}{d.role && d.role !== "defendant" ? <span style={{ color: "var(--text-7)", marginLeft: 4 }}>({d.role})</span> : null}
                </span>
              ))}
            </div>
          </div>
        )}

        {tcase.conductDescription && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>What defendant did</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.6, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{tcase.conductDescription}</div>
          </div>
        )}

        {tcase.classDefinition && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Class definition</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.6, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{tcase.classDefinition}</div>
          </div>
        )}

        {tcase.eligibleStates?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Eligible states</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{tcase.eligibleStates.join(", ")}</div>
          </div>
        )}
        <CaseBrief tcase={tcase} />
        <TrackingHistory caseId={tcase.id} />
      </>)}

      {/* SETTLEMENT TAB — all 7 items */}
      {detailTab === "settlement" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* (a) Is the claim window open? */}
          <div style={{ padding: "12px 14px", borderRadius: 8, background: tcase.status === "claim_open" ? "rgba(34,197,94,0.06)" : "var(--bg-surface2)", border: `1px solid ${tcase.status === "claim_open" ? "#22c55e40" : "var(--border)"}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-6)", marginBottom: 6 }}>Claim window status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StatusBadge status={tcase.status} />
              {tcase.status === "claim_open" && closingDays !== null && (
                <span style={{ fontSize: 12, fontWeight: 700, color: closingDays <= 14 ? "#ef4444" : "#22c55e" }}>
                  {closingDays <= 0 ? "Closes today" : `${closingDays} days remaining`}
                </span>
              )}
              {tcase.status === "settled" && <span style={{ fontSize: 11, color: "var(--text-5)" }}>Settlement reached — claim window not yet open</span>}
              {tcase.status === "active" && <span style={{ fontSize: 11, color: "var(--text-5)" }}>Case still in litigation — no settlement yet</span>}
              {tcase.status === "claim_closed" && <span style={{ fontSize: 11, color: "var(--text-5)" }}>Claim window has closed</span>}
            </div>
          </div>

          {/* (b) Settlement amount + (e) per claimant */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              ["(b) Total settlement fund", tcase.settlement?.totalFund ? `$${Number(tcase.settlement.totalFund).toLocaleString()}` : null],
              ["(e) Per claimant payment",  tcase.settlement?.perClaimantRange],
              ["(c) Claim deadline",        tcase.settlement?.claimWindowCloses ? fmtDate(tcase.settlement.claimWindowCloses) : null],
              ["Claim window opens",        tcase.settlement?.claimWindowOpens  ? fmtDate(tcase.settlement.claimWindowOpens)  : null],
              ["Final approval date",       tcase.settlement?.finalApprovalDate ? fmtDate(tcase.settlement.finalApprovalDate) : null],
              ["Fairness hearing",          tcase.settlement?.fairnessHearingDate ? fmtDate(tcase.settlement.fairnessHearingDate) : null],
            ].filter(([, v]) => v).map(([l, v]) => (
              <div key={l} style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* (d) Requirements to apply */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-6)", marginBottom: 6 }}>(d) Requirements to apply</div>
            {tcase.settlement?.claimRequirements ? (
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
                {tcase.settlement.claimRequirements}
              </div>
            ) : tcase.classDefinition ? (
              <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6, padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
                {tcase.classDefinition}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-6)", fontStyle: "italic" }}>Not yet extracted — check the settlement website or use Quick-Add to paste in requirements.</div>
            )}
          </div>

          {/* (f) Settlement website + (g) Administrator */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>(f) Settlement / claim website</div>
              {tcase.settlement?.claimPortalUrl ? (
                <a href={tcase.settlement.claimPortalUrl} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 12, color: "var(--accent)", wordBreak: "break-all", textDecoration: "none", fontWeight: 600 }}>
                  {tcase.settlement.claimPortalUrl} ↗
                </a>
              ) : <span style={{ fontSize: 11, color: "var(--text-6)" }}>Not available</span>}
            </div>
            <div style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>(g) Settlement administrator</div>
              {tcase.settlement?.adminName ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>{tcase.settlement.adminName}</div>
                  {tcase.settlement.adminPhone && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{tcase.settlement.adminPhone}</div>}
                  {tcase.settlement.adminEmail && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{tcase.settlement.adminEmail}</div>}
                  {tcase.settlement.adminWebsite && (
                    <a href={tcase.settlement.adminWebsite} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>
                      {tcase.settlement.adminWebsite} ↗
                    </a>
                  )}
                </div>
              ) : <span style={{ fontSize: 11, color: "var(--text-6)" }}>Not available — check settlement website</span>}
            </div>
          </div>

          <ClaimFilingPanel tcase={tcase} />
        </div>
      )}

      {/* CASE POSTURE TAB */}
      {detailTab === "posture" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "14px 16px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-6)", marginBottom: 8 }}>Current posture</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <PostureBadge posture={tcase.casePosture || "unknown"} />
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {POSTURE_LABELS[tcase.casePosture]?.hint || ""}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              {[
                ["Filed",           fmtDate(tcase.filingDate)],
                ["Case age",        caseAgeLabel(tcase.filingDate)],
                ["Last docket activity", fmtDate(tcase.lastDocketDate)],
                ["Court",           tcase.court?.name],
                ["Docket number",   tcase.court?.docket],
                ["Jurisdiction",    tcase.court?.jurisdiction],
              ].filter(([, v]) => v).map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline interpretation */}
          <div style={{ padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-6)", marginBottom: 8 }}>What this means for plaintiff intake</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.7 }}>
              {tcase.casePosture === "new_filing" && "Case was recently filed. Early stage — good time to identify and contact potential class members. No settlement offer yet. Defendant likely to move to dismiss."}
              {tcase.casePosture === "discovery" && "Active discovery. Defendant's call logs and consent records are being subpoenaed now. Named plaintiff and class rep are the most valuable roles — contact strong claimants immediately."}
              {tcase.casePosture === "class_cert_pending" && "Class certification is the key hurdle. If granted, the class size and settlement value will be established. Plaintiff intake is actively valuable — strong class members strengthen the motion."}
              {tcase.casePosture === "pre_trial" && "Class certified or approaching trial. Settlement discussions are likely underway. Intake is still open but the class definition is locked — only clients who fit the class period can join."}
              {tcase.casePosture === "settlement_pending" && "Settlement terms have been reached and submitted to the court. Awaiting preliminary or final approval. Claim window will open after final approval — prepare your clients now."}
              {tcase.casePosture === "trial" && "Case is at trial. Settlement is possible but intake of new clients is unlikely to affect the outcome now. Monitor for verdict."}
              {tcase.casePosture === "post_trial" && "Trial is complete. If plaintiff won, class members can recover. If settlement follows a verdict, the claim window opens next."}
              {tcase.casePosture === "mdl_pending" && "Multiple related cases are being consolidated. MDL transfer increases settlement likelihood and scale. Good time to identify clients — consolidated cases typically settle larger."}
              {tcase.casePosture === "appeal" && "Under appeal. Recovery is uncertain until the appellate court rules. Monitor but hold off on aggressive intake."}
              {(!tcase.casePosture || tcase.casePosture === "unknown") && "Case posture unknown. Check the docket link above for current status."}
            </div>
          </div>

          {tcase.sourceUrl && (
            <a href={tcase.sourceUrl} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
              View full docket on {tcase.source} ↗
            </a>
          )}
        </div>
      )}

      {/* Eligible clients — always visible below tabs */}
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
  const [cases, setCases] = useState([]);        // full detail records for selected case
  const [index, setIndex] = useState([]);         // lightweight summaries for all 7k+ cases
  const [indexMeta, setIndexMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [postureFilter, setPostureFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [defendantQ, setDefendantQ] = useState("");
  const [selectedCase, setSelectedCase] = useState(null);
  const [view, setView] = useState("all"); // "all" | "closing" | "by-defendant"
  const [ingestStats, setIngestStats] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState(null);
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
    setIngestResult(null);
    // Fire-and-forget — don't await the full ingest (takes 30-120s).
    // Poll stats every 4s until the source cursor advances.
    // Backfill uses RSS sources only — CourtListener has a 125/day rate limit
    // that the crons burn through; use it only in the scheduled daily job.
    const source = mode === "backfill" ? "classaction,topclassactions" : "courtlistener,classaction,topclassactions";
    fetch(`/api/tcpa-ingest?source=${source}&mode=${mode}`).catch(() => {});
    let polls = 0;
    const prev = ingestStats?.classaction?.ranAt;
    const interval = setInterval(async () => {
      polls++;
      const [, statsRes] = await Promise.all([load(), fetch("/api/tcpa-ingest?stats=1").then(r => r.json()).catch(() => ({}))]);
      setIngestStats(statsRes.stats || {});
      const next = statsRes.stats?.classaction?.ranAt;
      if ((next && next !== prev) || polls >= 30) {
        clearInterval(interval);
        setIngesting(false);
        const cl = statsRes.stats?.classaction;
        const tca = statsRes.stats?.topclassactions;
        const created = (cl?.created || 0) + (tca?.created || 0);
        const errors = (cl?.errors || 0) + (tca?.errors || 0);
        setIngestResult({ ok: true, totals: { created, updated: 0, errors }, runs: [] });
      }
    }, 4000);
  }
  useEffect(() => { load(); loadIndex(); loadStats(); loadRollup(); }, []);

  // Load the compact search index (all 7k+ cases as lightweight summaries).
  // Pages fetched in parallel. Once loaded, ALL filters run client-side.
  async function loadIndex() {
    try {
      // Fetch meta first to know how many pages exist
      const metaRes = await fetch("/api/tcpa-cases?searchIndex=1&page=0");
      const metaData = await metaRes.json();
      setIndexMeta(metaData);
      if (metaData.building || metaData.pages === 0) return; // index not ready yet
      const page0 = metaData.data || [];
      if (metaData.pages <= 1) { setIndex(page0); return; }
      // Fetch remaining pages in parallel
      const rest = await Promise.all(
        Array.from({ length: metaData.pages - 1 }, (_, i) =>
          fetch(`/api/tcpa-cases?searchIndex=1&page=${i + 1}`).then(r => r.json()).then(d => d.data || [])
        )
      );
      setIndex([...page0, ...rest.flat()]);
    } catch { /* index unavailable — filters will use cases[] instead */ }
  }

  async function runDefendantSearch() {
    if (!defendantQ.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/tcpa-cases?defendant=${encodeURIComponent(defendantQ.trim())}`);
      const d = await r.json();
      setCases(Array.isArray(d.cases) ? d.cases : []);
    } catch { setCases([]); }
    setLoading(false);
  }

  // ALL filters run client-side on the search index (lightweight summaries).
  // Falls back to cases[] if index hasn't loaded yet.
  // Results are expanded to display-ready format so CaseRow renders correctly.
  const filtered = useMemo(() => {
    const src = index.length > 0 ? index : cases;
    return src
      .filter(c => {
        const status   = c.status  || c.s;
        const posture  = c.casePosture || c.p;
        const state    = c.court?.state || c.st;
        const caption  = c.caption || c.ca || "";
        const defs     = c.defendants ? c.defendants.map(d => d.displayName) : (c.d || []);
        const claimEnd = c.settlement?.claimWindowCloses || c.cw;

        if (statusFilter  && status  !== statusFilter)  return false;
        if (postureFilter && posture !== postureFilter)  return false;
        if (stateFilter) {
          const st = stateFilter.toUpperCase();
          if (state !== st && !(c.eligibleStates || []).includes(st)) return false;
        }
        if (searchQ) {
          const ql  = searchQ.toLowerCase();
          const hay = `${caption} ${defs.join(" ")}`.toLowerCase();
          if (!hay.includes(ql)) return false;
        }
        if (view === "closing") {
          const days = daysUntil(claimEnd);
          if (days === null || days < 0 || days > 30) return false;
        }
        return true;
      })
      .map(expandCase);
  }, [index, cases, statusFilter, postureFilter, stateFilter, searchQ, view]);

  // Stats — prefer the freshness-agent rollup (server-side, fast). Fall back
  // to client-computed values when the rollup hasn't been built yet.
  const tcpaCounts = rollup?.counts?.tcpaCases;
  const total = index.length || tcpaCounts?.total || cases.length;
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

      <QuickAddCase onAdded={load} />
      <SourcesPanel stats={ingestStats} busy={ingesting} onRun={runIngest} lastResult={ingestResult} />

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
            <select value={postureFilter} onChange={e => setPostureFilter(e.target.value)}
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
              <option value="">All Postures</option>
              {Object.entries(POSTURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
              {total === 0 ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--text-4)", marginBottom: 8, fontWeight: 600 }}>No cases loaded yet</div>
                  <div style={{ fontSize: 12, color: "var(--text-6)", marginBottom: 16 }}>Run a full backfill to pull TCPA / FDCPA / FCRA cases from CourtListener going back to 2021.</div>
                  <Btn small onClick={() => runIngest("backfill")} disabled={ingesting}>
                    {ingesting ? "Running backfill…" : "Run Full Backfill Now"}
                  </Btn>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-5)" }}>No cases match these filters.</div>
              )}
            </div>
          ) : (
            <div style={{ maxHeight: 700, overflowY: "auto" }}>
              {filtered.map(c => (
                <CaseRow
                  key={c.id}
                  tcase={c}
                  selected={selectedCase?.id === c.id}
                  onSelect={async () => {
                    if (c._isCompact) {
                      // Compact summary — fetch full record for detail panel
                      setSelectedCase(c); // show immediately with partial data
                      try {
                        const r = await fetch(`/api/tcpa-cases?id=${encodeURIComponent(c.id)}`);
                        const d = await r.json();
                        if (d.case) setSelectedCase(d.case);
                      } catch { /* keep partial */ }
                    } else {
                      setSelectedCase(c);
                    }
                  }}
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
