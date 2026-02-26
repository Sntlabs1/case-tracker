import { useMemo } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";

const PRIORITY_COLORS = { Critical: "#ef4444", High: "#f59e0b", Medium: "#3b82f6", Low: "#6b7280" };

const STATUS_DISPLAY = {
  "MDL Active":    { label: "Active MDL — Open Intake", color: "#22c55e" },
  "MDL Pending":   { label: "Pending MDL",              color: "#f59e0b" },
  "Case Filed":    { label: "Filed — In Litigation",    color: "#3b82f6" },
  "Investigation": { label: "Under Investigation",      color: "#B83E2C" },
  "Monitoring":    { label: "Monitoring",               color: "#6b7280" },
  "Settled":       { label: "Settled",                  color: "#4b5563" },
  "Dismissed":     { label: "Dismissed",                color: "#ef4444" },
};

const STATUS_PIPELINE = [
  { key: "Investigation", color: "#B83E2C", label: "Investigating" },
  { key: "Monitoring",    color: "#6b7280", label: "Monitoring" },
  { key: "Case Filed",    color: "#3b82f6", label: "Filed" },
  { key: "MDL Pending",   color: "#f59e0b", label: "MDL Pending" },
  { key: "MDL Active",    color: "#22c55e", label: "MDL Active" },
  { key: "Settled",       color: "#4b5563", label: "Settled" },
  { key: "Dismissed",     color: "#ef4444", label: "Dismissed" },
];

function HBar({ pct, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(pct, 2)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
    </div>
  );
}

function ScoreBar({ score }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : score >= 40 ? "#fb923c" : "#ef4444";
  return (
    <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 6, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
    </div>
  );
}

export default function Dashboard({ cases, setTab, setSelectedCase }) {
  const readyToFile   = cases.filter(c => c.status === "MDL Active").length;
  const inPipeline    = cases.filter(c => ["Investigation", "Case Filed", "MDL Pending"].includes(c.status)).length;
  const criticalCount = cases.filter(c => c.priority === "Critical").length;
  const avgScore      = cases.length
    ? Math.round(cases.reduce((s, c) => s + (c.score || 0), 0) / cases.length)
    : 0;

  const statusCounts = useMemo(() => {
    const map = {};
    cases.forEach(c => { map[c.status] = (map[c.status] || 0) + 1; });
    return STATUS_PIPELINE.map(s => ({ ...s, count: map[s.key] || 0 })).filter(s => s.count > 0);
  }, [cases]);
  const maxStatus = Math.max(1, ...statusCounts.map(s => s.count));

  const typeCounts = useMemo(() => {
    const map = {};
    cases.forEach(c => { if (c.caseType) map[c.caseType] = (map[c.caseType] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [cases]);
  const maxType = Math.max(1, ...typeCounts.map(([, c]) => c));

  const topCases = [...cases].sort((a, b) => b.score - a.score).slice(0, 5);

  function openCase(c) {
    setSelectedCase(c);
    setTab("cases");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {[
          {
            value: readyToFile,
            color: "#22c55e",
            label: "Ready to File Now",
            sub: "Active MDLs — you can sign plaintiffs today",
          },
          {
            value: inPipeline,
            color: "#f59e0b",
            label: "In Your Pipeline",
            sub: "Under investigation, filed, or pending MDL",
          },
          {
            value: criticalCount,
            color: "#ef4444",
            label: "Critical Alerts",
            sub: "Marked Critical priority — act on these first",
          },
          {
            value: avgScore ? `${avgScore}/100` : "—",
            color: "#C8442F",
            label: "Avg Opportunity Score",
            sub: `Across all ${cases.length} cases you are tracking`,
          },
        ].map((s, i) => (
          <Card key={i}>
            <div style={{ fontSize: 34, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 6 }}>{s.value}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Pipeline */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 2 }}>Case Pipeline</div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 18 }}>
            Where your tracked cases stand — from early investigation to settlement
          </div>
          {statusCounts.length === 0 && (
            <div style={{ fontSize: 12, color: "#555" }}>No cases tracked yet.</div>
          )}
          {statusCounts.map(s => (
            <div key={s.key} style={{ marginBottom: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e0f0" }}>
                  {s.count} {s.count === 1 ? "case" : "cases"}
                </span>
              </div>
              <HBar pct={(s.count / maxStatus) * 100} color={s.color} />
            </div>
          ))}
        </Card>

        {/* Case type breakdown */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 2 }}>By Litigation Type</div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 18 }}>
            How your pipeline breaks down across practice areas
          </div>
          {typeCounts.length === 0 && (
            <div style={{ fontSize: 12, color: "#555" }}>No cases tracked yet.</div>
          )}
          {typeCounts.map(([type, count]) => (
            <div key={type} style={{ marginBottom: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#aaa" }}>{type}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e0f0" }}>{count}</span>
              </div>
              <HBar pct={(count / maxType) * 100} color="#C8442F" />
            </div>
          ))}
        </Card>
      </div>

      {/* ── Top opportunities ──────────────────────────────────────────────── */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0" }}>Top Opportunities</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
              Your 5 highest-scored cases — click any row to open full details
            </div>
          </div>
          <Btn small onClick={() => setTab("cases")}>View All Cases</Btn>
        </div>

        {topCases.length === 0 && (
          <div style={{ color: "#555", fontSize: 12, textAlign: "center", padding: "28px 0" }}>
            No cases yet. Go to Case Tracker to add one.
          </div>
        )}

        {topCases.map((c, i) => {
          const scoreColor = c.score >= 80 ? "#22c55e" : c.score >= 60 ? "#f59e0b" : c.score >= 40 ? "#fb923c" : "#ef4444";
          const st = STATUS_DISPLAY[c.status] || { label: c.status, color: "#6b7280" };
          return (
            <div
              key={c.id}
              onClick={() => openCase(c)}
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr 160px 72px",
                gap: 16,
                alignItems: "center",
                padding: "13px 0",
                borderBottom: i < topCases.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>#{i + 1}</div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 5 }}>{c.title}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: st.color, fontWeight: 600 }}>{st.label}</span>
                  <span style={{ fontSize: 11, color: "#444" }}>·</span>
                  <span style={{ fontSize: 11, color: "#666" }}>{c.caseType}</span>
                  <span style={{ fontSize: 11, color: "#444" }}>·</span>
                  <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <ScoreBar score={c.score} />
                <div style={{ fontSize: 10, color: "#555" }}>
                  {c.affectedPop ? `${Number(c.affectedPop).toLocaleString()} people affected` : c.company || ""}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor }}>{c.score}</span>
                <span style={{ fontSize: 11, color: "#444" }}>/100</span>
              </div>
            </div>
          );
        })}
      </Card>

      {/* ── Bottom row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Score guide */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 4 }}>How Opportunity Scores Work</div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 14, lineHeight: 1.6 }}>
            Each case is scored 0–100 by comparing it against 165 historical class actions in the knowledge base —
            factoring in affected population, injury severity, government action, corporate misconduct evidence, and litigation precedent.
          </div>
          {[
            { range: "80–100", label: "Strong",     color: "#22c55e", desc: "High viability — pursue aggressively" },
            { range: "60–79",  label: "Moderate",   color: "#f59e0b", desc: "Worth investigating further" },
            { range: "40–59",  label: "Borderline", color: "#fb923c", desc: "Significant risk — proceed with caution" },
            { range: "0–39",   label: "Weak",       color: "#ef4444", desc: "Major obstacles — likely not worth pursuing" },
          ].map(s => (
            <div key={s.range} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
              <div style={{ width: 48, fontSize: 11, fontWeight: 700, color: s.color, flexShrink: 0 }}>{s.range}</div>
              <div style={{ width: 72, fontSize: 11, padding: "3px 8px", borderRadius: 999, background: s.color + "22", color: s.color, fontWeight: 600, textAlign: "center", flexShrink: 0 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{s.desc}</div>
            </div>
          ))}
        </Card>

        {/* Quick actions */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 4 }}>Where to Go Next</div>
          <div style={{ fontSize: 12, color: "#555", marginBottom: 14 }}>Jump to any tool from here</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { tab: "feed",         label: "Scan Today's Leads",       desc: "AI scans 50+ sources and scores new opportunities in real time." },
              { tab: "scanner",      label: "Analyze a Case with AI",    desc: "Paste any article or filing — Claude scores it against the KB." },
              { tab: "intelligence", label: "Browse Legal Theories",     desc: "Causes of action library with class cert viability analysis." },
              { tab: "knowledge",    label: "Study Past Class Actions",  desc: "165 historical cases — what worked, what failed, and expected payouts." },
            ].map(a => (
              <div
                key={a.tab}
                onClick={() => setTab(a.tab)}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", cursor: "pointer" }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E06050", marginBottom: 2 }}>{a.label}</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4 }}>{a.desc}</div>
              </div>
            ))}
          </div>
        </Card>

      </div>
    </div>
  );
}
