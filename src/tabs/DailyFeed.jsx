// DailyFeed — reads from the backend Vercel KV (same data as Leads Inbox).
// The hourly Vercel cron (api/scan.js) populates KV automatically 24/7.
// "Run Scan Now" triggers the backend scanner and polls for completion.

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";

const CRON_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — matches vercel.json cron

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function fmtCountdown(ms) {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(iso) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreStyle(score) {
  if (score >= 80) return { label: "Strong",     color: "#22c55e" };
  if (score >= 65) return { label: "Good",        color: "#84cc16" };
  if (score >= 55) return { label: "Investigate", color: "#f59e0b" };
  return               { label: "Weak",        color: "#ef4444" };
}

function urgencyColor(lvl) {
  return { CRITICAL: "#ef4444", HIGH: "#f59e0b", MEDIUM: "#3b82f6", LOW: "#6b7280" }[lvl] || "#6b7280";
}

function opportunityStyle(status) {
  return {
    OPEN:    { label: "OPEN",    color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)"  },
    CLOSING: { label: "CLOSING", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)" },
    CLOSED:  { label: "CLOSED",  color: "#6b7280", bg: "rgba(107,114,128,0.12)",border: "rgba(107,114,128,0.3)"},
    UNKNOWN: { label: "?",       color: "#6b7280", bg: "rgba(107,114,128,0.08)",border: "rgba(107,114,128,0.2)"},
  }[status] || { label: status, color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "rgba(107,114,128,0.2)" };
}

function readinessStyle(r) {
  return {
    READY_NOW:           { label: "READY NOW",     color: "#22c55e" },
    NEEDS_INVESTIGATION: { label: "INVESTIGATE",   color: "#f59e0b" },
    WAIT_FOR_TRIGGER:    { label: "WAIT: TRIGGER", color: "#3b82f6" },
  }[r] || { label: r, color: "#888" };
}

function pubAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1)  return "today";
  if (days === 1) return "1 day old";
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo old`;
  return `${Math.floor(months / 12)}yr old`;
}

// ─── LEAD CARD ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onAddToTracker, onDismiss, onPromoteToKB }) {
  const [expanded, setExpanded] = useState(false);
  const a   = lead.analysis || {};
  const sc  = scoreStyle(a.score || 0);
  const uc  = urgencyColor(a.timeline?.urgencyLevel);
  const ops = opportunityStyle(a.opportunityStatus);
  const rs  = a.targetingReadiness ? readinessStyle(a.targetingReadiness) : null;
  const age = pubAgo(lead.pubDate);

  return (
    <Card style={{ marginBottom: 12 }}>
      {/* Row 1: Score + status badges */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ textAlign: "center", minWidth: 52, flexShrink: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: sc.color, lineHeight: 1 }}>{a.score ?? "?"}</div>
          <div style={{ fontSize: 10, color: sc.color, fontWeight: 700 }}>{sc.label}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, alignItems: "center" }}>
          {a.classification && <Badge label={a.classification} color={a.classification === "CREATE" ? "#22c55e" : a.classification === "INVESTIGATE" ? "#f59e0b" : "#6b7280"} />}
          {a.joinOrCreate   && <Badge label={a.joinOrCreate}   color={a.joinOrCreate   === "CREATE" ? "#C8442F" : "#3b82f6"} />}
          {a.timeline?.urgencyLevel && a.timeline.urgencyLevel !== "LOW" && <Badge label={a.timeline.urgencyLevel} color={uc} />}
          {a.opportunityStatus && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: ops.bg, color: ops.color, border: `1px solid ${ops.border}` }}>
              {ops.label}
            </span>
          )}
          {rs && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: rs.color + "18", color: rs.color, border: `1px solid ${rs.color}44` }}>
              {rs.label}
            </span>
          )}
          {a.caseType && <span style={{ fontSize: 11, color: "#888" }}>{a.caseType}</span>}
        </div>
      </div>

      {/* Days to act */}
      {a.daysToAct != null && a.daysToAct <= 180 && (
        <div style={{ marginBottom: 8, padding: "6px 12px", borderRadius: 8, background: a.daysToAct <= 30 ? "rgba(239,68,68,0.12)" : a.daysToAct <= 90 ? "rgba(245,158,11,0.1)" : "rgba(34,197,94,0.08)", border: `1px solid ${a.daysToAct <= 30 ? "rgba(239,68,68,0.35)" : a.daysToAct <= 90 ? "rgba(245,158,11,0.3)" : "rgba(34,197,94,0.2)"}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: a.daysToAct <= 30 ? "#ef4444" : a.daysToAct <= 90 ? "#f59e0b" : "#22c55e", lineHeight: 1 }}>{a.daysToAct}</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: a.daysToAct <= 30 ? "#ef4444" : a.daysToAct <= 90 ? "#f59e0b" : "#22c55e", textTransform: "uppercase", letterSpacing: "0.06em" }}>Days to Act</div>
            {a.timeline?.statuteOfLimitationsNote && <div style={{ fontSize: 11, color: "#888" }}>{a.timeline.statuteOfLimitationsNote}</div>}
          </div>
        </div>
      )}

      {/* Headline + source + recency */}
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e0f0", marginBottom: 4, lineHeight: 1.4 }}>{a.headline || lead.title}</div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span>Source: <span style={{ color: "#C8442F" }}>{lead.source}</span></span>
        <span>· Scanned {timeAgo(lead.scannedAt)}</span>
        {age && <span>· Published <span style={{ color: age === "today" || (age?.includes("day") && parseInt(age) < 8) ? "#4ade80" : "#666" }}>{age}</span></span>}
        {a.timeline?.opportunityWindow && <span>· Window: <span style={{ color: "#c8c8e0" }}>{a.timeline.opportunityWindow}</span></span>}
      </div>

      {/* Targeting readiness reason */}
      {a.targetingReadiness === "READY_NOW" && a.targetingReadinessReason && (
        <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 8, padding: "6px 10px", background: "rgba(34,197,94,0.07)", borderRadius: 6, borderLeft: "3px solid #22c55e" }}>
          {a.targetingReadinessReason}
        </div>
      )}
      {a.targetingReadiness !== "READY_NOW" && a.targetingReadinessReason && (
        <div style={{ fontSize: 12, color: "#a0a0b8", marginBottom: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, borderLeft: "3px solid #555" }}>
          {a.targetingReadinessReason}
        </div>
      )}

      {/* Executive summary */}
      {a.executiveSummary && <div style={{ fontSize: 13, color: "#a0a0b8", lineHeight: 1.6, marginBottom: 12 }}>{a.executiveSummary}</div>}

      {/* Who to target */}
      {a.plaintiffProfile && (
        <div style={{ background: "rgba(200,68,47,0.07)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.18)", padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#E06050", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Who to Target</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
            {[["Demographics", a.plaintiffProfile.demographics], ["Injury Required", a.plaintiffProfile.requiredInjury], ["Exposure Period", a.plaintiffProfile.injuryTimeframe], ["Geography", a.plaintiffProfile.geographicHotspots?.join(", ")], ["Disqualifiers", a.plaintiffProfile.disqualifiers]].filter(([, v]) => v).map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 2, fontWeight: 600 }}>{lbl}</div>
                <div style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.4 }}>{val}</div>
              </div>
            ))}
          </div>
          {a.plaintiffProfile.whereToFind?.length > 0 && <div style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 6 }}><span style={{ color: "#666", fontWeight: 600, fontSize: 10 }}>WHERE TO FIND: </span>{a.plaintiffProfile.whereToFind.join(" · ")}</div>}
          {a.plaintiffProfile.documentationNeeded?.length > 0 && <div style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 6 }}><span style={{ color: "#666", fontWeight: 600, fontSize: 10 }}>DOCS NEEDED: </span>{a.plaintiffProfile.documentationNeeded.join(" · ")}</div>}
          {a.plaintiffProfile.acquisitionHook && (
            <div style={{ padding: "6px 10px", background: "rgba(200,68,47,0.12)", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#E06050", fontWeight: 700, marginBottom: 2 }}>AD HOOK</div>
              <div style={{ fontSize: 12, color: "#e0e0f0", fontStyle: "italic" }}>"{a.plaintiffProfile.acquisitionHook}"</div>
            </div>
          )}
        </div>
      )}

      {/* Damages + top risk */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {a.damagesModel && (
          <div style={{ background: "rgba(34,197,94,0.06)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.18)", padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#4ade80", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Damages</div>
            <div style={{ fontSize: 12, color: "#c8c8e0" }}>Per claimant: <strong>{a.damagesModel.perClaimantRange || "?"}</strong></div>
            <div style={{ fontSize: 12, color: "#c8c8e0" }}>Total fund: <strong>{a.damagesModel.totalFundEstimate || "?"}</strong></div>
            {a.damagesModel.feeToFirmAt33Pct && <div style={{ fontSize: 11, color: "#4ade80", marginTop: 2 }}>Firm fee: {a.damagesModel.feeToFirmAt33Pct}</div>}
          </div>
        )}
        {a.topRisk && (
          <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.15)", padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#f87171", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Top Risk</div>
            <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>{a.topRisk}</div>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginBottom: 10 }}>
          {a.timeline?.urgencyReason && (
            <div style={{ padding: "10px 12px", background: `${uc}11`, borderRadius: 8, border: `1px solid ${uc}33`, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: uc, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Urgency — {a.timeline.urgencyLevel}</div>
              <div style={{ fontSize: 12, color: "#d0d0e8" }}>{a.timeline.urgencyReason}</div>
              {a.timeline.opportunityWindow && <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>Window: {a.timeline.opportunityWindow}</div>}
              {a.timeline.statuteOfLimitationsNote && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>SOL: {a.timeline.statuteOfLimitationsNote}</div>}
            </div>
          )}
          {a.causesOfAction?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Causes of Action</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.causesOfAction.map((ca, i) => {
                  const c = ca.strength === "Strong" ? "#22c55e" : ca.strength === "Moderate" ? "#f59e0b" : "#ef4444";
                  return <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: c + "20", color: c, border: `1px solid ${c}44` }}>{ca.name} — {ca.strength}</span>;
                })}
              </div>
            </div>
          )}
          {a.defendantProfile?.name && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Defendant</div>
              <div style={{ fontSize: 13, color: "#e0e0f0", fontWeight: 600, marginBottom: 3 }}>{a.defendantProfile.name}</div>
              {a.defendantProfile.financialHealth && <div style={{ fontSize: 12, color: "#888" }}>Financial health: {a.defendantProfile.financialHealth}</div>}
              {a.defendantProfile.defenseLikelyStrategy && <div style={{ fontSize: 12, color: "#888" }}>Likely defense: {a.defendantProfile.defenseLikelyStrategy}</div>}
            </div>
          )}
          {a.existingLitigation?.opportunityAssessment && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Existing Litigation</div>
              {a.existingLitigation.mdlConsolidated && <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 2 }}>MDL already consolidated {a.existingMDLNumber ? `— ${a.existingMDLNumber}` : ""}</div>}
              <div style={{ fontSize: 12, color: "#a0a0b8" }}>{a.existingLitigation.opportunityAssessment}</div>
            </div>
          )}
          {a.immediateNextSteps?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Immediate Next Steps</div>
              {a.immediateNextSteps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
                  <span style={{ color: "#C8442F", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>
          )}
          {a.whyItScored && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Scoring Rationale</div>
              <div style={{ fontSize: 12, color: "#a0a0b8", lineHeight: 1.6 }}>{a.whyItScored}</div>
            </div>
          )}
          {a.analogousCases?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#888", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Similar Cases in KB</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.analogousCases.map((c, i) => <span key={i} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(255,255,255,0.05)", color: "#a0a0b8", border: "1px solid rgba(255,255,255,0.1)" }}>{c}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small onClick={() => onAddToTracker(lead)}>+ Case Tracker</Btn>
        {(lead.analysis?.score || 0) >= 85 && onPromoteToKB && (
          <Btn small onClick={() => onPromoteToKB(lead)} style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}>+ Promote to KB</Btn>
        )}
        <Btn small variant="secondary" onClick={() => window.open(lead.url, "_blank")}>Open Source</Btn>
        <Btn small variant="secondary" onClick={() => setExpanded(e => !e)}>{expanded ? "Show Less" : "Full Report"}</Btn>
        <Btn small variant="danger" onClick={() => onDismiss(lead.id)}>Dismiss</Btn>
      </div>
    </Card>
  );
}

// ─── MAIN TAB ─────────────────────────────────────────────────────────────────

const CASE_TYPES = ["Medical Device","Pharmaceutical","Auto Defect","Environmental","Consumer Fraud","Data Breach","Securities","Food Safety","Financial Products","Employment","Antitrust","Government Liability","Criminal Enforcement → Civil","Securities Fraud / Stock Drop","False Claims Act / Qui Tam","Other"];

export default function DailyFeed({ cases, setCases, setTab, kbCases, setKbCases }) {
  const [leads,          setLeads]          = useState([]);
  const [lastScanTime,   setLastScanTime]   = useState(null);
  const [totalInKV,      setTotalInKV]      = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [isScanning,     setIsScanning]     = useState(false);
  const [scanStatus,     setScanStatus]     = useState("");
  const [newLeadCount,   setNewLeadCount]   = useState(null);
  const [countdown,      setCountdown]      = useState(0);
  const [minScore,       setMinScore]       = useState(0);
  const [joinFilter,     setJoinFilter]     = useState("ALL");
  const [caseTypeFilter, setCaseTypeFilter] = useState("");
  const scanStartRef = useRef(null); // timestamp when "Run Scan Now" was clicked
  const pollRef      = useRef(null);

  // ── Fetch leads + stats from backend KV ──────────────────────────────────
  const fetchLeads = useCallback(async () => {
    try {
      const [leadsRes, statsRes] = await Promise.all([
        fetch("/api/leads?limit=200&minScore=0"),
        fetch("/api/leads?stats=1"),
      ]);
      const leadsData = leadsRes.ok ? await leadsRes.json() : { leads: [] };
      const statsData = statsRes.ok ? await statsRes.json() : {};
      setLeads(leadsData.leads || []);
      setTotalInKV(statsData.total ?? null);
      if (statsData.lastScan?.timestamp) setLastScanTime(statsData.lastScan.timestamp);
    } catch (e) {
      console.error("DailyFeed fetch failed:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Countdown to next auto-scan (hourly cron) ─────────────────────────────
  useEffect(() => {
    const tick = () => {
      if (!lastScanTime) { setCountdown(0); return; }
      const next = new Date(lastScanTime).getTime() + CRON_INTERVAL_MS;
      setCountdown(Math.max(0, next - Date.now()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastScanTime]);

  // ── Trigger backend scan + poll for completion ────────────────────────────
  const triggerScan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanStatus("Starting scan — backend is running 50+ sources...");
    setNewLeadCount(null);
    scanStartRef.current = Date.now();

    // Fire the scan (takes 2-3 min; we poll independently for resilience)
    fetch("/api/scan").then(r => r.json()).catch(() => {});

    // Poll stats every 8 seconds; when lastScan.timestamp is newer than our
    // start time, the scan completed.
    let attempts = 0;
    const MAX_ATTEMPTS = 45; // ~6 min max wait
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setScanStatus("Scan taking longer than expected — check back in a few minutes.");
        setIsScanning(false);
        return;
      }
      try {
        const res  = await fetch("/api/leads?stats=1");
        const data = res.ok ? await res.json() : {};
        const ts   = data.lastScan?.timestamp;
        if (ts && new Date(ts).getTime() > scanStartRef.current) {
          clearInterval(pollRef.current);
          const prev = leads.length;
          await fetchLeads();
          setLeads(cur => {
            setNewLeadCount(Math.max(0, cur.length - prev));
            return cur;
          });
          setScanStatus("Scan complete");
          setIsScanning(false);
        } else {
          const elapsed = Math.floor((Date.now() - scanStartRef.current) / 1000);
          setScanStatus(`Scanning... ${elapsed}s elapsed — fetching 50+ sources`);
        }
      } catch {}
    }, 8000);
  }, [isScanning, fetchLeads, leads.length]);

  // Cleanup poll on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleAddToTracker = useCallback((lead) => {
    const a = lead.analysis || {};
    setCases(prev => [...prev, {
      id: Date.now(),
      leadId: lead.id,
      title: a.headline || lead.title,
      caseType: a.caseType || "Other",
      score: a.score || 0,
      status: a.joinOrCreate === "JOIN" ? "MDL Active" : "Investigation",
      priority: a.timeline?.urgencyLevel === "CRITICAL" ? "Critical" : a.timeline?.urgencyLevel === "HIGH" ? "High" : "Medium",
      description: a.executiveSummary || lead.description,
      notes: a.recommendedAction || "",
      company: a.defendantProfile?.name || "",
      affectedPop: a.classProfile?.estimatedSize || "Unknown",
      dateAdded: new Date().toISOString().slice(0, 10),
      jurisdiction: a.classProfile?.geographicScope || "",
    }]);
    setTab("cases");
  }, [setCases, setTab]);

  const handlePromoteToKB = useCallback((lead) => {
    if (!setKbCases) return;
    const a     = lead.analysis || {};
    const score = a.score || 0;
    const rating = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B+" : score >= 60 ? "B" : "C";
    const nextId = Math.max(0, ...(kbCases || []).map(c => c.id || 0)) + 1;
    setKbCases(prev => [...prev, {
      id: nextId,
      title: a.headline || lead.title,
      company: a.defendantProfile?.name || "Unknown",
      type: a.caseType || "Other",
      industry: a.caseType || "Other",
      year: new Date().getFullYear(),
      settlement: a.damagesModel?.totalFundEstimate || "Pending",
      status: "Active",
      source: lead.source || "Feed",
      rating,
      analysis: {
        rating,
        strengthScore: Math.round(score / 10),
        payoutPerClaimant: a.damagesModel?.perClaimantRange || "Unknown",
        litigationYears: a.timeline?.yearsToResolution || 3,
        whyItWorked: a.executiveSummary || "",
        challenges: a.topRisk || "",
        strategiesWon: a.immediateNextSteps || [],
        strategiesFailed: [],
        demographics: a.plaintiffProfile?.demographics || "",
        injuryTypes: a.plaintiffProfile?.requiredInjury ? [a.plaintiffProfile.requiredInjury] : [],
        keyEvidence: a.signalsAnalysis?.present?.join("; ") || "",
        corporateMisconduct: a.executiveSummary || "",
        regulatoryActions: a.regulatoryStatus ? JSON.stringify(a.regulatoryStatus) : "",
        settlementStructure: a.damagesModel?.theory || "",
        bellwetherOutcome: "",
        attorneyFees: a.damagesModel?.feeToFirmAt33Pct || "",
        replicationModel: `${a.kbReplicationGrade || "C"} — ${a.kbComparativeAssessment || ""}`,
        clientAcquisitionStrategy: [a.plaintiffProfile?.acquisitionHook, ...(a.plaintiffProfile?.whereToFind || [])].filter(Boolean).join(". ") || "",
        watchOut: a.riskMatrix?.keyRisks?.[0] || a.topRisk || "",
      },
    }]);
    setTab("knowledge");
  }, [kbCases, setKbCases, setTab]);

  const handleDismiss = useCallback(async (id) => {
    setLeads(prev => prev.filter(l => l.id !== id));
    try { await fetch(`/api/leads?id=${id}`, { method: "DELETE" }); } catch {}
  }, []);

  const visible = leads
    .filter(l => (l.analysis?.score || 0) >= minScore)
    .filter(l => joinFilter === "ALL" || l.analysis?.joinOrCreate === joinFilter)
    .filter(l => !caseTypeFilter || l.analysis?.caseType === caseTypeFilter)
    .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

  const stats = {
    total:  leads.length,
    high:   leads.filter(l => (l.analysis?.score || 0) >= 75).length,
    create: leads.filter(l => l.analysis?.joinOrCreate === "CREATE").length,
    join:   leads.filter(l => l.analysis?.joinOrCreate === "JOIN").length,
  };

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#e0e0f0" }}>Daily Intelligence Feed</h2>
          <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Last scan: <span style={{ color: "#a0a0b8" }}>{timeAgo(lastScanTime)}</span></span>
            {!isScanning && countdown > 0 && (
              <span>Next auto-scan: <span style={{ color: "#C8442F" }}>{fmtCountdown(countdown)}</span></span>
            )}
            {isScanning && <span style={{ color: "#E06050" }}>{scanStatus}</span>}
            <span style={{ color: "#555" }}>Runs hourly on Vercel — accumulates while you're offline</span>
          </div>
        </div>
        <Btn small onClick={triggerScan} style={{ opacity: isScanning ? 0.5 : 1 }}>
          {isScanning ? "Scanning..." : "Run Scan Now"}
        </Btn>
      </div>

      {/* ── Scan progress bar ────────────────────────────────────────────────── */}
      {isScanning && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.2)" }}>
          <div style={{ fontSize: 12, color: "#E06050", marginBottom: 6 }}>{scanStatus}</div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "100%", background: "linear-gradient(90deg,#C8442F,#B83E2C)", borderRadius: 2, animation: "pulse 2s ease-in-out infinite" }} />
          </div>
        </div>
      )}

      {/* ── New leads banner ─────────────────────────────────────────────────── */}
      {!isScanning && newLeadCount !== null && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: newLeadCount > 0 ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${newLeadCount > 0 ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`, fontSize: 13, color: newLeadCount > 0 ? "#4ade80" : "#666" }}>
          {newLeadCount > 0 ? `${newLeadCount} new lead${newLeadCount > 1 ? "s" : ""} added from latest scan` : "No new leads this scan — all sources up to date"}
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", color: "#555", padding: "48px 0", fontSize: 13 }}>Loading leads from backend...</div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!loading && leads.length === 0 && (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e0e0f0", marginBottom: 8 }}>No leads yet</div>
          <div style={{ fontSize: 13, color: "#555", maxWidth: 460, margin: "0 auto 20px", lineHeight: 1.6 }}>
            The backend scanner runs automatically every hour on Vercel — no browser required. Click "Run Scan Now" to trigger an immediate scan, or wait for the hourly cron. Leads accumulate in the cloud while you're offline.
          </div>
          <Btn small onClick={triggerScan} style={{ opacity: isScanning ? 0.5 : 1 }}>
            {isScanning ? "Scanning..." : "Run Scan Now"}
          </Btn>
        </Card>
      )}

      {leads.length > 0 && (
        <>
          {/* ── Stats ──────────────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Total Leads",       value: stats.total,  color: "#C8442F", sub: "in feed" },
              { label: "High Priority",     value: stats.high,   color: "#22c55e", sub: "score 75+" },
              { label: "New Cases",         value: stats.create, color: "#f59e0b", sub: "CREATE opportunities" },
              { label: "Join Existing MDL", value: stats.join,   color: "#3b82f6", sub: "active cases" },
            ].map(s => (
              <Card key={s.label} style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0f0", marginTop: 2 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{s.sub}</div>
              </Card>
            ))}
          </div>

          {/* ── Filters ────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>Min score</span>
              <input type="range" min={0} max={100} step={5} value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={{ width: 100, accentColor: "#C8442F" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#E06050", minWidth: 24 }}>{minScore}</span>
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {["ALL","CREATE","JOIN"].map(v => (
                <button key={v} onClick={() => setJoinFilter(v)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: joinFilter === v ? "rgba(200,68,47,0.25)" : "rgba(255,255,255,0.05)", color: joinFilter === v ? "#E06050" : "#888", cursor: "pointer", fontSize: 12, fontWeight: joinFilter === v ? 600 : 400 }}>{v}</button>
              ))}
            </div>
            <select value={caseTypeFilter} onChange={e => setCaseTypeFilter(e.target.value)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "#0d0e18", color: "#888", fontSize: 12, cursor: "pointer" }}>
              <option value="">All case types</option>
              {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#555", marginLeft: "auto" }}>{visible.length} leads shown</span>
          </div>

          {/* ── Lead cards ─────────────────────────────────────────────────── */}
          {visible.length === 0
            ? <div style={{ textAlign: "center", padding: "32px 0", color: "#555", fontSize: 13 }}>No leads match current filters. Try lowering the minimum score.</div>
            : visible.map(lead => <LeadCard key={lead.id} lead={lead} onAddToTracker={handleAddToTracker} onDismiss={handleDismiss} onPromoteToKB={setKbCases ? handlePromoteToKB : null} />)
          }
        </>
      )}
    </div>
  );
}
