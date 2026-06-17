import React, { useEffect, useState, useMemo } from "react";

// Opportunities — discover, visualize, and track credit-defendant opportunities.
// Merges the systemic-violation report set (public/svr/index.json: cohort +
// dispute signals) with the live litigation/settlement status from
// /api/portfolio-cases, scores each, plots them against open dockets, and lets
// you track the open-but-unsettled ones via /api/watchlist.

const STAGE = {
  claim_window:        { label: "Settled — claimable",   color: "#22c55e", group: "settled" },
  automatic_payment:   { label: "Settled — automatic",   color: "#16a34a", group: "settled" },
  joinable_litigation: { label: "Open — no settlement",  color: "#2D7D95", group: "open" },
  monitor_only:        { label: "Monitor only",          color: "#f59e0b", group: "monitor" },
  none:                { label: "No live path",           color: "#6b7280", group: "dead" },
  unknown:             { label: "Unknown",                color: "#6b7280", group: "dead" },
};
const stageOf = (s) => STAGE[s] || STAGE.unknown;
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");

// Opportunity score (0–100): cohort 35 + dispute signal 30 + active litigation 25
// + timeliness 10. Transparent and component-weighted; shown on the row.
function score(o) {
  const cohort = Math.min(1, (o.consumers || 0) / 400000);
  const signal = (o.disputedPct || 0) / 100;
  const litig  = Math.min(1, (o.openCases || 0) / 250);
  const timely = Math.min(1, (o.live || 0) / 40000);
  return Math.round(35 * cohort + 30 * signal + 25 * litig + 10 * timely);
}

export default function Opportunities() {
  const [svr, setSvr] = useState(null);
  const [pacer, setPacer] = useState(null);
  const [watch, setWatch] = useState([]);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("board"); // board | tracked
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState(null); // token in detail

  const loadWatch = () =>
    fetch("/api/watchlist").then((r) => r.json()).then((d) => setWatch(d.items || [])).catch(() => {});

  useEffect(() => {
    Promise.all([
      fetch("/svr/index.json").then((r) => r.json()),
      fetch("/api/portfolio-cases").then((r) => r.json()),
    ])
      .then(([s, p]) => { setSvr(s.reports || []); setPacer(p); })
      .catch((e) => setErr(e.message));
    loadWatch();
  }, []);

  // Merge: each report (cohort+signals) enriched with live status from pacer.
  const opps = useMemo(() => {
    if (!svr || !pacer) return null;
    const map = {};
    const add = (arr) => (arr || []).forEach((d) => {
      const t = d.defendantQ || d.token;
      if (t && !map[t]) map[t] = d;
    });
    add(pacer.defendants); add(pacer.nationalEntities); add(pacer.openSettlements);
    return svr.map((r) => {
      const p = map[r.token] || {};
      const status = p.claimPath?.status || (p.classSettlement ? "claim_window" : "unknown");
      const o = {
        token: r.token, name: r.name, file: r.file,
        consumers: r.consumers, disputedPct: r.disputedPct,
        disputedOwing: r.disputedOwing, live: r.live,
        dockets: r.dockets, openCases: p.openCases || 0,
        caseCount: p.caseCount || r.dockets || 0, status,
        settled: stageOf(status).group === "settled",
      };
      o.score = score(o);
      return o;
    }).sort((a, b) => b.score - a.score);
  }, [svr, pacer]);

  if (err) return <div style={{ padding: 40, color: "#ef4444" }}>Error: {err}</div>;
  if (!opps) return <div style={{ padding: 40, color: "var(--text-4)" }}>Loading opportunities…</div>;

  const watchSet = new Set(watch.map((w) => w.token));
  const filtered = stageFilter === "all" ? opps : opps.filter((o) => stageOf(o.status).group === stageFilter);
  const sel = selected ? opps.find((o) => o.token === selected) : null;

  async function track(o) {
    await fetch("/api/watchlist", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: o.token, name: o.name, stage: "monitoring",
        snapshot: { status: o.status, openCases: o.openCases, consumers: o.consumers, settled: o.settled },
      }),
    });
    loadWatch();
  }
  async function untrack(token) {
    await fetch(`/api/watchlist?token=${encodeURIComponent(token)}`, { method: "DELETE" });
    loadWatch();
  }
  async function setStage(token, stage) {
    const w = watch.find((x) => x.token === token);
    await fetch("/api/watchlist", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...w, token, stage }),
    });
    loadWatch();
  }

  const StageBadge = ({ status }) => {
    const m = stageOf(status);
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}55`, whiteSpace: "nowrap" }}>{m.label}</span>;
  };

  return (
    <div style={{ padding: "8px 2px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, color: "var(--text-1)", fontSize: 20 }}>Opportunities</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {["board", "tracked"].map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6,
              border: "1px solid var(--border)", cursor: "pointer",
              background: view === v ? "#2D7D95" : "var(--bg-surface)", color: view === v ? "#fff" : "var(--text-1)" }}>
              {v === "board" ? "Discover" : `Tracked (${watch.length})`}
            </button>
          ))}
        </div>
      </div>

      {view === "board" && (
        <>
          <Scatter opps={filtered} onPick={setSelected} />
          <div style={{ display: "flex", gap: 6, margin: "16px 0 10px", flexWrap: "wrap" }}>
            {["all", "open", "settled", "monitor", "dead"].map((g) => (
              <button key={g} onClick={() => setStageFilter(g)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4,
                border: "1px solid var(--border)", cursor: "pointer",
                background: stageFilter === g ? "#2D7D95" : "var(--bg-surface)", color: "var(--text-1)" }}>
                {g === "all" ? "All" : g === "open" ? "Open — no settlement" : g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
            <span style={{ fontSize: 11, color: "var(--text-5)", alignSelf: "center", marginLeft: 6 }}>
              {filtered.length} defendants · sorted by opportunity score
            </span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <thead><tr style={{ color: "var(--text-5)", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <th style={th}>Defendant</th><th style={th}>Stage</th>
              <th style={thR}>Score</th><th style={thR}>Cohort</th><th style={thR}>Disputed</th>
              <th style={thR}>Open dockets</th><th style={thR}></th>
            </tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.token} onClick={() => setSelected(o.token)} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-1)" }}>{o.name}</td>
                  <td style={td}><StageBadge status={o.status} /></td>
                  <td style={tdR}><b style={{ color: o.score >= 60 ? "#22c55e" : o.score >= 40 ? "#f59e0b" : "var(--text-3)" }}>{o.score}</b></td>
                  <td style={tdR}>{fmt(o.consumers)}</td>
                  <td style={tdR}>{o.disputedPct}%</td>
                  <td style={tdR}>{fmt(o.openCases)}</td>
                  <td style={tdR} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => watchSet.has(o.token) ? untrack(o.token) : track(o)}
                      style={{ fontSize: 10, padding: "3px 9px", borderRadius: 4, cursor: "pointer",
                        border: `1px solid ${watchSet.has(o.token) ? "#22c55e" : "var(--border)"}`,
                        background: watchSet.has(o.token) ? "#22c55e22" : "var(--bg-surface)",
                        color: watchSet.has(o.token) ? "#15803d" : "var(--text-2)" }}>
                      {watchSet.has(o.token) ? "✓ Tracked" : "+ Track"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {view === "tracked" && (
        <TrackedView watch={watch} opps={opps} StageBadge={StageBadge} onStage={setStage} onRemove={untrack} onOpen={(t) => { setView("board"); setSelected(t); }} />
      )}

      {sel && <Detail o={sel} tracked={watchSet.has(sel.token)} onClose={() => setSelected(null)} onTrack={() => track(sel)} onUntrack={() => untrack(sel.token)} StageBadge={StageBadge} />}
    </div>
  );
}

// ── Scatter: open dockets (x) vs cohort (y), colored by stage, sized by owing ──
function Scatter({ opps, onPick }) {
  const W = 760, H = 300, PAD = 46;
  const maxX = Math.max(10, ...opps.map((o) => o.openCases));
  const maxY = Math.max(10, ...opps.map((o) => o.consumers));
  const x = (v) => PAD + (v / maxX) * (W - PAD - 16);
  const y = (v) => H - PAD - (v / maxY) * (H - PAD - 16);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 4 }}>
        Cohort size vs. open dockets — top-right = large class, actively litigated. Dot size = disputed &amp; still owing. Click to inspect.
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        <line x1={PAD} y1={H - PAD} x2={W - 8} y2={H - PAD} stroke="var(--border)" />
        <line x1={PAD} y1={8} x2={PAD} y2={H - PAD} stroke="var(--border)" />
        <text x={(W + PAD) / 2} y={H - 8} fontSize="10" fill="var(--text-5)" textAnchor="middle">Open dockets →</text>
        <text x={14} y={H / 2} fontSize="10" fill="var(--text-5)" textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>Consumers in data →</text>
        {opps.map((o) => {
          const m = stageOf(o.status);
          const r = 4 + Math.min(10, (o.disputedOwing || 0) / 130000);
          return (
            <circle key={o.token} cx={x(o.openCases)} cy={y(o.consumers)} r={r}
              fill={`${m.color}cc`} stroke={m.color} strokeWidth="1"
              style={{ cursor: "pointer" }} onClick={() => onPick(o.token)}>
              <title>{`${o.name}\n${fmt(o.consumers)} consumers · ${o.disputedPct}% disputed · ${fmt(o.openCases)} open dockets\n${m.label}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

// ── Detail drawer: the litigation landscape for one opportunity ──
function Detail({ o, tracked, onClose, onTrack, onUntrack, StageBadge }) {
  const stat = (label, val) => (
    <div style={{ flex: 1 }}><div style={{ fontSize: 19, fontWeight: 800, color: "var(--text-1)" }}>{val}</div>
      <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div></div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", height: "100%", background: "var(--bg-drawer, #1c1c1c)", borderLeft: "1px solid var(--border)", padding: 24, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <h3 style={{ margin: 0, color: "var(--text-1)", fontSize: 18 }}>{o.name}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-4)", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ margin: "8px 0 16px" }}><StageBadge status={o.status} /> <span style={{ fontSize: 12, color: "var(--text-5)", marginLeft: 8 }}>Opportunity score {o.score}</span></div>

        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>{stat("Consumers", fmt(o.consumers))}{stat("Disputed", `${o.disputedPct}%`)}{stat("Live", fmt(o.live))}</div>
        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>{stat("Open dockets", fmt(o.openCases))}{stat("Total dockets", fmt(o.caseCount))}{stat("Disputed owing", fmt(o.disputedOwing))}</div>

        <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          {o.settled
            ? "A settlement exists for this defendant — the action here is filing claims for the cohort."
            : stageOf(o.status).group === "open"
              ? "Open dockets, no settlement yet — a candidate to join or lead. Track it to be alerted if a settlement appears."
              : "No live recovery path detected — monitor only."}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <a href={`/svr/${o.file}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: "center", fontSize: 12, padding: "9px 0", borderRadius: 6, background: "#2D7D95", color: "#fff", textDecoration: "none" }}>View violation report ↗</a>
          <button onClick={tracked ? onUntrack : onTrack} style={{ flex: 1, fontSize: 12, padding: "9px 0", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${tracked ? "#22c55e" : "var(--border)"}`, background: tracked ? "#22c55e22" : "var(--bg-surface)", color: tracked ? "#15803d" : "var(--text-1)" }}>
            {tracked ? "✓ Tracked" : "+ Track this"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tracked view: watchlist with change-flags vs the snapshot at add time ──
function TrackedView({ watch, opps, StageBadge, onStage, onRemove, onOpen }) {
  if (!watch.length)
    return <div style={{ padding: 40, color: "var(--text-5)", textAlign: "center" }}>
      Nothing tracked yet. In Discover, click <b>+ Track</b> on an open-but-unsettled opportunity to monitor it here.</div>;
  const STAGES = ["identified", "monitoring", "filed", "settled"];
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 10 }}>
        Tracked opportunities. Changes since you added them are flagged — most importantly when an open case gains a settlement.
      </div>
      {watch.map((w) => {
        const cur = opps.find((o) => o.token === w.token);
        const snap = w.snapshot || {};
        const flags = [];
        if (cur) {
          if (cur.settled && !snap.settled) flags.push({ t: "Settlement now available", c: "#22c55e" });
          if (typeof snap.openCases === "number" && cur.openCases !== snap.openCases)
            flags.push({ t: `Open dockets ${cur.openCases > snap.openCases ? "+" : ""}${cur.openCases - snap.openCases}`, c: "#2D7D95" });
          if (snap.status && cur.status !== snap.status) flags.push({ t: "Stage changed", c: "#f59e0b" });
        }
        return (
          <div key={w.token} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <button onClick={() => onOpen(w.token)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-1)", fontWeight: 700, fontSize: 14 }}>{w.name}</button>
                <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {cur && <StageBadge status={cur.status} />}
                  {cur && <span style={{ fontSize: 11, color: "var(--text-5)" }}>{fmt(cur.consumers)} consumers · {fmt(cur.openCases)} open dockets</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <select value={w.stage || "monitoring"} onChange={(e) => onStage(w.token, e.target.value)}
                  style={{ fontSize: 11, padding: "4px 6px", borderRadius: 4, background: "var(--bg-surface)", color: "var(--text-1)", border: "1px solid var(--border)" }}>
                  {STAGES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
                <button onClick={() => onRemove(w.token)} style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>Remove</button>
              </div>
            </div>
            {flags.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {flags.map((f, i) => <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: `${f.c}22`, color: f.c, border: `1px solid ${f.c}55` }}>⚑ {f.t}</span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const th  = { textAlign: "left",  padding: "9px 12px", fontWeight: 700 };
const thR = { textAlign: "right", padding: "9px 12px", fontWeight: 700 };
const td  = { padding: "9px 12px", verticalAlign: "middle" };
const tdR = { padding: "9px 12px", textAlign: "right", verticalAlign: "middle", color: "var(--text-3)" };
