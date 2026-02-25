import { Card, Badge, ScoreBar } from "../components/UI.jsx";
import { STATUSES, CASE_TYPES, PRIORITY_COLORS, STATUS_COLORS } from "../data/sources.js";

export default function Dashboard({ cases, setTab, setSelectedCase }) {
  const stats = {
    total: cases.length,
    critical: cases.filter(c => c.priority === "Critical").length,
    active: cases.filter(c => ["MDL Active", "Case Filed", "MDL Pending"].includes(c.status)).length,
    avgScore: cases.length ? Math.round(cases.reduce((s, c) => s + c.score, 0) / cases.length) : 0
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Cases", val: stats.total, color: "#6366f1", icon: "📋" },
          { label: "Critical Priority", val: stats.critical, color: "#ef4444", icon: "🔴" },
          { label: "Active Litigation", val: stats.active, color: "#22c55e", icon: "⚡" },
          { label: "Avg Viability Score", val: stats.avgScore, color: "#f59e0b", icon: "📈" },
        ].map((s, i) => (
          <Card key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.val}</div>
              </div>
              <span style={{ fontSize: 24 }}>{s.icon}</span>
            </div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#c4b5fd" }}>Top Cases by Viability</h3>
          {[...cases].sort((a, b) => b.score - a.score).slice(0, 5).map(c => (
            <div key={c.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#e0e0f0" }} onClick={() => { setSelectedCase(c); setTab("cases"); }}>{c.title}</span>
                <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
              </div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{c.company} · {c.affectedPop}</div>
              <ScoreBar score={c.score} />
            </div>
          ))}
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#c4b5fd" }}>Case Pipeline</h3>
          {STATUSES.map(s => {
            const count = cases.filter(c => c.status === s).length;
            const pct = cases.length ? (count / cases.length) * 100 : 0;
            return (
              <div key={s} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: STATUS_COLORS[s] }}>{s}</span>
                  <span style={{ color: "#888" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: STATUS_COLORS[s], borderRadius: 2, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 16 }}>
            <h4 style={{ fontSize: 13, color: "#a0a0b8", margin: "0 0 8px" }}>By Case Type</h4>
            {CASE_TYPES.filter(t => cases.some(c => c.caseType === t)).map(t => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", padding: "3px 0" }}>
                <span>{t}</span>
                <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{cases.filter(c => c.caseType === t).length}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
