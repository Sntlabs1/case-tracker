import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, Btn } from "../components/UI.jsx";

// ── Color helpers ─────────────────────────────────────────────────────────────
function scoreColor(s) {
  return s >= 80 ? "#22c55e" : s >= 60 ? "#f59e0b" : s >= 40 ? "#fb923c" : "#ef4444";
}

function urgencyColor(u) {
  if (!u) return "#6b7280";
  const up = u.toUpperCase();
  return up === "CRITICAL" ? "#ef4444" : up === "HIGH" ? "#f59e0b" : up === "MEDIUM" ? "#3b82f6" : "#6b7280";
}

const STATUS_DISPLAY = {
  "MDL Active":    { label: "MDL Active",   color: "#22c55e" },
  "MDL Pending":   { label: "MDL Pending",  color: "#f59e0b" },
  "Case Filed":    { label: "Filed",        color: "#3b82f6" },
  "Investigation": { label: "Investigating",color: "#B83E2C" },
  "Monitoring":    { label: "Monitoring",   color: "#6b7280" },
  "Settled":       { label: "Settled",      color: "#4b5563" },
  "Dismissed":     { label: "Dismissed",    color: "#ef4444" },
};

const STATUS_PIPELINE = [
  { key: "Investigation", color: "#B83E2C", label: "Investigating" },
  { key: "Monitoring",    color: "#6b7280", label: "Monitoring"    },
  { key: "Case Filed",    color: "#3b82f6", label: "Filed"         },
  { key: "MDL Pending",   color: "#f59e0b", label: "MDL Pending"   },
  { key: "MDL Active",    color: "#22c55e", label: "MDL Active"    },
  { key: "Settled",       color: "#4b5563", label: "Settled"       },
  { key: "Dismissed",     color: "#ef4444", label: "Dismissed"     },
];

function sourceMeta(source) {
  if (!source) return { label: "Unknown", color: "#666" };
  const s = source.toLowerCase();
  if (s.includes("faers"))                        return { label: "FDA FAERS",    color: "#ef4444" };
  if (s.includes("fda"))                          return { label: "FDA",          color: "#ef4444" };
  if (s.includes("reddit"))                       return { label: "Reddit",       color: "#f97316" };
  if (s.includes("courtlistener"))                return { label: "CourtListener",color: "#3b82f6" };
  if (s.includes("sec") || s.includes("edgar"))   return { label: "SEC EDGAR",    color: "#8b5cf6" };
  if (s.includes("nhtsa"))                        return { label: "NHTSA",        color: "#06b6d4" };
  if (s.includes("cfpb"))                         return { label: "CFPB",         color: "#10b981" };
  if (s.includes("pubmed"))                       return { label: "PubMed",       color: "#6366f1" };
  if (s.includes("claude") || s.includes("web search")) return { label: "AI Search", color: "#9090c0" };
  if (s.includes("google"))                       return { label: "Google News",  color: "#4285f4" };
  if (s.includes("twitter") || s.includes("x.com")) return { label: "Twitter/X", color: "#1da1f2" };
  return { label: source.slice(0, 18), color: "#888" };
}

function timeAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Skeleton({ height = 54 }) {
  return (
    <div style={{
      height, borderRadius: 8,
      background: "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)",
    }} />
  );
}

function StatCard({ value, label, sub, color, onClick, badge }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? "#1a1b24" : "#131418",
        borderRadius: 10,
        border: `1px solid ${hov ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.07)"}`,
        padding: "20px",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 4 }}>
        {label}
        {badge && (
          <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 7px", borderRadius: 999, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", fontWeight: 600 }}>{badge}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>
        {sub}
        {onClick && <span style={{ color: "#C8442F", marginLeft: 4 }}>→</span>}
      </div>
    </div>
  );
}

function LeadRow({ lead, onClick }) {
  const [hov, setHov] = useState(false);
  const a = lead.analysis || {};
  const score = a.score || 0;
  const sc = scoreColor(score);
  const src = sourceMeta(lead.source);
  const headline = a.headline || lead.title || "";
  const defendant = a.defendantProfile?.name;
  const urgency = a.timeline?.urgencyLevel || a.urgencyLevel;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "11px 12px", borderRadius: 8,
        background: hov ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"}`,
        cursor: "pointer", transition: "all 0.13s",
      }}
    >
      {/* Score ring */}
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        background: `${sc}15`, border: `2px solid ${sc}40`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: sc }}>{score}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 4,
            background: `${src.color}18`, color: src.color,
            border: `1px solid ${src.color}33`, fontWeight: 600, flexShrink: 0,
          }}>{src.label}</span>
          {a.caseType && <span style={{ fontSize: 10, color: "#666" }}>{a.caseType}</span>}
          {urgency && urgency.toUpperCase() !== "LOW" && (
            <span style={{ fontSize: 10, fontWeight: 700, color: urgencyColor(urgency) }}>{urgency.toUpperCase()}</span>
          )}
        </div>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "#d8d8f0", lineHeight: 1.35,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {headline.slice(0, 100)}{headline.length > 100 ? "…" : ""}
        </div>
        {defendant && (
          <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>vs. {defendant}</div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#444", flexShrink: 0, paddingTop: 2 }}>
        {timeAgo(lead.pubDate)}
      </div>
    </div>
  );
}

function OpportunityRow({ opp, onClick }) {
  const [hov, setHov] = useState(false);
  const sc = scoreColor(opp.combinedScore || 0);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "11px 12px", borderRadius: 8,
        background: hov ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"}`,
        cursor: "pointer", transition: "all 0.13s",
      }}
    >
      {/* Rank + score column */}
      <div style={{ flexShrink: 0, textAlign: "center", width: 42 }}>
        <div style={{ fontSize: 9, color: "#555", fontWeight: 700 }}>#{opp.rank}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: sc, lineHeight: 1.1 }}>{opp.combinedScore}</div>
        {opp.kbReplicationGrade && opp.kbReplicationGrade !== "Unknown" && (
          <div style={{ fontSize: 10, fontWeight: 700, color: opp.kbReplicationGrade <= "B" ? "#22c55e" : "#f59e0b" }}>
            {opp.kbReplicationGrade}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
          {opp.urgencyLevel && opp.urgencyLevel.toUpperCase() !== "LOW" && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
              background: `${urgencyColor(opp.urgencyLevel)}18`,
              color: urgencyColor(opp.urgencyLevel),
              border: `1px solid ${urgencyColor(opp.urgencyLevel)}33`,
            }}>{opp.urgencyLevel}</span>
          )}
          {opp.firstMoverAdvantage && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
              FIRST MOVER
            </span>
          )}
          {opp.signalCount > 1 && (
            <span style={{ fontSize: 10, color: "#555" }}>{opp.signalCount} signals</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 3, lineHeight: 1.3 }}>
          {opp.opportunityName}
        </div>
        {(opp.estimatedFund && opp.estimatedFund !== "Unknown") && (
          <div style={{ fontSize: 11, color: "#888" }}>
            Fund: <span style={{ color: "#E06050", fontWeight: 600 }}>{opp.estimatedFund}</span>
            {opp.estimatedFeeToFirm && opp.estimatedFeeToFirm !== "Unknown" && (
              <> · Fee: <span style={{ color: "#22c55e", fontWeight: 600 }}>{opp.estimatedFeeToFirm}</span></>
            )}
          </div>
        )}
        {opp.whyPursue?.[0] && (
          <div style={{ fontSize: 11, color: "#777", marginTop: 3 }}>• {opp.whyPursue[0]}</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#555", flexShrink: 0, paddingTop: 2 }}>
        {opp.probabilityOfSuccess ? `${opp.probabilityOfSuccess}% P(win)` : ""}
      </div>
    </div>
  );
}

function PipelineRow({ label, color, count, maxCount, onClick }) {
  const [hov, setHov] = useState(false);
  const pct = Math.max((count / maxCount) * 100, 3);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        marginBottom: 10, cursor: "pointer",
        padding: "5px 8px", borderRadius: 6,
        background: hov ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 0.13s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: hov ? "#e0e0f0" : color }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e0f0" }}>
          {count} {count === 1 ? "case" : "cases"}
        </span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 7, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function CaseRow({ c, rank, onClick }) {
  const [hov, setHov] = useState(false);
  const sc = scoreColor(c.score || 0);
  const st = STATUS_DISPLAY[c.status] || { label: c.status, color: "#6b7280" };

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "center",
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer",
        background: hov ? "rgba(255,255,255,0.03)" : "transparent",
        borderRadius: 6,
        transition: "background 0.13s",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#333", width: 22, textAlign: "center", flexShrink: 0 }}>#{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "#e0e0f0", marginBottom: 3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {c.title}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: st.color, fontWeight: 600 }}>{st.label}</span>
          {c.caseType && <span style={{ fontSize: 10, color: "#555" }}>{c.caseType}</span>}
          {c.company && <span style={{ fontSize: 10, color: "#444" }}>{c.company}</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: sc }}>{c.score}</span>
        <span style={{ fontSize: 10, color: "#444" }}>/100</span>
      </div>
    </div>
  );
}

function QuickAction({ label, desc, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: 18, borderRadius: 10,
        background: hov ? "#1a1b24" : "#131418",
        border: `1px solid ${hov ? "rgba(200,68,47,0.35)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#E06050", marginBottom: 6 }}>{label} →</div>
      <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ cases, setTab, setSelectedCase, setCaseFilter }) {
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [opportunities, setOpportunities] = useState([]);
  const [oppsLoading, setOppsLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const kvTotalRef = useRef(null);

  const fetchData = useCallback((silent = false) => {
    if (!silent) { setLeadsLoading(true); setOppsLoading(true); }
    // Fetch only top 5 leads for dashboard display (not all 987)
    fetch("/api/leads?limit=5")
      .then(r => r.json())
      .then(d => {
        const all = d.leads || [];
        setLeads(all);
        setTotalLeads(d.total || all.length);
        const dates = all.map(l => l.scannedAt || l.pubDate).filter(Boolean).sort().reverse();
        if (dates[0]) setLastScanTime(dates[0]);
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLeadsLoading(false); });

    fetch("/api/leads?stats=1")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        if (d?.lastScan?.timestamp) setLastScanTime(d.lastScan.timestamp);
        // If new leads arrived since last poll, refresh fully
        if (kvTotalRef.current !== null && d.total > kvTotalRef.current) {
          fetchData(true);
        }
        kvTotalRef.current = d.total ?? kvTotalRef.current;
      })
      .catch(() => {});

    fetch("/api/opportunities")
      .then(r => r.json())
      .then(d => {
        setOpportunities((d.opportunities || []).slice(0, 4));
        if (d.generatedAt) setLastScanTime(prev => prev || d.generatedAt);
      })
      .catch(() => {})
      .finally(() => { if (!silent) setOppsLoading(false); });

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(true), 300000); // 5 min — was 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const highPriorityLeads = leads.filter(l => (l.analysis?.score || 0) >= 70);
  const activeMDLs    = cases.filter(c => c.status === "MDL Active").length;
  const criticalCases = cases.filter(c => c.priority === "Critical").length;
  const inPipeline    = cases.filter(c => ["Investigation", "Case Filed", "MDL Pending"].includes(c.status)).length;

  const statusCounts = useMemo(() => {
    const map = {};
    cases.forEach(c => { map[c.status] = (map[c.status] || 0) + 1; });
    return STATUS_PIPELINE.map(s => ({ ...s, count: map[s.key] || 0 })).filter(s => s.count > 0);
  }, [cases]);
  const maxStatus = Math.max(1, ...statusCounts.map(s => s.count));

  const typeCounts = useMemo(() => {
    const map = {};
    cases.forEach(c => { if (c.caseType) map[c.caseType] = (map[c.caseType] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [cases]);
  const maxType = Math.max(1, ...typeCounts.map(([, c]) => c));

  const topCases = [...cases].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);

  function goTo(tab, filter) {
    if (filter && setCaseFilter) setCaseFilter(filter);
    setTab(tab);
  }

  function openCase(c) {
    setSelectedCase(c);
    setTab("cases");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Live indicator ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginBottom: -12 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
        <span style={{ fontSize: 11, color: "#555" }}>
          LIVE · refreshed {lastRefreshed ? lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"}
        </span>
      </div>

      {/* ── Alert banner — only shown when high-priority leads exist ── */}
      {!leadsLoading && highPriorityLeads.length > 0 && (
        <div
          onClick={() => setTab("leads")}
          style={{
            padding: "12px 20px", borderRadius: 10,
            background: "rgba(200,68,47,0.1)", border: "1px solid rgba(200,68,47,0.35)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0, boxShadow: "0 0 8px #ef4444" }} />
            <span style={{ fontWeight: 700, color: "#fff", fontSize: 13 }}>
              {highPriorityLeads.length} high-priority lead{highPriorityLeads.length > 1 ? "s" : ""} detected (score ≥ 70)
            </span>
            <span style={{ color: "#888", fontSize: 12 }}>
              — {(highPriorityLeads[0]?.analysis?.headline || highPriorityLeads[0]?.title || "").slice(0, 70)}
            </span>
          </div>
          <span style={{ fontSize: 12, color: "#C8442F", fontWeight: 600, flexShrink: 0 }}>View in Leads Inbox →</span>
        </div>
      )}

      {/* ── 4 stat cards — all clickable ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <StatCard
          value={leadsLoading ? "…" : (totalLeads ?? leads.length)}
          color="#C8442F"
          label="Intelligence Leads"
          sub="Scored and ranked from 50+ live sources"
          onClick={() => setTab("leads")}
          badge={highPriorityLeads.length > 0 ? `${highPriorityLeads.length} high priority` : null}
        />
        <StatCard
          value={activeMDLs || cases.length}
          color="#22c55e"
          label={activeMDLs ? "Active MDLs" : "Cases Tracked"}
          sub={activeMDLs ? "Open intake — you can sign plaintiffs today" : "In your case pipeline"}
          onClick={() => goTo("cases", activeMDLs ? { status: "MDL Active" } : null)}
        />
        <StatCard
          value={criticalCases || inPipeline || "—"}
          color={criticalCases ? "#ef4444" : "#f59e0b"}
          label={criticalCases ? "Critical Alerts" : "In Pipeline"}
          sub={criticalCases ? "Require immediate attention" : "Investigation, filed, or pending MDL"}
          onClick={() => goTo("cases", criticalCases ? { priority: "Critical" } : null)}
        />
        <StatCard
          value={lastScanTime ? timeAgo(lastScanTime) : (leadsLoading ? "…" : "No scans")}
          color="#9090c0"
          label="Last Scan"
          sub={totalLeads ? `${totalLeads} total leads in database` : "Scanner runs every hour automatically"}
          onClick={() => setTab("leads")}
        />
      </div>

      {/* ── Live intelligence + top opportunities ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Live intelligence from scanner */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0" }}>Live Intelligence</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Top leads by score — click any row to view full report</div>
            </div>
            <Btn small onClick={() => setTab("leads")}>All Leads →</Btn>
          </div>
          {leadsLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1, 2, 3].map(i => <Skeleton key={i} />)}
            </div>
          ) : leads.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#444", fontSize: 12 }}>
              No leads yet — run a scan to populate.<br /><br />
              <Btn small onClick={() => setTab("leads")}>Open Leads Inbox</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {leads.map(lead => <LeadRow key={lead.id} lead={lead} onClick={() => setTab("leads")} />)}
            </div>
          )}
        </Card>

        {/* AI-synthesized opportunities */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0" }}>Top Case Opportunities</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>AI-synthesized across all leads — click to expand in Leads Inbox</div>
            </div>
            <Btn small onClick={() => setTab("leads")}>All Opps →</Btn>
          </div>
          {oppsLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1, 2, 3].map(i => <Skeleton key={i} height={72} />)}
            </div>
          ) : opportunities.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#444", fontSize: 12 }}>
              No opportunities synthesized yet.<br /><br />
              <Btn small onClick={() => setTab("leads")}>Open Leads Inbox</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {opportunities.map((opp, i) => <OpportunityRow key={i} opp={opp} onClick={() => setTab("leads")} />)}
            </div>
          )}
        </Card>
      </div>

      {/* ── Case pipeline + your top tracked cases ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Pipeline — bars, fully clickable */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0", marginBottom: 2 }}>Your Case Pipeline</div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>Click any stage to filter your cases</div>

          {statusCounts.length === 0 ? (
            <div style={{ fontSize: 12, color: "#555", textAlign: "center", padding: "16px 0" }}>
              No cases tracked yet —{" "}
              <span onClick={() => setTab("cases")} style={{ color: "#C8442F", cursor: "pointer" }}>add one</span>
            </div>
          ) : (
            statusCounts.map(s => (
              <PipelineRow
                key={s.key} label={s.label} color={s.color}
                count={s.count} maxCount={maxStatus}
                onClick={() => goTo("cases", { status: s.key })}
              />
            ))
          )}

          {typeCounts.length > 0 && (
            <>
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "14px 0" }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: "#444", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                By Practice Area
              </div>
              {typeCounts.map(([type, count]) => (
                <PipelineRow
                  key={type} label={type} color="#C8442F"
                  count={count} maxCount={maxType}
                  onClick={() => goTo("cases", { caseType: type })}
                />
              ))}
            </>
          )}
        </Card>

        {/* Top tracked cases */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0" }}>Your Top Cases</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Ranked by opportunity score — click any case to open it</div>
            </div>
            <Btn small onClick={() => setTab("cases")}>All Cases →</Btn>
          </div>
          {topCases.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#444", fontSize: 12 }}>
              No cases yet —{" "}
              <span onClick={() => setTab("cases")} style={{ color: "#C8442F", cursor: "pointer" }}>add a case</span>
            </div>
          ) : (
            topCases.map((c, i) => (
              <CaseRow key={c.id} c={c} rank={i + 1} onClick={() => openCase(c)} />
            ))
          )}
        </Card>
      </div>

      {/* ── Quick action grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "Leads Inbox",    desc: "Browse all AI-generated leads from 50+ live sources, scored 0–100",             tab: "leads"      },
          { label: "AI Scanner",     desc: "Paste any article or filing — Claude scores it against 165 historical cases",   tab: "scanner"    },
          { label: "Knowledge Base", desc: "Study what worked in 165 historical class actions — payouts, strategies, risks", tab: "knowledge"  },
          { label: "Chat with AI",   desc: "Ask Claude anything about your cases, legal theories, or client strategy",       tab: "chat"       },
        ].map(a => (
          <QuickAction key={a.tab} label={a.label} desc={a.desc} onClick={() => setTab(a.tab)} />
        ))}
      </div>
    </div>
  );
}
