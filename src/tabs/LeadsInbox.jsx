import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Badge, Btn, ScoreBar } from "../components/UI.jsx";

const CASE_TYPES = [
  "Medical Device", "Pharmaceutical", "Auto Defect", "Environmental",
  "Consumer Fraud", "Data Breach", "Securities", "Food Safety",
  "Financial Products", "Employment", "Antitrust", "Government Liability", "Other",
];

const SOURCE_CATEGORIES = ["Federal", "Judicial", "News", "Social", "Medical"];

// ─── COLOR HELPERS ────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s >= 75) return "#22c55e";
  if (s >= 55) return "#f59e0b";
  return "#ef4444";
}

function classColor(c) {
  if (c === "CREATE") return "#22c55e";
  if (c === "INVESTIGATE") return "#f59e0b";
  return "#ef4444";
}

function urgencyColor(u) {
  if (u === "CRITICAL") return "#ef4444";
  if (u === "HIGH") return "#f97316";
  if (u === "MEDIUM") return "#f59e0b";
  return "#6b7280";
}

function severityColor(s) {
  if (s === "High") return "#ef4444";
  if (s === "Medium") return "#f59e0b";
  return "#22c55e";
}

function strengthColor(s) {
  if (s === "Strong") return "#22c55e";
  if (s === "Moderate") return "#f59e0b";
  return "#ef4444";
}

// ─── SOURCE CLASSIFICATION ────────────────────────────────────────────────────
// Maps raw source strings to a clean label + accent color for badges

function sourceCategory(source) {
  if (!source) return { label: "Unknown", color: "#666" };
  const s = source.toLowerCase();
  if (s.includes("faers") || (s.includes("fda") && s.includes("adverse"))) return { label: "FDA FAERS", color: "#ef4444" };
  if (s.includes("fda")) return { label: "FDA", color: "#ef4444" };
  if (s.includes("cpsc")) return { label: "CPSC", color: "#f97316" };
  if (s.includes("nhtsa")) return { label: "NHTSA", color: "#f97316" };
  if (s.includes("cfpb")) return { label: "CFPB", color: "#8b5cf6" };
  if (s.includes("sec edgar") || (s.includes("sec") && s.includes("edgar"))) return { label: "SEC EDGAR", color: "#8b5cf6" };
  if (s.includes("sec ") || s.startsWith("sec")) return { label: "SEC", color: "#8b5cf6" };
  if (s.includes("doj") || s.includes("department of justice")) return { label: "DOJ", color: "#ef4444" };
  if (s.includes("epa")) return { label: "EPA", color: "#22c55e" };
  if (s.includes("usda") || s.includes("fsis")) return { label: "USDA / FSIS", color: "#22c55e" };
  if (s.includes("ftc")) return { label: "FTC", color: "#f97316" };
  if (s.includes("eeoc")) return { label: "EEOC", color: "#f59e0b" };
  if (s.includes("courtlistener") || s.includes("court listener")) return { label: "CourtListener", color: "#3b82f6" };
  if (s.includes("jpml") || s.includes("mdl order")) return { label: "JPML / MDL", color: "#3b82f6" };
  if (s.includes("courthouse news")) return { label: "Courthouse News", color: "#3b82f6" };
  if (s.includes("pubmed")) return { label: "PubMed", color: "#22c55e" };
  if (s.includes("convergence")) return { label: "Convergence Signal", color: "#C8442F" };
  if (s.includes("reddit complaint cluster")) return { label: "Reddit Cluster", color: "#f97316" };
  if (s.includes("reddit")) return { label: "Reddit", color: "#f97316" };
  if (s.includes("x/twitter") || s.includes("twitter")) return { label: "X / Twitter", color: "#60a5fa" };
  if (s.includes("youtube")) return { label: "YouTube", color: "#ef4444" };
  if (s.includes("complaint search")) return { label: "Complaint Search", color: "#f59e0b" };
  if (s.includes("web:") || s.includes("claude web") || s.startsWith("web ")) return { label: "Claude Web Search", color: "#9090c0" };
  if (s.includes("google news")) return { label: "Google News", color: "#60a5fa" };
  if (s.includes("miller") || s.includes("mass tort") || s.includes("levin") || s.includes("motley") || s.includes("jd supra")) return { label: "Plaintiff Firm Intel", color: "#C8442F" };
  return { label: source.split(":")[0].split(" —")[0].trim().slice(0, 22), color: "#666" };
}

function SourceBadge({ source, url }) {
  const { label, color } = sourceCategory(source || "");
  // Extract the query/detail after the colon (e.g. "Google News: FDA recalls" → "FDA recalls")
  const detail = source?.includes(":") ? source.split(":").slice(1).join(":").trim().slice(0, 60) : null;
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
        background: `${color}18`, color, border: `1px solid ${color}33`,
        letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0 }}>
        {label}
      </span>
      {detail && (
        <span style={{ fontSize: 11, color: "#555", lineHeight: 1.3 }}>{detail}</span>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 10, color: "#555", textDecoration: "none", padding: "1px 7px",
            borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            whiteSpace: "nowrap", flexShrink: 0 }}>
          View Source →
        </a>
      )}
    </div>
  );
}

function stageColor(stage) {
  if (stage === "Pre-Litigation") return "#f59e0b";
  if (stage === "Filed / Discovery") return "#3b82f6";
  if (stage === "MDL Consolidated") return "#8b5cf6";
  if (stage === "Bellwether Set") return "#f97316";
  if (stage === "Settlement Discussions") return "#22c55e";
  if (stage === "Resolved") return "#6b7280";
  return "#6b7280";
}

// ─── SECTION COMPONENTS ───────────────────────────────────────────────────────

function Section({ title, children, accent = "#C8442F" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: accent, textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${accent}22` }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, valueColor }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 12 }}>
      <span style={{ color: "#666", minWidth: 140, flexShrink: 0 }}>{label}</span>
      <span style={{ color: valueColor || "#c8c8e0", lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function TagList({ items, color = "#C8442F" }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: `${color}18`, color, border: `1px solid ${color}33` }}>{item}</span>
      ))}
    </div>
  );
}

function SignalItem({ text, type }) {
  const colors = { present: "#22c55e", missing: "#ef4444", watch: "#f59e0b", strengthen: "#3b82f6" };
  const icons = { present: "✓", missing: "✗", watch: "◎", strengthen: "↑" };
  const color = colors[type] || "#888";
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 12, alignItems: "flex-start" }}>
      <span style={{ color, fontWeight: 700, flexShrink: 0, minWidth: 14 }}>{icons[type]}</span>
      <span style={{ color: "#c8c8e0", lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function RiskRow({ risk }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto 1fr", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, alignItems: "start" }}>
      <span style={{ color: "#c8c8e0" }}>{risk.risk}</span>
      <span style={{ padding: "1px 6px", borderRadius: 4, background: `${severityColor(risk.severity)}22`, color: severityColor(risk.severity), fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{risk.severity}</span>
      <span style={{ padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#888", fontSize: 10, whiteSpace: "nowrap" }}>{risk.likelihood}</span>
      <span style={{ color: "#888", lineHeight: 1.4 }}>{risk.mitigation}</span>
    </div>
  );
}

// ─── PLAINTIFF ACQUISITION BRIEF ─────────────────────────────────────────────

const BRIEF_PROMPT = `You are a senior plaintiff litigation strategist. Given an intelligence lead about a potential class action, produce a one-page Plaintiff Acquisition Brief for the firm's intake team.

Return ONLY a JSON object (no markdown, no explanation). Structure:
{
  "qualificationCriteria": ["<criterion 1 — specific, testable>", "<criterion 2>", "<criterion 3>"],
  "disqualifiers": ["<hard disqualifier 1>", "<hard disqualifier 2>"],
  "intakeDocs": ["<document 1>", "<document 2>", "<document 3>"],
  "whereToFind": ["<channel 1 — specific platform/group/community/location>", "<channel 2>", "<channel 3>"],
  "outreachScript": "<2-3 sentence intake script — conversational, not legal jargon. Tells prospective plaintiff what happened, what they may qualify for, what to do next>",
  "intakeQuestions": ["<question 1>", "<question 2>", "<question 3>", "<question 4>", "<question 5>"],
  "targetDemographics": "<who is the ideal plaintiff — age, geography, product usage, injury type>",
  "geographicHotspots": ["<state or region 1>", "<state or region 2>"],
  "competitorNote": "<are major plaintiff firms already advertising for this? How aggressively? Is there still a first-mover window?>",
  "urgencyNote": "<why sign clients NOW vs waiting — SOL, consolidation window, advertising costs rising, etc.>"
}

Be specific to the actual case. Never give generic answers. Cite the defendant, product, injury type, and case facts from the lead.`;

function AcquisitionBrief({ lead }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const a = lead.analysis || {};
    const context = [
      `Headline: ${a.headline || lead.title}`,
      `Case type: ${a.caseType || "Unknown"}`,
      `Case stage: ${a.caseStage || "Unknown"}`,
      `Defendant: ${a.defendantProfile?.name || "Unknown"}`,
      `Class size: ${a.classProfile?.estimatedSize || "Unknown"}`,
      `Injuries: ${a.plaintiffProfile?.requiredInjury || "Unknown"}`,
      `Demographics: ${a.plaintiffProfile?.demographics || "Unknown"}`,
      `Where to find: ${(a.plaintiffProfile?.whereToFind || []).join(", ") || "Unknown"}`,
      `Disqualifiers: ${a.plaintiffProfile?.disqualifiers || "Unknown"}`,
      `Docs needed: ${(a.plaintiffProfile?.documentationNeeded || []).join(", ") || "Unknown"}`,
      `Damages per claimant: ${a.damagesModel?.perClaimantRange || "Unknown"}`,
      `Total fund: ${a.damagesModel?.totalFundEstimate || "Unknown"}`,
      `Urgency: ${a.timeline?.urgencyLevel || "Unknown"} — ${a.timeline?.urgencyReason || ""}`,
      `SOL: ${a.timeline?.statuteOfLimitationsNote || "Unknown"}`,
      `KB Replication Grade: ${a.kbReplicationGrade || "Unknown"}`,
      `Executive Summary: ${a.executiveSummary || ""}`,
    ].join("\n");

    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Brief generation failed");
      setBrief(data.brief);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [lead]);

  if (!brief && !loading && !error) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Btn small variant="secondary" onClick={generate}>Generate Acquisition Brief</Btn>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, border: "1px solid rgba(200,68,47,0.3)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "rgba(200,68,47,0.08)", borderBottom: "1px solid rgba(200,68,47,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#C8442F", letterSpacing: "0.1em", textTransform: "uppercase" }}>Plaintiff Acquisition Brief</span>
        <Btn small variant="secondary" onClick={generate} style={{ padding: "2px 10px", fontSize: 10 }}>
          {loading ? "Generating..." : "Regenerate"}
        </Btn>
      </div>

      {loading && (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "#555", fontSize: 12 }}>
          Generating acquisition brief...
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", color: "#f87171", fontSize: 12 }}>Error: {error}</div>
      )}

      {brief && !loading && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Target + Outreach Script */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {brief.targetDemographics && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Target Plaintiff</div>
                <div style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.5 }}>{brief.targetDemographics}</div>
              </div>
            )}
            {brief.outreachScript && (
              <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.06)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Outreach Script</div>
                <div style={{ fontSize: 12, color: "#86efac", fontStyle: "italic", lineHeight: 1.5 }}>"{brief.outreachScript}"</div>
              </div>
            )}
          </div>

          {/* Qualification + Disqualifiers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {brief.qualificationCriteria?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Qualification Criteria</div>
                {brief.qualificationCriteria.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 3, display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ color: "#22c55e", flexShrink: 0 }}>✓</span><span style={{ lineHeight: 1.4 }}>{c}</span>
                  </div>
                ))}
              </div>
            )}
            {brief.disqualifiers?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Disqualifiers</div>
                {brief.disqualifiers.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#fca5a5", marginBottom: 3, display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ flexShrink: 0 }}>✗</span><span style={{ lineHeight: 1.4 }}>{d}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Where to Find */}
          {brief.whereToFind?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Where to Find Plaintiffs</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {brief.whereToFind.map((w, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(59,130,246,0.1)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" }}>{w}</span>
                ))}
              </div>
            </div>
          )}

          {/* Intake Questions */}
          {brief.intakeQuestions?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Intake Questions</div>
              {brief.intakeQuestions.map((q, i) => (
                <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 4, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "#f59e0b", fontWeight: 700, flexShrink: 0, minWidth: 16 }}>{i + 1}.</span>
                  <span style={{ lineHeight: 1.4 }}>{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* Docs + Geographic Hotspots */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {brief.intakeDocs?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Documents to Request</div>
                {brief.intakeDocs.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 2 }}>• {d}</div>
                ))}
              </div>
            )}
            {brief.geographicHotspots?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Geographic Hotspots</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {brief.geographicHotspots.map((g, i) => (
                    <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)" }}>{g}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Competitor + Urgency notes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {brief.competitorNote && (
              <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.06)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.2)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Competitor Landscape</div>
                <div style={{ fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}>{brief.competitorNote}</div>
              </div>
            )}
            {brief.urgencyNote && (
              <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Why Sign Clients Now</div>
                <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>{brief.urgencyNote}</div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── JUDGE INTELLIGENCE ───────────────────────────────────────────────────────

function JudgeIntel({ lead }) {
  const a = lead.analysis || {};
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [judgeInput, setJudgeInput] = useState(a.assignedJudge || "");

  const researchJudge = useCallback(async (name) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          judgeName: name,
          court: a.assignedJudgeCourt || null,
          mdlNumber: a.existingMDLNumber || null,
          caseType: a.caseType || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Judge research failed");
      setProfile(data.profile);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [a]);

  function pfColor(score) {
    if (score >= 7) return "#22c55e";
    if (score >= 5) return "#f59e0b";
    return "#ef4444";
  }

  if (!profile && !loading) {
    return (
      <div style={{ marginBottom: 14 }}>
        {a.assignedJudge ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#888" }}>Judge: <strong style={{ color: "#e0e0f0" }}>{a.assignedJudge}</strong></span>
            {a.assignedJudgeCourt && <span style={{ fontSize: 11, color: "#555" }}>· {a.assignedJudgeCourt}</span>}
            <Btn small variant="secondary" onClick={() => researchJudge(a.assignedJudge)}>Get Judge Intel</Btn>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input value={judgeInput} onChange={e => setJudgeInput(e.target.value)}
              placeholder="Enter judge name..."
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, width: 200 }}
              onKeyDown={e => { if (e.key === "Enter" && judgeInput.trim()) researchJudge(judgeInput.trim()); }} />
            <Btn small variant="secondary" onClick={() => judgeInput.trim() && researchJudge(judgeInput.trim())}>Research Judge</Btn>
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>Error: {error}</div>}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 14, padding: "20px 16px", background: "rgba(59,130,246,0.05)", borderRadius: 10, border: "1px solid rgba(59,130,246,0.2)", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#555" }}>Researching judge ruling history...</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Searching published opinions, class cert rulings, MDL history</div>
      </div>
    );
  }

  const pf = profile.plaintiffFriendlyScore ?? 5;

  return (
    <div style={{ marginBottom: 16, border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "rgba(59,130,246,0.08)", borderBottom: "1px solid rgba(59,130,246,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#60a5fa", letterSpacing: "0.1em", textTransform: "uppercase" }}>Judge Intelligence</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e0e0f0" }}>{profile.name}</span>
          {profile.court && <span style={{ fontSize: 11, color: "#555" }}>{profile.court}</span>}
          {profile.appointedBy && <span style={{ fontSize: 11, color: "#555" }}>· Appt. {profile.appointedBy}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {profile.dataQuality && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4,
              background: profile.dataQuality === "high" ? "rgba(34,197,94,0.12)" : profile.dataQuality === "medium" ? "rgba(245,158,11,0.12)" : "rgba(100,100,100,0.12)",
              color: profile.dataQuality === "high" ? "#22c55e" : profile.dataQuality === "medium" ? "#f59e0b" : "#666" }}>
              {profile.dataQuality} confidence
            </span>
          )}
          <Btn small variant="secondary" onClick={() => { setProfile(null); setError(null); }} style={{ padding: "2px 8px", fontSize: 10 }}>Re-research</Btn>
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Score tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
          <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: `1px solid ${pfColor(pf)}33`, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: pfColor(pf), lineHeight: 1 }}>{pf}<span style={{ fontSize: 13, color: "#555" }}>/10</span></div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Plaintiff-Friendly</div>
          </div>
          {profile.classCertGrantRate && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#e0e0f0", lineHeight: 1.3 }}>{profile.classCertGrantRate}</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Class Cert Grant Rate</div>
            </div>
          )}
          {profile.daubert && profile.daubert !== "unknown" && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: profile.daubert === "admit-leaning" ? "#22c55e" : profile.daubert === "exclude-leaning" ? "#ef4444" : "#f59e0b", lineHeight: 1.4 }}>
                {profile.daubert.replace(/-/g, " ")}
              </div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Daubert Tendency</div>
            </div>
          )}
          {profile.mdlExperience && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: profile.mdlExperience === "extensive" ? "#22c55e" : profile.mdlExperience === "moderate" ? "#f59e0b" : "#ef4444", lineHeight: 1.4 }}>
                {profile.mdlExperience}
              </div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>MDL Experience</div>
            </div>
          )}
          {profile.avgDaysToClassCert && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#e0e0f0", lineHeight: 1.3 }}>{profile.avgDaysToClassCert}d</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg to Class Cert</div>
            </div>
          )}
        </div>

        {/* Overall assessment */}
        {profile.overallAssessment && (
          <div style={{ padding: "10px 14px", background: `${pfColor(pf)}0d`, borderRadius: 8, border: `1px solid ${pfColor(pf)}33` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: pfColor(pf), letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Assessment for Plaintiff Firm</div>
            <div style={{ fontSize: 13, color: "#e0e0f0", lineHeight: 1.6 }}>{profile.overallAssessment}</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {profile.notableRulings?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Notable Rulings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {profile.notableRulings.slice(0, 4).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "flex-start" }}>
                    <span style={{ color: r.plaintiffResult === "favorable" ? "#22c55e" : r.plaintiffResult === "unfavorable" ? "#ef4444" : "#f59e0b", fontWeight: 700, flexShrink: 0 }}>●</span>
                    <div style={{ lineHeight: 1.4 }}>
                      <span style={{ color: "#888", fontSize: 11 }}>{r.case} ({r.year}) — </span>
                      <span style={{ color: "#c8c8e0" }}>{r.ruling}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            {profile.keyTendencies?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Key Tendencies</div>
                {profile.keyTendencies.map((t, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 4, display: "flex", gap: 6 }}>
                    <span style={{ color: "#f59e0b", flexShrink: 0 }}>→</span><span style={{ lineHeight: 1.4 }}>{t}</span>
                  </div>
                ))}
              </div>
            )}
            {profile.riskFlags?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Risk Flags</div>
                {profile.riskFlags.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#fca5a5", marginBottom: 4, display: "flex", gap: 6 }}>
                    <span style={{ flexShrink: 0 }}>⚑</span><span style={{ lineHeight: 1.4 }}>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {profile.strategyTips?.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Strategy Tips</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 6 }}>
              {profile.strategyTips.map((tip, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "6px 10px", background: "rgba(34,197,94,0.05)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.12)", fontSize: 12, color: "#86efac", alignItems: "flex-start" }}>
                  <span style={{ color: "#22c55e", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ lineHeight: 1.4 }}>{tip}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.dataQualityNote && (
          <div style={{ fontSize: 11, color: "#444", fontStyle: "italic" }}>{profile.dataQualityNote}</div>
        )}
      </div>
    </div>
  );
}

// ─── INTELLIGENCE REPORT (expanded view) ─────────────────────────────────────

function IntelligenceReport({ lead, onDismiss, onAddToTracker }) {
  const a = lead.analysis || {};

  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>

      {/* ── SOURCE ATTRIBUTION — always visible at top of report ── */}
      <div style={{ marginBottom: 16, padding: "8px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Source</span>
        <SourceBadge source={lead.source} url={lead.url} />
        {lead.pubDate && (
          <span style={{ fontSize: 11, color: "#444", marginLeft: "auto" }}>
            {new Date(lead.pubDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </span>
        )}
      </div>

      {/* ── RECALL ALERT — shown when lead originated from a government recall/warning ── */}
      {a.recallIntelligence?.isGovernmentRecall && (
        <div style={{ marginBottom: 18, padding: "14px 16px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#ef4444", textTransform: "uppercase" }}>Government Recall / Safety Warning</span>
              {a.recallIntelligence.recallClass && !a.recallIntelligence.recallClass.includes("Not") && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
                  {a.recallIntelligence.recallClass.split("—")[0].trim()}
                </span>
              )}
              {a.recallIntelligence.issuingAgency && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#888" }}>
                  {a.recallIntelligence.issuingAgency}
                </span>
              )}
            </div>
            {a.recallIntelligence.immediateAction && (
              <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>Act Now</span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {a.recallIntelligence.productName && (
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Product</div>
                <div style={{ fontSize: 12, color: "#fca5a5", fontWeight: 600 }}>{a.recallIntelligence.productName}</div>
              </div>
            )}
            {a.recallIntelligence.estimatedClassSize && (
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Est. Class Size</div>
                <div style={{ fontSize: 12, color: "#e0e0f0", fontWeight: 600 }}>{a.recallIntelligence.estimatedClassSize}</div>
              </div>
            )}
            {a.recallIntelligence.recallScope && (
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Scope</div>
                <div style={{ fontSize: 12, color: "#e0e0f0" }}>{a.recallIntelligence.recallScope}</div>
              </div>
            )}
          </div>

          {a.recallIntelligence.injuryMechanism && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#666", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Injury Mechanism</div>
              <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>{a.recallIntelligence.injuryMechanism}</div>
            </div>
          )}

          {a.recallIntelligence.injuryReported && (
            <div style={{ marginBottom: 10, padding: "6px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 2, fontWeight: 700 }}>Injuries Already Reported</div>
              <div style={{ fontSize: 12, color: "#fca5a5" }}>{a.recallIntelligence.injuryReported}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            {a.recallIntelligence.liabilityTheory && (
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Liability Theory</div>
                <div style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.5 }}>{a.recallIntelligence.liabilityTheory}</div>
              </div>
            )}
            {a.recallIntelligence.manufacturerKnowledge && (
              <div>
                <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Manufacturer Prior Knowledge</div>
                <div style={{ fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}>{a.recallIntelligence.manufacturerKnowledge}</div>
              </div>
            )}
          </div>

          {a.recallIntelligence.classDefinition && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(59,130,246,0.06)", borderRadius: 6, border: "1px solid rgba(59,130,246,0.2)" }}>
              <div style={{ fontSize: 10, color: "#60a5fa", marginBottom: 2, fontWeight: 700, textTransform: "uppercase" }}>Proposed Class Definition</div>
              <div style={{ fontSize: 12, color: "#93c5fd", lineHeight: 1.5 }}>{a.recallIntelligence.classDefinition}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            {a.recallIntelligence.targetDemographics && (
              <div>
                <div style={{ fontSize: 10, color: "#22c55e", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Target Demographics</div>
                <div style={{ fontSize: 12, color: "#86efac", lineHeight: 1.5 }}>{a.recallIntelligence.targetDemographics}</div>
              </div>
            )}
            {a.recallIntelligence.whereToFindPlaintiffs?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#22c55e", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Where to Find Plaintiffs</div>
                {a.recallIntelligence.whereToFindPlaintiffs.map((ch, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#86efac", marginBottom: 2 }}>• {ch}</div>
                ))}
              </div>
            )}
          </div>

          {a.recallIntelligence.acquisitionScript && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.2)" }}>
              <div style={{ fontSize: 10, color: "#22c55e", marginBottom: 2, fontWeight: 700 }}>Outreach Script</div>
              <div style={{ fontSize: 13, color: "#86efac", fontStyle: "italic" }}>"{a.recallIntelligence.acquisitionScript}"</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {a.recallIntelligence.competingFirmsLikely && (
              <div style={{ padding: "6px 10px", background: "rgba(245,158,11,0.06)", borderRadius: 6, border: "1px solid rgba(245,158,11,0.2)" }}>
                <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 2, fontWeight: 700 }}>Competition Timeline</div>
                <div style={{ fontSize: 12, color: "#fbbf24" }}>{a.recallIntelligence.competingFirmsLikely}</div>
              </div>
            )}
            {a.recallIntelligence.immediateAction && (
              <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)" }}>
                <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 2, fontWeight: 700 }}>Immediate Action Required</div>
                <div style={{ fontSize: 12, color: "#fca5a5" }}>{a.recallIntelligence.immediateAction}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {a.executiveSummary && (
        <Section title="Executive Summary" accent="#C8442F">
          <p style={{ fontSize: 13, color: "#c8c8e0", lineHeight: 1.7, margin: 0 }}>{a.executiveSummary}</p>
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.causesOfAction && a.causesOfAction.length > 0 && (
          <Section title="Causes of Action" accent="#B83E2C">
            {a.causesOfAction.map((ca, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: "#c8c8e0", flex: 1, lineHeight: 1.4 }}>{ca.name}</span>
                <span style={{ marginLeft: 8, color: strengthColor(ca.strength), fontWeight: 600, fontSize: 11, flexShrink: 0 }}>{ca.strength}</span>
              </div>
            ))}
          </Section>
        )}

        {a.classProfile && (
          <Section title="Class Profile" accent="#3b82f6">
            <InfoRow label="Estimated size" value={a.classProfile.estimatedSize} />
            <InfoRow label="Size confidence" value={a.classProfile.sizeConfidence} />
            <InfoRow label="Geographic scope" value={a.classProfile.geographicScope} />
            {a.classProfile.commonalityStrength && (
              <div style={{ fontSize: 12, color: "#c8c8e0", marginTop: 4, lineHeight: 1.5 }}>{a.classProfile.commonalityStrength}</div>
            )}
          </Section>
        )}
      </div>

      {a.plaintiffProfile && (
        <Section title="Ideal Plaintiff Profile" accent="#22c55e">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <InfoRow label="Demographics" value={a.plaintiffProfile.demographics} />
              <InfoRow label="Required injury" value={a.plaintiffProfile.requiredInjury} />
              <InfoRow label="Injury timeframe" value={a.plaintiffProfile.injuryTimeframe} />
              {a.plaintiffProfile.disqualifiers && (
                <InfoRow label="Disqualifiers" value={a.plaintiffProfile.disqualifiers} valueColor="#f87171" />
              )}
            </div>
            <div>
              {a.plaintiffProfile.documentationNeeded?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Documentation needed</div>
                  {a.plaintiffProfile.documentationNeeded.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 2 }}>• {d}</div>
                  ))}
                </div>
              )}
              {a.plaintiffProfile.whereToFind?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Where to find plaintiffs</div>
                  <TagList items={a.plaintiffProfile.whereToFind} color="#22c55e" />
                </div>
              )}
            </div>
          </div>
          {a.plaintiffProfile.acquisitionHook && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.2)" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Acquisition hook</div>
              <div style={{ fontSize: 13, color: "#86efac", fontStyle: "italic" }}>"{a.plaintiffProfile.acquisitionHook}"</div>
            </div>
          )}
          {a.plaintiffProfile.geographicHotspots?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Geographic hotspots</div>
              <TagList items={a.plaintiffProfile.geographicHotspots} color="#3b82f6" />
            </div>
          )}
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.defendantProfile && (
          <Section title="Defendant Profile" accent="#ef4444">
            <InfoRow label="Entity" value={a.defendantProfile.name} />
            <InfoRow label="Financial health" value={a.defendantProfile.financialHealth} />
            <InfoRow label="Bankruptcy risk" value={a.defendantProfile.bankruptcyRisk}
              valueColor={a.defendantProfile.bankruptcyRisk === "High" ? "#ef4444" : a.defendantProfile.bankruptcyRisk === "Medium" ? "#f59e0b" : "#22c55e"} />
            {a.defendantProfile.assetProtectionRisk && a.defendantProfile.assetProtectionRisk !== "None" && (
              <InfoRow label="Asset protection" value={a.defendantProfile.assetProtectionRisk} valueColor="#f87171" />
            )}
            <InfoRow label="Prior litigation" value={a.defendantProfile.priorLitigation} />
            {a.defendantProfile.defenseLikelyStrategy && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Likely defense</div>
                <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>{a.defendantProfile.defenseLikelyStrategy}</div>
              </div>
            )}
            {a.defendantProfile.vulnerability && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Vulnerability</div>
                <div style={{ fontSize: 12, color: "#86efac", lineHeight: 1.4 }}>{a.defendantProfile.vulnerability}</div>
              </div>
            )}
          </Section>
        )}

        {a.regulatoryStatus && (
          <Section title="Regulatory Status" accent="#f59e0b">
            {a.regulatoryStatus.recallIssued && (
              <div style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(239,68,68,0.1)", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", fontSize: 11, color: "#fca5a5", fontWeight: 600 }}>
                RECALL ISSUED — {a.regulatoryStatus.recallClass || ""}
              </div>
            )}
            {a.regulatoryStatus.fdaAction && <InfoRow label="FDA" value={a.regulatoryStatus.fdaAction} />}
            {a.regulatoryStatus.cpscAction && <InfoRow label="CPSC" value={a.regulatoryStatus.cpscAction} />}
            {a.regulatoryStatus.nhtsaAction && <InfoRow label="NHTSA" value={a.regulatoryStatus.nhtsaAction} />}
            {a.regulatoryStatus.epaAction && <InfoRow label="EPA" value={a.regulatoryStatus.epaAction} />}
            {a.regulatoryStatus.secAction && <InfoRow label="SEC" value={a.regulatoryStatus.secAction} />}
            {a.regulatoryStatus.dojAction && <InfoRow label="DOJ" value={a.regulatoryStatus.dojAction} />}
            {a.regulatoryStatus.stateAgAction && <InfoRow label="State AG" value={a.regulatoryStatus.stateAgAction} />}
            {a.regulatoryStatus.governmentInvestigation && (
              <InfoRow label="Gov. investigation" value={a.regulatoryStatus.governmentInvestigation} />
            )}
          </Section>
        )}

        {a.existingLitigation && (
          <Section title="Existing Litigation" accent="#3b82f6">
            {a.existingLitigation.mdlConsolidated && (
              <div style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(59,130,246,0.1)", borderRadius: 4, fontSize: 11, color: "#93c5fd", fontWeight: 600 }}>
                MDL CONSOLIDATED {a.existingMDLNumber ? `— MDL ${a.existingMDLNumber}` : ""}
              </div>
            )}
            <InfoRow label="Active cases" value={a.existingLitigation.activeFederalCases} />
            <InfoRow label="Settlement status" value={a.existingLitigation.settlementStatus} />
            {a.existingLitigation.leadFirmsInvolved?.filter(Boolean).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Lead firms</div>
                <TagList items={a.existingLitigation.leadFirmsInvolved} color="#3b82f6" />
              </div>
            )}
            {a.existingLitigation.opportunityAssessment && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#93c5fd", lineHeight: 1.4 }}>{a.existingLitigation.opportunityAssessment}</div>
            )}
          </Section>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.damagesModel && (
          <Section title="Damages Model" accent="#E06050">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              {a.damagesModel.perClaimantRange && (
                <div style={{ padding: "8px 10px", background: "rgba(167,139,250,0.08)", borderRadius: 6, border: "1px solid rgba(167,139,250,0.2)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Per Claimant</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E06050" }}>{a.damagesModel.perClaimantRange}</div>
                </div>
              )}
              {a.damagesModel.totalFundEstimate && (
                <div style={{ padding: "8px 10px", background: "rgba(167,139,250,0.08)", borderRadius: 6, border: "1px solid rgba(167,139,250,0.2)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Total Fund</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E06050" }}>{a.damagesModel.totalFundEstimate}</div>
                </div>
              )}
            </div>
            {a.damagesModel.feeToFirmAt33Pct && (
              <InfoRow label="Fee to firm (33%)" value={a.damagesModel.feeToFirmAt33Pct} valueColor="#22c55e" />
            )}
            {a.damagesModel.theory && <InfoRow label="Damages theory" value={a.damagesModel.theory} />}
            {a.damagesModel.comcastNote && (
              <div style={{ fontSize: 11, color: a.damagesModel.comcastCompliant ? "#86efac" : "#fca5a5", marginTop: 4, lineHeight: 1.4 }}>
                Comcast compliance: {a.damagesModel.comcastNote}
              </div>
            )}
          </Section>
        )}

        {a.timeline && (
          <Section title="Timeline & Urgency" accent={urgencyColor(a.timeline.urgencyLevel)}>
            {a.caseStage && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: stageColor(a.caseStage) + "22", color: stageColor(a.caseStage), border: `1px solid ${stageColor(a.caseStage)}44` }}>
                  {a.caseStage}
                </span>
                {a.caseStageRationale && (
                  <div style={{ fontSize: 12, color: "#a0a0b8", marginTop: 5, lineHeight: 1.4 }}>{a.caseStageRationale}</div>
                )}
              </div>
            )}
            {a.timeline.urgencyLevel && (
              <div style={{ marginBottom: 8, padding: "6px 10px", background: `${urgencyColor(a.timeline.urgencyLevel)}18`, borderRadius: 6, border: `1px solid ${urgencyColor(a.timeline.urgencyLevel)}44`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: urgencyColor(a.timeline.urgencyLevel) }}>{a.timeline.urgencyLevel} URGENCY</span>
                {a.timeline.yearsToResolution && (
                  <span style={{ fontSize: 11, color: "#888" }}>{a.timeline.yearsToResolution} years est.</span>
                )}
              </div>
            )}
            {a.timeline.urgencyReason && (
              <div style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 8, lineHeight: 1.4 }}>{a.timeline.urgencyReason}</div>
            )}
            {a.timeline.statuteOfLimitationsNote && (
              <InfoRow label="SOL" value={a.timeline.statuteOfLimitationsNote} valueColor="#fbbf24" />
            )}
            {a.timeline.nextMilestone && <InfoRow label="Next milestone" value={a.timeline.nextMilestone} />}
            {a.timeline.opportunityWindow && (
              <InfoRow label="Opportunity window" value={a.timeline.opportunityWindow} valueColor="#f59e0b" />
            )}
          </Section>
        )}
      </div>

      {a.signalsAnalysis && (
        <Section title="Signal Analysis" accent="#C8442F">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              {a.signalsAnalysis.present?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 4, fontWeight: 600 }}>Present</div>
                  {a.signalsAnalysis.present.map((s, i) => <SignalItem key={i} text={s} type="present" />)}
                </div>
              )}
              {a.signalsAnalysis.strengthening?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#3b82f6", marginBottom: 4, fontWeight: 600 }}>Strengthening</div>
                  {a.signalsAnalysis.strengthening.map((s, i) => <SignalItem key={i} text={s} type="strengthen" />)}
                </div>
              )}
            </div>
            <div>
              {a.signalsAnalysis.missing?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 4, fontWeight: 600 }}>Missing</div>
                  {a.signalsAnalysis.missing.map((s, i) => <SignalItem key={i} text={s} type="missing" />)}
                </div>
              )}
              {a.signalsAnalysis.watchFor?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4, fontWeight: 600 }}>Watch For</div>
                  {a.signalsAnalysis.watchFor.map((s, i) => <SignalItem key={i} text={s} type="watch" />)}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {a.riskMatrix && a.riskMatrix.length > 0 && (
        <Section title="Risk Matrix" accent="#ef4444">
          <div style={{ fontSize: 11, color: "#444", marginBottom: 6, display: "grid", gridTemplateColumns: "1fr auto auto 1fr", gap: 8 }}>
            <span>Risk</span><span>Severity</span><span>Likelihood</span><span>Mitigation</span>
          </div>
          {a.riskMatrix.map((r, i) => <RiskRow key={i} risk={r} />)}
        </Section>
      )}

      {/* ── KB INTELLIGENCE — KB-grounded comparison, analogues, warnings, playbook ── */}
      {(a.kbAnalogues?.length > 0 || a.kbWarnings?.length > 0 || a.kbComparativeAssessment) && (
        <Section title="KB Intelligence — Historical Case Comparison" accent="#C8442F">

          {/* Replication grade + comparative assessment */}
          {(a.kbReplicationGrade || a.kbComparativeAssessment) && (
            <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "flex-start" }}>
              {a.kbReplicationGrade && (
                <div style={{ flexShrink: 0, width: 72, height: 72, borderRadius: 10, background: "rgba(200,68,47,0.12)", border: "2px solid rgba(200,68,47,0.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#C8442F", lineHeight: 1 }}>{a.kbReplicationGrade}</div>
                  <div style={{ fontSize: 9, color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>Replicate</div>
                </div>
              )}
              {a.kbComparativeAssessment && (
                <p style={{ fontSize: 13, color: "#c8c8e0", lineHeight: 1.7, margin: 0, flex: 1 }}>{a.kbComparativeAssessment}</p>
              )}
            </div>
          )}

          {/* KB Analogues — cases that succeeded with same pattern */}
          {a.kbAnalogues?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                Similar cases that succeeded ({a.kbAnalogues.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {a.kbAnalogues.map((k, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "start" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#22c55e" }}>{k.rating || "?"}</span>
                      <span style={{ fontSize: 9, color: "#444", textAlign: "center", lineHeight: 1.2 }}>KB#{k.caseId}</span>
                      {k.replicationGrade && (
                        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(34,197,94,0.12)", color: "#86efac", fontWeight: 700 }}>{k.replicationGrade}</span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#86efac", marginBottom: 2 }}>{k.caseName}</div>
                      {k.settlement && <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 4 }}>{k.settlement}</div>}
                      {k.whyAnalogous && <div style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.5, marginBottom: 4 }}>{k.whyAnalogous}</div>}
                      {k.keyLesson && (
                        <div style={{ fontSize: 11, color: "#86efac", padding: "4px 8px", background: "rgba(34,197,94,0.08)", borderRadius: 4, lineHeight: 1.4 }}>
                          Lesson: {k.keyLesson}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KB Warnings — cases that failed with same pattern */}
          {a.kbWarnings?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                Failure mode warnings ({a.kbWarnings.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {a.kbWarnings.map((k, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "start" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#ef4444" }}>{k.rating || "F"}</span>
                      <span style={{ fontSize: 9, color: "#444", textAlign: "center", lineHeight: 1.2 }}>KB#{k.caseId}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 2 }}>{k.caseName}</div>
                      {k.failureMode && <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5, marginBottom: 4 }}>Failure: {k.failureMode}</div>}
                      {k.howThisLeadMirrorsIt && <div style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.5, marginBottom: 4 }}>{k.howThisLeadMirrorsIt}</div>}
                      {k.mitigationAdvice && (
                        <div style={{ fontSize: 11, color: "#fbbf24", padding: "4px 8px", background: "rgba(251,191,36,0.06)", borderRadius: 4, lineHeight: 1.4 }}>
                          Avoid: {k.mitigationAdvice}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KB Strategic Playbook — derived from historical success patterns */}
          {a.kbStrategicPlaybook?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "#C8442F", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                Strategic playbook (from KB patterns)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {a.kbStrategicPlaybook.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#c8c8e0", lineHeight: 1.5, padding: "4px 0" }}>
                    <span style={{ color: "#C8442F", fontWeight: 700, flexShrink: 0, minWidth: 18 }}>{i + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.analogousCases?.length > 0 && !a.kbAnalogues?.length && (
          <Section title="KB Analogues" accent="#E06050">
            <TagList items={a.analogousCases} color="#E06050" />
          </Section>
        )}
        {a.whyItScored && (
          <Section title="Scoring Rationale" accent="#C8442F">
            <p style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.6, margin: 0 }}>{a.whyItScored}</p>
          </Section>
        )}
      </div>

      {a.immediateNextSteps?.length > 0 && (
        <Section title="Immediate Next Steps" accent="#22c55e">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {a.immediateNextSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.15)", fontSize: 12, color: "#86efac", alignItems: "flex-start" }}>
                <span style={{ color: "#22c55e", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ lineHeight: 1.5 }}>{step}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.topRisk && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
          <span style={{ fontSize: 11, color: "#888" }}>Top Risk: </span>
          <span style={{ fontSize: 13, color: "#fca5a5" }}>{a.topRisk}</span>
        </div>
      )}

      {lead.description && (
        <Section title="Source Excerpt" accent="#333">
          <p style={{ fontSize: 12, color: "#555", lineHeight: 1.6, margin: 0 }}>
            {lead.description.slice(0, 500)}{lead.description.length > 500 ? "..." : ""}
          </p>
        </Section>
      )}

      {/* Judge Intel — always available; input shown when judge not yet identified */}
      <Section title="Judge Intelligence" accent="#3b82f6">
        <JudgeIntel lead={lead} />
      </Section>

      <AcquisitionBrief lead={lead} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
        <Btn small onClick={() => onAddToTracker(lead)}>+ Add to Case Tracker</Btn>
        {lead.url && (
          <Btn small variant="secondary" onClick={() => window.open(lead.url, "_blank")}>Open Source</Btn>
        )}
        <Btn small variant="danger" onClick={() => onDismiss(lead.id)}>Dismiss</Btn>
      </div>
    </div>
  );
}

// ─── OPPORTUNITY CARD ─────────────────────────────────────────────────────────

function OpportunityCard({ opp, leadsMap }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={{ cursor: "pointer", borderLeft: `3px solid ${scoreColor(opp.combinedScore)}` }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "rgba(200,68,47,0.2)", color: "#C8442F", border: "1px solid rgba(200,68,47,0.4)" }}>
              #{opp.rank}
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor(opp.combinedScore), lineHeight: 1 }}>{opp.combinedScore}</span>
            <span style={{ fontSize: 11, color: "#666" }}>/ {opp.probabilityOfSuccess}% P(success)</span>
            {opp.caseStage && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: stageColor(opp.caseStage) + "18", color: stageColor(opp.caseStage), border: `1px solid ${stageColor(opp.caseStage)}44` }}>
                {opp.caseStage}
              </span>
            )}
            {opp.urgencyLevel && opp.urgencyLevel !== "LOW" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: `${urgencyColor(opp.urgencyLevel)}18`, color: urgencyColor(opp.urgencyLevel), border: `1px solid ${urgencyColor(opp.urgencyLevel)}44` }}>
                {opp.urgencyLevel}
              </span>
            )}
            {opp.firstMoverAdvantage && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
                FIRST MOVER
              </span>
            )}
            {opp.signalCount > 0 && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(100,100,150,0.15)", color: "#9090c0" }}>
                {opp.signalCount} signals
              </span>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e0e0f0", marginBottom: 3 }}>{opp.opportunityName}</div>
          {opp.estimatedFund && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
              Fund: <span style={{ color: "#E06050", fontWeight: 600 }}>{opp.estimatedFund}</span>
              {opp.estimatedFeeToFirm && <> · Firm fee: <span style={{ color: "#22c55e", fontWeight: 600 }}>{opp.estimatedFeeToFirm}</span></>}
            </div>
          )}
          {opp.whyPursue?.[0] && <div style={{ fontSize: 12, color: "#c8c8e0" }}>• {opp.whyPursue[0]}</div>}
        </div>
        {opp.kbReplicationGrade && opp.kbReplicationGrade !== "Unknown" && (
          <div style={{ textAlign: "center", minWidth: 44, flexShrink: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: opp.kbReplicationGrade <= "B" ? "#22c55e" : opp.kbReplicationGrade <= "C" ? "#f59e0b" : "#ef4444" }}>{opp.kbReplicationGrade}</div>
            <div style={{ fontSize: 9, color: "#555" }}>KB GRADE</div>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
          {opp.whyPursue?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Why Pursue</div>
              {opp.whyPursue.map((r, i) => <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 4 }}>• {r}</div>)}
            </div>
          )}
          {opp.immediateAction && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(200,68,47,0.08)", borderRadius: 8, border: "1px solid rgba(200,68,47,0.25)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Immediate Action</div>
              <div style={{ fontSize: 13, color: "#e0e0f0", fontWeight: 600 }}>{opp.immediateAction}</div>
            </div>
          )}
          {opp.keyRisk && (
            <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>Risk: {opp.keyRisk}</div>
          )}
          {opp.supportingSignals?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Supporting Signals</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {opp.supportingSignals.map((s, i) => {
                  // Look up source from leads map by matching headline
                  const matchedLead = leadsMap ? Object.values(leadsMap).find(l =>
                    l.analysis?.headline === s || l.title === s || (l.analysis?.headline && s.includes(l.analysis.headline.slice(0, 40)))
                  ) : null;
                  const src = matchedLead?.source;
                  const url = matchedLead?.url;
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      {src && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                          background: `${sourceCategory(src).color}18`, color: sourceCategory(src).color,
                          border: `1px solid ${sourceCategory(src).color}33`, whiteSpace: "nowrap", flexShrink: 0, marginTop: 1 }}>
                          {sourceCategory(src).label}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "#8080a8", lineHeight: 1.4, flex: 1 }}>{s.slice(0, 90)}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          style={{ fontSize: 10, color: "#555", textDecoration: "none", padding: "1px 5px",
                            borderRadius: 3, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            whiteSpace: "nowrap", flexShrink: 0 }}>
                          →
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── LEAD CARD ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onDismiss, onAddToTracker }) {
  const [expanded, setExpanded] = useState(false);
  const a = lead.analysis || {};
  const urgency = a.timeline?.urgencyLevel;

  return (
    <Card style={{ cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor(a.score || 0), lineHeight: 1 }}>{a.score ?? "—"}</span>
              {a.confidence != null && (
                <span style={{ fontSize: 10, color: "#666" }}>/ {a.confidence}% conf</span>
              )}
            </div>
            {a.classification && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: classColor(a.classification) + "22", color: classColor(a.classification), border: `1px solid ${classColor(a.classification)}44` }}>
                {a.classification}
              </span>
            )}
            {a.joinOrCreate && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: a.joinOrCreate === "JOIN" ? "rgba(59,130,246,0.15)" : "rgba(184,62,44,0.15)", color: a.joinOrCreate === "JOIN" ? "#60a5fa" : "#E06050", border: `1px solid ${a.joinOrCreate === "JOIN" ? "#3b82f644" : "#B83E2C44"}` }}>
                {a.joinOrCreate}
              </span>
            )}
            {urgency && urgency !== "LOW" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: `${urgencyColor(urgency)}18`, color: urgencyColor(urgency), border: `1px solid ${urgencyColor(urgency)}44` }}>
                {urgency}
              </span>
            )}
            {a.caseStage && a.caseStage !== "Resolved" && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: stageColor(a.caseStage) + "18", color: stageColor(a.caseStage), border: `1px solid ${stageColor(a.caseStage)}44` }}>
                {a.caseStage}
              </span>
            )}
            {a.caseType && <Badge label={a.caseType} color="#C8442F" />}
            {a.subCategory && <Badge label={a.subCategory} color="#B83E2C" />}
          </div>

          <div style={{ fontWeight: 600, fontSize: 14, color: "#e0e0f0", marginBottom: 6, lineHeight: 1.4 }}>
            {a.headline || lead.title}
          </div>

          {/* Prominent source attribution */}
          <div style={{ marginBottom: 6 }}>
            <SourceBadge source={lead.source} url={lead.url} />
          </div>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 4 }}>
            {new Date(lead.pubDate || lead.scannedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </div>

          {a.executiveSummary && (
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 4 }}>
              {a.executiveSummary.slice(0, 180)}{a.executiveSummary.length > 180 ? "..." : ""}
            </div>
          )}

          {a.topRisk && (
            <div style={{ fontSize: 11, color: "#fbbf24", display: "flex", gap: 4, alignItems: "flex-start" }}>
              <span style={{ opacity: 0.6 }}>Top risk:</span> {a.topRisk}
            </div>
          )}

          {a.damagesModel?.totalFundEstimate && (
            <div style={{ fontSize: 11, color: "#E06050", marginTop: 3 }}>
              Est. fund: {a.damagesModel.totalFundEstimate}
              {a.damagesModel.feeToFirmAt33Pct && ` · Fee: ${a.damagesModel.feeToFirmAt33Pct}`}
            </div>
          )}
          {(a.kbReplicationGrade || a.kbAnalogues?.length > 0) && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
              {a.kbReplicationGrade && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(200,68,47,0.12)", color: "#C8442F", border: "1px solid rgba(200,68,47,0.3)" }}>
                  KB Grade: {a.kbReplicationGrade}
                </span>
              )}
              {a.kbAnalogues?.slice(0, 2).map((k, i) => (
                <span key={i} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "rgba(34,197,94,0.08)", color: "#86efac", border: "1px solid rgba(34,197,94,0.2)" }}>
                  ~ KB#{k.caseId} {k.caseName?.split(" ").slice(0, 3).join(" ")} ({k.rating})
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <ScoreBar score={a.score || 0} />
          {a.scoreDimensions && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
              {[
                { key: "liabilityCertainty", label: "Liab" },
                { key: "certifiability", label: "Cert" },
                { key: "economicUpside", label: "Econ" },
                { key: "plaintiffPipeline", label: "Pipe" },
                { key: "firstMoverWindow", label: "Window" },
              ].map(({ key, label }) => {
                const val = a.scoreDimensions[key] ?? 0;
                const pct = Math.round((val / 20) * 100);
                const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 9, color: "#555", minWidth: 36, textAlign: "right" }}>{label}</span>
                    <div style={{ width: 56, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 9, color, minWidth: 14, textAlign: "right", fontWeight: 600 }}>{val}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#444" }}>{expanded ? "▲ collapse" : "▼ expand"}</div>
        </div>
      </div>

      {expanded && (
        <IntelligenceReport lead={lead} onDismiss={onDismiss} onAddToTracker={onAddToTracker} />
      )}
    </Card>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function LeadsInbox({ onAddCase, setCases, cases }) {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState("");

  const [minScore, setMinScore] = useState(0);
  const [filterClass, setFilterClass] = useState("");
  const [filterJoinCreate, setFilterJoinCreate] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCaseType, setFilterCaseType] = useState("");
  const [filterUrgency, setFilterUrgency] = useState("");
  const [filterCaseStage, setFilterCaseStage] = useState("");

  const [viewMode, setViewMode] = useState("leads");
  const [opportunities, setOpportunities] = useState([]);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [oppsGeneratedAt, setOppsGeneratedAt] = useState(null);
  const [newAvailable, setNewAvailable] = useState(0);
  const [countdown, setCountdown] = useState(0);

  const fetchOpportunities = useCallback(async (forceRefresh = false) => {
    setOppsLoading(true);
    try {
      const res = await fetch(`/api/opportunities${forceRefresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      setOpportunities(data.opportunities || []);
      setOppsGeneratedAt(data.generatedAt || null);
    } catch (e) {
      setError("Opportunities synthesis failed: " + e.message);
    }
    setOppsLoading(false);
  }, []);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ minScore });
      if (filterClass) params.set("classification", filterClass);
      if (filterJoinCreate) params.set("joinOrCreate", filterJoinCreate);
      if (filterCategory) params.set("category", filterCategory);
      if (filterCaseType) params.set("caseType", filterCaseType);

      const leadsRes = await fetch(`/api/leads?${params}`);
      const leadsData = await leadsRes.json();
      setLeads(leadsData.leads || []);
      // Immediately apply the real KV total from the leads response
      if (leadsData.total != null) setStats(prev => ({ ...(prev || {}), total: leadsData.total }));

      // Stats fetch for band breakdowns and lastScan metadata
      fetch("/api/leads?stats=1")
        .then(r => r.ok ? r.json() : null)
        .then(statsData => { if (statsData) setStats(statsData); })
        .catch(() => {});
    } catch (e) {
      setError("Cannot connect to backend. Deploy to Vercel and enable KV.");
    }
    setLoading(false);
  }, [minScore, filterClass, filterJoinCreate, filterCategory, filterCaseType]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Poll stats every 30s — show banner when new leads arrive
  const kvTotalRef = useRef(null);
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/leads?stats=1")
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const latest = d.total ?? 0;
          if (kvTotalRef.current !== null && latest > kvTotalRef.current) {
            setNewAvailable(latest - kvTotalRef.current);
          }
          kvTotalRef.current = latest;
          // Update countdown to next hourly scan
          if (d.lastScan?.timestamp) {
            const next = new Date(d.lastScan.timestamp).getTime() + 60 * 60 * 1000;
            setCountdown(Math.max(0, Math.round((next - Date.now()) / 1000)));
          }
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchLeads]);

  // Countdown ticker
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-push leads scoring ≥ 75 to Case Tracker (only if not already tracked by leadId)
  useEffect(() => {
    if (!setCases || leads.length === 0) return;
    const highLeads = leads.filter(l => (l.analysis?.score || 0) >= 75);
    if (highLeads.length === 0) return;
    setCases(prev => {
      const existingLeadIds = new Set(prev.map(c => c.leadId).filter(Boolean));
      const toAdd = highLeads.filter(l => !existingLeadIds.has(l.id));
      if (toAdd.length === 0) return prev;
      return [...toAdd.map((lead, i) => buildCaseFromLead(lead, i)), ...prev];
    });
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan");
      const data = await res.json();
      setScanResult(data);
      await fetchLeads();
    } catch (e) {
      setError("Scan failed: " + e.message);
    }
    setScanning(false);
  };

  const dismissLead = async (id) => {
    try {
      await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      setLeads(l => l.filter(lead => lead.id !== id));
    } catch (e) {
      console.error("Dismiss failed:", e);
    }
  };

  const buildCaseFromLead = (lead, idOffset = 0) => {
    const a = lead.analysis || {};
    return {
      id: Date.now() + idOffset,
      leadId: lead.id,
      title: a.headline || lead.title,
      company: a.defendantProfile?.name || "",
      caseType: a.caseType || "Other",
      priority: (a.score || 0) >= 90 ? "Critical" : (a.score || 0) >= 75 ? "High" : "Medium",
      status: "New Lead",
      source: lead.source,
      affectedPop: a.classProfile?.estimatedSize || "",
      jurisdiction: a.classProfile?.geographicScope || "",
      score: a.score || 50,
      description: a.executiveSummary || lead.description || "",
      notes: [
        a.analogousCases?.length ? `KB Analogues: ${a.analogousCases.join(", ")}` : null,
        a.topRisk ? `Top Risk: ${a.topRisk}` : null,
        `Damages: Per claimant ${a.damagesModel?.perClaimantRange || "unknown"} · Fund ${a.damagesModel?.totalFundEstimate || "unknown"}`,
        `Timeline: ${a.timeline?.yearsToResolution || "?"} yrs · Urgency: ${a.timeline?.urgencyLevel || "unknown"}`,
        a.timeline?.statuteOfLimitationsNote ? `SOL: ${a.timeline.statuteOfLimitationsNote}` : null,
        a.recommendedAction ? `Action: ${a.recommendedAction}` : null,
        lead.url ? `Source: ${lead.url}` : null,
      ].filter(Boolean).join("\n"),
      dateAdded: new Date().toISOString().slice(0, 10),
    };
  };

  const addToTracker = (lead) => {
    if (!setCases) return;
    setCases(prev => {
      if (prev.some(c => c.leadId === lead.id)) return prev; // already tracked
      return [buildCaseFromLead(lead), ...prev];
    });
    if (onAddCase) onAddCase();
  };

  const visibleLeads = leads
    .filter(l => !filterUrgency || l.analysis?.timeline?.urgencyLevel === filterUrgency)
    .filter(l => !filterCaseStage || l.analysis?.caseStage === filterCaseStage)
    .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

  // Build a lookup map for OpportunityCard to resolve source + URL from supporting signal titles
  const leadsMap = Object.fromEntries(leads.map(l => [l.id, l]));

  const highCount = leads.filter(l => (l.analysis?.score || 0) >= 75).length;
  const criticalCount = leads.filter(l => l.analysis?.timeline?.urgencyLevel === "CRITICAL").length;
  const createCount = leads.filter(l => l.analysis?.joinOrCreate === "CREATE").length;
  const joinCount = leads.filter(l => l.analysis?.joinOrCreate === "JOIN").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Leads Inbox</h2>
          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
            50+ sources monitored daily — federal agencies, courts, news, Reddit, social media, medical journals, SEC filings
            {stats?.lastScan ? ` · Last scan: ${new Date(stats.lastScan.timestamp).toLocaleString()}` : ""}
            {stats?.lastScan?.sourcesQueried ? ` · ${stats.lastScan.sourcesQueried} sources queried` : ""}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Btn onClick={triggerScan} style={{ flexShrink: 0 }}>
            {scanning ? "Scanning..." : "Run Scan Now"}
          </Btn>
          {countdown > 0 && !scanning && (
            <span style={{ fontSize: 11, color: "#555" }}>
              Next auto-scan in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>

      {newAvailable > 0 && (
        <div onClick={() => { fetchLeads(); setNewAvailable(0); }} style={{
          marginBottom: 12, padding: "10px 16px", borderRadius: 10,
          background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
          fontSize: 13, color: "#86efac", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
          {newAvailable} new lead{newAvailable > 1 ? "s" : ""} available — click to load
        </div>
      )}

      {scanResult && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(34,197,94,0.08)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)", fontSize: 13, color: "#86efac" }}>
          Scan complete: {scanResult.processed} items fetched · {scanResult.newItems} new · {scanResult.passedTriage} passed triage · {scanResult.newLeads} deep-analyzed.
          {scanResult.topLeads?.[0] && <span> Top: <strong>{scanResult.topLeads[0].headline}</strong> (score {scanResult.topLeads[0].score}, {scanResult.topLeads[0].urgency})</span>}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, color: "#f87171" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          ["Total Leads", stats?.total ?? leads.length, "#C8442F"],
          ["Critical Urgency", criticalCount, "#ef4444"],
          ["High Priority (75+)", highCount, "#22c55e"],
          ["CREATE Opportunities", createCount, "#E06050"],
          ["JOIN Existing Cases", joinCount, "#3b82f6"],
        ].map(([label, val, color]) => (
          <Card key={label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
          </Card>
        ))}
      </div>

      {/* ── View mode toggle ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "leads", label: `All Leads (${stats?.total ?? leads.length})` },
          { id: "opportunities", label: "Top Opportunities" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => {
            setViewMode(id);
            if (id === "opportunities" && opportunities.length === 0) fetchOpportunities();
          }} style={{
            padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: viewMode === id ? "#C8442F" : "rgba(255,255,255,0.06)",
            color: viewMode === id ? "#fff" : "#888",
            border: `1px solid ${viewMode === id ? "#C8442F" : "rgba(255,255,255,0.1)"}`,
          }}>
            {label}
          </button>
        ))}
      </div>

      {viewMode === "leads" ? (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>Min score: <strong style={{ color: "#e0e0f0" }}>{minScore}</strong></span>
              <input type="range" min="0" max="100" step="5" value={minScore} onChange={e => setMinScore(parseInt(e.target.value))}
                style={{ width: 100, accentColor: "#C8442F", cursor: "pointer" }} />
            </div>

            {[
              { label: "Classification", value: filterClass, onChange: setFilterClass, options: ["CREATE", "INVESTIGATE", "PASS"] },
              { label: "JOIN / CREATE", value: filterJoinCreate, onChange: setFilterJoinCreate, options: ["JOIN", "CREATE"] },
              { label: "Category", value: filterCategory, onChange: setFilterCategory, options: SOURCE_CATEGORIES },
              { label: "Urgency", value: filterUrgency, onChange: setFilterUrgency, options: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
            ].map(({ label, value, onChange, options }) => (
              <select key={label} value={value} onChange={e => onChange(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, cursor: "pointer" }}>
                <option value="">{label}: All</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}

            <select value={filterCaseType} onChange={e => setFilterCaseType(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, cursor: "pointer" }}>
              <option value="">Case Type: All</option>
              {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select value={filterCaseStage} onChange={e => setFilterCaseStage(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, cursor: "pointer" }}>
              <option value="">Stage: All</option>
              <option value="Pre-Litigation">Pre-Litigation</option>
              <option value="Filed / Discovery">Filed / Discovery</option>
              <option value="MDL Consolidated">MDL Consolidated</option>
              <option value="Bellwether Set">Bellwether Set</option>
              <option value="Settlement Discussions">Settlement Discussions</option>
              <option value="Resolved">Resolved</option>
            </select>

            <Btn small variant="secondary" onClick={fetchLeads}>Refresh</Btn>
          </div>

          <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
            {visibleLeads.length} leads · click any card to expand full intelligence report
          </div>

          {loading ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 13 }}>Loading leads...</div>
            </div>
          ) : visibleLeads.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📥</div>
              <div style={{ marginBottom: 8 }}>No leads yet.</div>
              <div style={{ fontSize: 12, color: "#444" }}>
                {error ? "Check Vercel deployment and KV configuration." : "Click \"Run Scan Now\" to monitor 50+ sources: FDA, CPSC, NHTSA, SEC, DOJ, EEOC, courts, Reddit, news, social media, PubMed, CFPB."}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleLeads.map(lead => (
                <LeadCard key={lead.id} lead={lead} onDismiss={dismissLead} onAddToTracker={addToTracker} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              {oppsLoading
                ? "Claude is synthesizing case opportunities across all leads..."
                : `${opportunities.length} case opportunities ranked by probability of success${oppsGeneratedAt ? ` · Generated ${new Date(oppsGeneratedAt).toLocaleString()}` : ""}`}
            </div>
            <Btn small variant="secondary" onClick={() => fetchOpportunities(true)} style={{ flexShrink: 0 }}>
              {oppsLoading ? "Analyzing..." : "Refresh Analysis"}
            </Btn>
          </div>
          {oppsLoading ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 13 }}>Grouping signals by defendant · Scoring by KB precedent · Ranking by P(success)...</div>
            </div>
          ) : opportunities.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ marginBottom: 8 }}>No leads available for synthesis.</div>
              <div style={{ fontSize: 12, color: "#444" }}>Run a scan first to populate leads, then return here.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {opportunities.map((opp, i) => <OpportunityCard key={i} opp={opp} leadsMap={leadsMap} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
