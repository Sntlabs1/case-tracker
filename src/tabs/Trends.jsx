import { useState, useEffect, useCallback } from "react";
import { Card } from "../components/UI.jsx";

// ─── COLOR HELPERS ────────────────────────────────────────────────────────────

const VELOCITY_CONFIG = {
  NEW:          { color: "#E06050", label: "NEW",          icon: "★" },
  ACCELERATING: { color: "#ef4444", label: "ACCELERATING", icon: "↑↑" },
  GROWING:      { color: "#f97316", label: "GROWING",      icon: "↑" },
  STABLE:       { color: "#6b7280", label: "STABLE",       icon: "→" },
  DECLINING:    { color: "#3b82f6", label: "DECLINING",    icon: "↓" },
  FLAT:         { color: "#374151", label: "FLAT",         icon: "—" },
};

const CASE_TYPE_COLORS = {
  "Medical Device":     "#C8442F",
  "Pharmaceutical":     "#B83E2C",
  "Auto Defect":        "#f59e0b",
  "Environmental":      "#22c55e",
  "Consumer Fraud":     "#3b82f6",
  "Data Breach":        "#ec4899",
  "Securities":         "#f97316",
  "Food Safety":        "#84cc16",
  "Financial Products": "#14b8a6",
  "Employment":         "#ef4444",
  "Antitrust":          "#06b6d4",
  "Government Liability":"#E06050",
  "Other":              "#6b7280",
};

const URGENCY_COLORS = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  MEDIUM:   "#f59e0b",
  LOW:      "#6b7280",
};

const SOURCE_COLORS = {
  Federal:  "#C8442F",
  Judicial: "#B83E2C",
  News:     "#3b82f6",
  Social:   "#22c55e",
  Medical:  "#f59e0b",
  Other:    "#6b7280",
};

// ─── CHART COMPONENTS ─────────────────────────────────────────────────────────

function BarChart({ data, height = 120, valueKey = "leads", colorKey, dateLabels = true }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  const barWidth = Math.floor(560 / data.length) - 2;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={Math.max(data.length * (barWidth + 2), 300)} height={height + 30} style={{ display: "block" }}>
        {data.map((d, i) => {
          const val = d[valueKey] || 0;
          const barH = Math.max((val / max) * height, val > 0 ? 2 : 0);
          const x = i * (barWidth + 2);
          const y = height - barH;
          const color = colorKey ? (d[colorKey] || "#C8442F") : "#C8442F";
          const isRecent = i >= data.length - 7;

          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barWidth} height={barH}
                fill={isRecent ? "#C8442F" : "#C8442F40"}
                rx={2}
              />
              {val > 0 && barH > 14 && (
                <text x={x + barWidth / 2} y={y + 10} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={600}>
                  {val}
                </text>
              )}
              {dateLabels && i % Math.ceil(data.length / 10) === 0 && (
                <text x={x + barWidth / 2} y={height + 22} textAnchor="middle" fill="#555" fontSize={9}>
                  {d.date?.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        {/* Zero line */}
        <line x1={0} y1={height} x2={data.length * (barWidth + 2)} y2={height} stroke="#333" strokeWidth={1} />
      </svg>
    </div>
  );
}

function HorizontalBars({ data, total, colorMap }) {
  const sorted = Object.entries(data)
    .map(([k, v]) => ({ label: k, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const max = sorted[0]?.value || 1;

  return (
    <div>
      {sorted.map(({ label, value }) => {
        const pct = Math.round((value / total) * 100);
        const barPct = (value / max) * 100;
        const color = colorMap?.[label] || "#C8442F";
        return (
          <div key={label} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 11 }}>
              <span style={{ color: "#c8c8e0" }}>{label}</span>
              <span style={{ color: "#888" }}>{value} ({pct}%)</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${barPct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VELOCITY BADGE ───────────────────────────────────────────────────────────

function VelocityBadge({ label }) {
  const cfg = VELOCITY_CONFIG[label] || VELOCITY_CONFIG.FLAT;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
      background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}44`,
      whiteSpace: "nowrap",
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = "#C8442F" }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "#e0e0f0", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function Trends() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeChart, setActiveChart] = useState("leads"); // leads | avgScore | clusters

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/trends");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError("");
    } catch (e) {
      if (!silent) setError("Cannot load trends. Deploy to Vercel and run at least one scan.");
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", color: "#555", padding: 80 }}>
        <div style={{ fontSize: 13 }}>Loading trend data...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: "center", color: "#555", padding: 80 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📈</div>
        <div style={{ marginBottom: 6, color: "#e0e0f0" }}>No trend data yet</div>
        <div style={{ fontSize: 12, color: "#444" }}>{error || "Run at least one scan to start building trend history."}</div>
      </div>
    );
  }

  const { scanHistory = [], hotTopics = [], dailyStats = [], caseTypeBreakdown = {}, sourceCategoryBreakdown = {}, urgencyBreakdown = {}, summary = {} } = data;

  const totalLeadsBreakdown = Object.values(caseTypeBreakdown).reduce((s, v) => s + v, 0) || 1;
  const totalSourceBreakdown = Object.values(sourceCategoryBreakdown).reduce((s, v) => s + v, 0) || 1;
  const totalUrgency = Object.values(urgencyBreakdown).reduce((s, v) => s + v, 0) || 1;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Trend Analytics</h2>
        <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
          Historical intelligence — topic velocity, lead volume, score trends, source performance across {scanHistory.length} scans
        </p>
      </div>

      {/* ── Summary stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Leads (30d)" value={summary.totalLeads} color="#C8442F" />
        <StatCard label="Avg Per Active Day" value={summary.avgLeadsPerDay} color="#B83E2C" />
        <StatCard label="Avg Viability Score" value={summary.avgScore ? `${summary.avgScore}/100` : "—"} color="#22c55e" />
        <StatCard label="Complaint Clusters" value={summary.totalClusters} color="#f59e0b" sub="pre-litigation signals" />
        <StatCard label="Hot Topics" value={hotTopics.filter(t => t.velocityLabel === "ACCELERATING" || t.velocityLabel === "NEW").length} color="#ef4444" sub="accel. or new this week" />
        <StatCard label="Peak Day" value={summary.peakDay?.leads || 0} color="#3b82f6" sub={summary.peakDay?.date || ""} />
      </div>

      {/* ── Daily volume chart ── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0" }}>Daily Lead Volume — Last 30 Days</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { key: "leads", label: "Leads scored" },
              { key: "clusters", label: "Complaint clusters" },
              { key: "avgScore", label: "Avg score" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setActiveChart(key)}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: activeChart === key ? "rgba(200,68,47,0.2)" : "rgba(255,255,255,0.04)",
                  color: activeChart === key ? "#E06050" : "#666" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {dailyStats.length > 0 ? (
          <BarChart data={dailyStats} valueKey={activeChart} height={110} />
        ) : (
          <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 12 }}>No daily data yet</div>
        )}
        <div style={{ fontSize: 10, color: "#444", marginTop: 8 }}>Darker bars = last 7 days. Hover over bars for values.</div>
      </Card>

      {/* ── Hot Topics ── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 14 }}>
          Hot Topics — Velocity Tracking
          <span style={{ fontSize: 11, color: "#666", fontWeight: 400, marginLeft: 8 }}>
            Sorted by this-week vs last-week change. Accelerating topics = early litigation signal.
          </span>
        </div>

        {hotTopics.length === 0 ? (
          <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 12 }}>No topic data yet — run a few scans to build history</div>
        ) : (
          <div>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 60px 120px", gap: 8, padding: "0 8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span>Subject</span>
              <span style={{ textAlign: "right" }}>This week</span>
              <span style={{ textAlign: "right" }}>Prior week</span>
              <span style={{ textAlign: "right" }}>All time</span>
              <span>Velocity</span>
            </div>

            {hotTopics.map((topic, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 60px 120px", gap: 8, padding: "8px", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#e0e0f0", fontWeight: 500 }}>{topic.subject}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: topic.last7 > 0 ? "#22c55e" : "#555" }}>{topic.last7}</div>
                <div style={{ textAlign: "right", fontSize: 13, color: "#888" }}>{topic.prior7}</div>
                <div style={{ textAlign: "right", fontSize: 12, color: "#666" }}>{topic.total}</div>
                <VelocityBadge label={topic.velocityLabel} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Breakdowns row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>

        {/* Case type */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 14 }}>Case Type Breakdown</div>
          {totalLeadsBreakdown > 1 ? (
            <HorizontalBars data={caseTypeBreakdown} total={totalLeadsBreakdown} colorMap={CASE_TYPE_COLORS} />
          ) : (
            <div style={{ color: "#444", fontSize: 12, textAlign: "center", padding: 20 }}>No data yet</div>
          )}
        </Card>

        {/* Source category */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 14 }}>Lead Source Breakdown</div>
          {totalSourceBreakdown > 1 ? (
            <HorizontalBars data={sourceCategoryBreakdown} total={totalSourceBreakdown} colorMap={SOURCE_COLORS} />
          ) : (
            <div style={{ color: "#444", fontSize: 12, textAlign: "center", padding: 20 }}>No data yet</div>
          )}
        </Card>

        {/* Urgency */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 14 }}>Urgency Distribution</div>
          {totalUrgency > 1 ? (
            <HorizontalBars data={urgencyBreakdown} total={totalUrgency} colorMap={URGENCY_COLORS} />
          ) : (
            <div style={{ color: "#444", fontSize: 12, textAlign: "center", padding: 20 }}>No data yet</div>
          )}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {Object.entries(urgencyBreakdown).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: URGENCY_COLORS[k] || "#888" }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: URGENCY_COLORS[k] || "#888" }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Scan history log ── */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 14 }}>
          Scan History — Last {Math.min(scanHistory.length, 30)} Scans
        </div>

        {scanHistory.length === 0 ? (
          <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 12 }}>No scan history yet</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Timestamp", "Sources", "Fetched", "New", "Triage Pass", "Leads Scored", "Clusters", "Avg Score", "Top Lead"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scanHistory.slice(0, 30).map((scan, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "7px 8px", color: "#888", whiteSpace: "nowrap" }}>
                      {scan.timestamp ? new Date(scan.timestamp).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "7px 8px", color: "#c8c8e0", textAlign: "right" }}>{scan.sourcesQueried ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: "#c8c8e0", textAlign: "right" }}>{scan.processed ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: "#c8c8e0", textAlign: "right" }}>{scan.newItems ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: "#f59e0b", textAlign: "right" }}>{scan.passedTriage ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: "#22c55e", fontWeight: 700, textAlign: "right" }}>{scan.scored ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: "#E06050", textAlign: "right" }}>{scan.complaintClusters ?? "—"}</td>
                    <td style={{ padding: "7px 8px", color: scan.avgScore >= 75 ? "#22c55e" : scan.avgScore >= 55 ? "#f59e0b" : "#888", textAlign: "right" }}>
                      {scan.avgScore ? `${scan.avgScore}/100` : "—"}
                    </td>
                    <td style={{ padding: "7px 8px", color: "#888", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {scan.topLead || "—"}
                      {scan.topScore && <span style={{ color: "#C8442F", marginLeft: 6 }}>({scan.topScore})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
