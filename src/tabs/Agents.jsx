import { useState, useEffect } from "react";
import { Card, Btn } from "../components/UI.jsx";

function fmtRelativeTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return iso;
  const delta = Date.now() - t;
  const min = Math.round(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmtSchedule(cron) {
  if (!cron) return "Manual only";
  if (cron === "0 * * * *") return "Hourly";
  if (cron === "0 8 * * *") return "Daily at 08:00 UTC";
  if (cron === "0 9 * * *") return "Daily at 09:00 UTC";
  // Generic "0 <hour> * * *" → daily at that hour
  const m = cron.match(/^0 (\d{1,2}) \* \* \*$/);
  if (m) return `Daily at ${String(m[1]).padStart(2, "0")}:00 UTC`;
  return cron;
}

function StatusDot({ status }) {
  let color = "#6b7280"; // gray — never run
  if (status?.ok) color = "#22c55e";
  else if (status && !status.ok) color = "#ef4444";
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%", background: color,
      boxShadow: status?.ok ? `0 0 8px ${color}80` : "none",
      flexShrink: 0,
    }} />
  );
}

function SummaryGrid({ summary }) {
  if (!summary || typeof summary !== "object") return null;
  const entries = Object.entries(summary).slice(0, 8);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
      gap: 8, marginTop: 12,
    }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{
          padding: "8px 10px", borderRadius: 8,
          background: "var(--bg-surface2)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
            {k.replace(/([A-Z])/g, " $1").trim()}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
            {typeof v === "number" ? v.toLocaleString() : String(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentCard({ agent, onRun }) {
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showRollup, setShowRollup] = useState(false);
  const [rollupRaw, setRollupRaw] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [sourcesData, setSourcesData] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("all"); // all | running | down | skipped

  const status = agent.lastStatus;

  async function run() {
    setRunning(true);
    try {
      const r = await fetch(`/api/agents?run=${encodeURIComponent(agent.name)}`);
      const d = await r.json();
      if (d.ok === false && d.reason === "locked") {
        alert("Agent is already running. Try again in a few seconds.");
      }
    } catch {}
    setRunning(false);
    onRun(); // parent reloads list
  }

  async function loadHistory() {
    if (history) { setShowHistory((s) => !s); return; }
    try {
      const r = await fetch(`/api/agents?status=${encodeURIComponent(agent.name)}`);
      const d = await r.json();
      setHistory(d.history || []);
      setShowHistory(true);
    } catch {}
  }

  async function loadRollup() {
    if (rollupRaw) { setShowRollup((s) => !s); return; }
    try {
      const r = await fetch(`/api/agents?rollup=${encodeURIComponent(agent.name)}`);
      const d = await r.json();
      setRollupRaw(d.rollup || {});
      setShowRollup(true);
    } catch {}
  }

  async function loadSources() {
    if (sourcesData) { setShowSources((s) => !s); return; }
    try {
      const r = await fetch(`/api/agents?rollup=${encodeURIComponent(agent.name)}`);
      const d = await r.json();
      setSourcesData(d.rollup?.sources || []);
      setShowSources(true);
    } catch {}
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <StatusDot status={status} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {agent.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 2 }}>
              {fmtSchedule(agent.schedule)} · {status?.ranAt ? `last ran ${fmtRelativeTime(status.ranAt)}` : "never run"}
              {status?.durationMs != null && ` · ${(status.durationMs / 1000).toFixed(1)}s`}
            </div>
          </div>
        </div>
        <Btn small onClick={run} disabled={running}>{running ? "Running…" : "Run now"}</Btn>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.55, marginBottom: 4 }}>
        {agent.description}
      </div>

      {status?.error && (
        <div style={{
          fontSize: 11, color: "#ef4444",
          padding: "8px 10px", marginTop: 10,
          background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)",
        }}>
          {status.error}
        </div>
      )}

      {status?.summary && <SummaryGrid summary={status.summary} />}

      <div style={{ display: "flex", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 11 }}>
        <button
          onClick={loadHistory}
          style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", padding: 0 }}
        >
          {showHistory ? "Hide" : "View"} history ({history?.length ?? "…"})
        </button>
        {agent.name === "source-monitor" && (
          <button
            onClick={loadSources}
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontWeight: 600 }}
          >
            {showSources ? "Hide" : "View"} sources ({status?.summary?.total ?? "…"})
          </button>
        )}
        <button
          onClick={loadRollup}
          style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", padding: 0 }}
        >
          {showRollup ? "Hide" : "View"} rollup blob
        </button>
      </div>

      {showHistory && history && (
        <div style={{
          marginTop: 12, maxHeight: 240, overflowY: "auto",
          background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)",
        }}>
          {history.length === 0 && (
            <div style={{ padding: 12, fontSize: 11, color: "var(--text-6)", textAlign: "center" }}>No runs yet.</div>
          )}
          {history.map((h, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
              padding: "8px 12px", borderBottom: i < history.length - 1 ? "1px solid var(--border)" : "none",
              fontSize: 11,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <StatusDot status={h} />
                <span style={{ color: "var(--text-3)" }}>{fmtRelativeTime(h.ranAt)}</span>
                <span style={{ color: "var(--text-7)" }}>·</span>
                <span style={{ color: "var(--text-5)" }}>{(h.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <div style={{ color: h.error ? "#ef4444" : "var(--text-6)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10 }}>
                {h.error ? h.error.slice(0, 80) : h.summary ? Object.entries(h.summary).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" ") : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {showRollup && rollupRaw && (
        <pre style={{
          marginTop: 12, padding: 12, fontSize: 10, lineHeight: 1.5,
          background: "rgba(0,0,0,0.30)", borderRadius: 8, color: "var(--text-3)",
          overflow: "auto", maxHeight: 400,
          fontFamily: "ui-monospace, Menlo, monospace", margin: "12px 0 0",
        }}>
          {JSON.stringify(rollupRaw, null, 2)}
        </pre>
      )}

      {showSources && sourcesData && (
        <SourceList sources={sourcesData} filter={sourceFilter} setFilter={setSourceFilter} />
      )}
    </Card>
  );
}

const HEALTH_COLOR = {
  green:   "#22c55e",
  yellow:  "#f59e0b",
  red:     "#ef4444",
  broken:  "#a855f7",
  skipped: "#6b7280",
};
const HEALTH_LABEL = {
  green:   "Running",
  yellow:  "Degraded",
  red:     "Down",
  broken:  "Needs fix",
  skipped: "No key",
};

function SourceList({ sources, filter, setFilter }) {
  const filtered = sources.filter((s) => {
    if (filter === "all") return true;
    if (filter === "running") return s.health === "green";
    if (filter === "down") return s.health === "red" || s.health === "yellow";
    if (filter === "broken") return s.health === "broken";
    if (filter === "skipped") return s.health === "skipped";
    return true;
  });
  // Sort: red → yellow → broken → skipped → green so issues bubble to the top.
  const order = { red: 0, yellow: 1, broken: 2, skipped: 3, green: 4 };
  const sorted = [...filtered].sort((a, b) => (order[a.health] ?? 9) - (order[b.health] ?? 9));

  const counts = sources.reduce((acc, s) => {
    acc[s.health] = (acc[s.health] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { key: "all",     label: `All (${sources.length})` },
          { key: "running", label: `Running (${counts.green || 0})` },
          { key: "down",    label: `Down / Degraded (${(counts.red || 0) + (counts.yellow || 0)})` },
          { key: "broken",  label: `Needs fix (${counts.broken || 0})` },
          { key: "skipped", label: `No key (${counts.skipped || 0})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: "5px 12px", borderRadius: 999,
              fontSize: 11, fontWeight: 600,
              border: "1px solid",
              borderColor: filter === tab.key ? "var(--accent)" : "var(--border)",
              background: filter === tab.key ? "var(--accent-soft)" : "var(--bg-surface2)",
              color: filter === tab.key ? "var(--accent)" : "var(--text-4)",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{
        maxHeight: 480, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {sorted.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-6)", textAlign: "center", padding: 20 }}>
            No sources match this filter.
          </div>
        )}
        {sorted.map((s) => {
          const c = HEALTH_COLOR[s.health] || "#6b7280";
          return (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 8,
              background: "var(--bg-surface2)",
              border: `1px solid ${c}22`,
              fontSize: 11,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: c,
                boxShadow: s.health === "green" ? `0 0 6px ${c}80` : "none",
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-2)" }}>{s.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 1 }}>
                  {s.category}{s.kind ? ` · ${String(s.kind).toUpperCase()}` : ""}
                  {s.httpStatus ? ` · HTTP ${s.httpStatus}` : ""}
                  {s.latencyMs != null ? ` · ${s.latencyMs}ms` : ""}
                  {s.lastIngestAt ? ` · pipeline last ran ${fmtRelativeTime(s.lastIngestAt)}` : ""}
                </div>
                {s.error && (
                  <div style={{ fontSize: 10, color: "#f87171", marginTop: 3 }}>
                    error: {s.error}
                  </div>
                )}
                {s.reason && (
                  <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 3 }}>
                    {s.reason}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                padding: "3px 8px", borderRadius: 999,
                color: c, background: `${c}1a`, border: `1px solid ${c}40`,
              }}>
                {HEALTH_LABEL[s.health]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const r = await fetch("/api/agents");
      const d = await r.json();
      setAgents(d.agents || []);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div style={{
          fontSize: 12, color: "#ef4444", padding: "10px 14px",
          background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)",
        }}>
          Failed to load agents: {error}
        </div>
      )}

      {agents === null && (
        <div style={{ fontSize: 12, color: "var(--text-5)", padding: 20 }}>Loading agents…</div>
      )}

      {agents && agents.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-5)", padding: 20, textAlign: "center" }}>
          No agents registered.
        </div>
      )}

      {agents && agents.map((a) => (
        <AgentCard key={a.name} agent={a} onRun={load} />
      ))}
    </div>
  );
}
