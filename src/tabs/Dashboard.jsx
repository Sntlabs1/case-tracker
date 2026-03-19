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
      background: "var(--bg-surface)",
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
        background: hov ? "var(--bg-card-hov)" : "var(--bg-card)",
        borderRadius: 10,
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        padding: "20px",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
        {label}
        {badge && (
          <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 7px", borderRadius: 999, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", fontWeight: 600 }}>{badge}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-6)", lineHeight: 1.5 }}>
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
        background: hov ? "var(--bg-surface)" : "var(--bg-surface2)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
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
          {a.caseType && <span style={{ fontSize: 10, color: "var(--text-5)" }}>{a.caseType}</span>}
          {urgency && urgency.toUpperCase() !== "LOW" && (
            <span style={{ fontSize: 10, fontWeight: 700, color: urgencyColor(urgency) }}>{urgency.toUpperCase()}</span>
          )}
        </div>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--text-1)", lineHeight: 1.35,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {headline.slice(0, 100)}{headline.length > 100 ? "…" : ""}
        </div>
        {defendant && (
          <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 3 }}>vs. {defendant}</div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "var(--text-7)", flexShrink: 0, paddingTop: 2 }}>
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
        background: hov ? "var(--bg-surface)" : "var(--bg-surface2)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        cursor: "pointer", transition: "all 0.13s",
      }}
    >
      {/* Rank + score column */}
      <div style={{ flexShrink: 0, textAlign: "center", width: 42 }}>
        <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700 }}>#{opp.rank}</div>
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
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>{opp.signalCount} signals</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 3, lineHeight: 1.3 }}>
          {opp.opportunityName}
        </div>
        {(opp.estimatedFund && opp.estimatedFund !== "Unknown") && (
          <div style={{ fontSize: 11, color: "var(--text-4)" }}>
            Fund: <span style={{ color: "#E06050", fontWeight: 600 }}>{opp.estimatedFund}</span>
            {opp.estimatedFeeToFirm && opp.estimatedFeeToFirm !== "Unknown" && (
              <> · Fee: <span style={{ color: "#22c55e", fontWeight: 600 }}>{opp.estimatedFeeToFirm}</span></>
            )}
          </div>
        )}
        {opp.whyPursue?.[0] && (
          <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 3 }}>• {opp.whyPursue[0]}</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-6)", flexShrink: 0, paddingTop: 2 }}>
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
        background: hov ? "var(--bg-surface)" : "transparent",
        transition: "background 0.13s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: hov ? "var(--text-1)" : color }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
          {count} {count === 1 ? "case" : "cases"}
        </span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 4, height: 7, overflow: "hidden" }}>
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
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        background: hov ? "var(--bg-surface2)" : "transparent",
        borderRadius: 6,
        transition: "background 0.13s",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-7)", width: 22, textAlign: "center", flexShrink: 0 }}>#{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {c.title}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: st.color, fontWeight: 600 }}>{st.label}</span>
          {c.caseType && <span style={{ fontSize: 10, color: "var(--text-6)" }}>{c.caseType}</span>}
          {c.company && <span style={{ fontSize: 10, color: "var(--text-7)" }}>{c.company}</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: sc }}>{c.score}</span>
        <span style={{ fontSize: 10, color: "var(--text-7)" }}>/100</span>
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
        background: hov ? "var(--bg-card-hov)" : "var(--bg-card)",
        border: `1px solid ${hov ? "rgba(200,68,47,0.35)" : "var(--border)"}`,
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#C8442F", marginBottom: 6 }}>{label} →</div>
      <div style={{ fontSize: 11, color: "var(--text-6)", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

// ── Drawer: inline chat for a lead ────────────────────────────────────────────
function DrawerChat({ lead }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);

  const a = lead.analysis || {};
  const systemPrompt = `You are a plaintiff class action attorney reviewing an intelligence lead. Here is the full case data:

Case: ${a.headline || lead.title}
Score: ${a.score ?? "N/A"} | Confidence: ${a.confidence ?? "N/A"}% | Classification: ${a.classification || "N/A"}
Case Type: ${a.caseType || "N/A"} | Stage: ${a.caseStage || "N/A"}
Defendant: ${a.defendantProfile?.name || "Unknown"} (${a.defendantProfile?.type || "Unknown"})
Financial Health: ${a.defendantProfile?.financialHealth || "Unknown"} | Bankruptcy Risk: ${a.defendantProfile?.bankruptcyRisk || "Unknown"}
Plaintiff Demographics: ${a.plaintiffProfile?.demographics || "Unknown"}
Required Injury: ${a.plaintiffProfile?.requiredInjury || "Unknown"}
Causes of Action: ${JSON.stringify(a.causesOfAction || [])}
Damages: ${a.damagesModel?.perClaimantRange || "Unknown"} per claimant | Total Fund: ${a.damagesModel?.totalFundEstimate || "Unknown"}
Urgency: ${a.timeline?.urgencyLevel || "Unknown"} — ${a.timeline?.urgencyReason || ""}
Top Risk: ${a.topRisk || "Unknown"}
Executive Summary: ${a.executiveSummary || "N/A"}

Answer questions about this specific lead concisely and precisely.`;

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs);
    setInput("");
    setStreaming(true);
    let assistantText = "";
    setMsgs(m => [...m, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMsgs, system: systemPrompt }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              assistantText += ev.delta.text;
              setMsgs(m => [...m.slice(0, -1), { role: "assistant", content: assistantText }]);
            }
          } catch {}
        }
      }
    } catch (e) {
      setMsgs(m => [...m.slice(0, -1), { role: "assistant", content: "Error: " + e.message }]);
    }
    setStreaming(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>AI Chat — Ask About This Lead</div>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {msgs.length === 0 && (
          <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Ask about legal theories, damages, defendant vulnerabilities, acquisition strategy...</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{
            padding: "8px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
            background: m.role === "user" ? "rgba(200,68,47,0.08)" : "rgba(255,255,255,0.04)",
            color: m.role === "user" ? "#e0c0b8" : "#c8c8e0",
            border: `1px solid ${m.role === "user" ? "rgba(200,68,47,0.2)" : "rgba(255,255,255,0.06)"}`,
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "92%",
            whiteSpace: "pre-wrap",
          }}>
            {m.content || (streaming && i === msgs.length - 1 ? "▋" : "")}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask anything about this case..."
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "8px 12px", color: "#e0e0f0", fontSize: 12, outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          style={{
            padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: streaming || !input.trim() ? "rgba(200,68,47,0.3)" : "#C8442F",
            color: "#fff", border: "none",
          }}
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Drawer: streaming memo for a lead ─────────────────────────────────────────
function DrawerMemo({ lead }) {
  const [memoText, setMemoText] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setMemoText("");
    setDone(false);
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              text += ev.delta.text;
              setMemoText(text);
            }
          } catch {}
        }
      }
    } catch (e) {
      setMemoText("Error generating memo: " + e.message);
    }
    setLoading(false);
    setDone(true);
  }

  if (!memoText && !loading) {
    return (
      <button
        onClick={generate}
        style={{
          width: "100%", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
          cursor: "pointer", background: "rgba(255,255,255,0.06)", color: "#c8c8e0",
          border: "1px solid rgba(255,255,255,0.12)", transition: "all 0.15s",
        }}
      >
        Generate Full Litigation Memo
      </button>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Litigation Memo {loading ? "(generating…)" : "(complete)"}
        </div>
        {done && (
          <button onClick={() => { setMemoText(""); setDone(false); }} style={{ fontSize: 11, color: "#555", background: "none", border: "none", cursor: "pointer" }}>Regenerate</button>
        )}
      </div>
      <pre style={{
        fontSize: 11, lineHeight: 1.7, color: "#c0c0d8", whiteSpace: "pre-wrap",
        background: "rgba(255,255,255,0.03)", padding: "12px 14px", borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)", maxHeight: 500, overflowY: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        {memoText}{loading ? "▋" : ""}
      </pre>
    </div>
  );
}

// ── Lead detail drawer (slide-over) ───────────────────────────────────────────
function LeadDetailDrawer({ lead, onClose }) {
  const a = lead.analysis || {};
  const score = a.score || 0;
  const sc = scoreColor(score);
  const [activeSection, setActiveSection] = useState("overview");

  function Field({ label, value }) {
    if (!value || value === "Unknown" || value === "N/A") return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#c0c0d8", lineHeight: 1.5 }}>{value}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        background: "var(--bg-drawer)", borderLeft: "1px solid var(--border)",
        zIndex: 500, display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-drawer-hd)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: sc, lineHeight: 1 }}>{score}</span>
              <span style={{ fontSize: 11, color: "#555" }}>/ 100</span>
              {a.caseType && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(200,68,47,0.1)", color: "#C8442F", border: "1px solid rgba(200,68,47,0.25)" }}>{a.caseType}</span>}
              {a.caseStage && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#888" }}>{a.caseStage}</span>}
              {a.timeline?.urgencyLevel && a.timeline.urgencyLevel.toUpperCase() !== "LOW" && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${urgencyColor(a.timeline.urgencyLevel)}18`, color: urgencyColor(a.timeline.urgencyLevel) }}>
                  {a.timeline.urgencyLevel.toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e0f0", lineHeight: 1.4 }}>
              {a.headline || lead.title || ""}
            </div>
            {a.defendantProfile?.name && a.defendantProfile.name !== "Unknown" && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>vs. {a.defendantProfile.name}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "6px 10px", color: "#888", cursor: "pointer", fontSize: 14, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
          {["overview", "legal", "damages", "chat", "memo"].map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: activeSection === s ? "#C8442F" : "rgba(255,255,255,0.06)",
              color: activeSection === s ? "#fff" : "#666",
              border: `1px solid ${activeSection === s ? "#C8442F" : "rgba(255,255,255,0.1)"}`,
              textTransform: "capitalize",
            }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

        {activeSection === "overview" && (
          <div>
            {a.executiveSummary && (
              <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Executive Summary</div>
                <div style={{ fontSize: 12, color: "#c0c0d8", lineHeight: 1.6 }}>{a.executiveSummary}</div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Join or Create" value={a.joinOrCreate} />
              <Field label="Classification" value={a.classification} />
              <Field label="Confidence" value={a.confidence ? `${a.confidence}%` : null} />
              <Field label="KB Replication Grade" value={a.kbReplicationGrade} />
            </div>
            <Field label="Defendant" value={a.defendantProfile?.name !== "Unknown" ? `${a.defendantProfile?.name} — ${a.defendantProfile?.type || ""}` : null} />
            <Field label="Financial Health" value={a.defendantProfile?.financialHealth} />
            <Field label="Bankruptcy Risk" value={a.defendantProfile?.bankruptcyRisk} />
            <Field label="Prior Litigation" value={a.defendantProfile?.priorLitigation} />
            <Field label="Plaintiff Demographics" value={a.plaintiffProfile?.demographics} />
            <Field label="Required Injury" value={a.plaintiffProfile?.requiredInjury} />
            <Field label="Injury Timeframe" value={a.plaintiffProfile?.injuryTimeframe} />
            <Field label="Acquisition Hook" value={a.plaintiffProfile?.acquisitionHook} />
            <Field label="Disqualifiers" value={a.plaintiffProfile?.disqualifiers} />
            <Field label="Urgency Reason" value={a.timeline?.urgencyReason} />
            <Field label="SOL" value={a.timeline?.statuteOfLimitationsNote} />
            <Field label="Opportunity Window" value={a.timeline?.opportunityWindow} />
            <Field label="Top Risk" value={a.topRisk} />
            <Field label="Why Act Now" value={a.whyActNow} />
            {a.immediateNextSteps?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Immediate Next Steps</div>
                {a.immediateNextSteps.map((step, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#c0c0d8", marginBottom: 4 }}>• {typeof step === "string" ? step : JSON.stringify(step)}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === "legal" && (
          <div>
            {(a.causesOfAction || []).map((c, i) => (
              <div key={i} style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e0f0", marginBottom: 4 }}>{c.claim || c.cause || JSON.stringify(c)}</div>
                {c.statute && <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{c.statute}</div>}
                {c.strength && <div style={{ fontSize: 11, color: "#888" }}>Strength: {c.strength}</div>}
                {c.notes && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{c.notes}</div>}
              </div>
            ))}
            <Field label="Defense Strategy" value={a.defendantProfile?.defenseLikelyStrategy} />
            <Field label="Defendant Vulnerability" value={a.defendantProfile?.vulnerability} />
            <Field label="Settlement Status" value={a.existingLitigation?.settlementStatus} />
            <Field label="Active Federal Cases" value={a.existingLitigation?.activeFederalCases} />
            {a.existingLitigation?.leadFirmsInvolved?.length > 0 && (
              <Field label="Lead Firms" value={a.existingLitigation.leadFirmsInvolved.join(", ")} />
            )}
            <Field label="Opportunity Assessment" value={a.existingLitigation?.opportunityAssessment} />
            <Field label="Class Size" value={a.classProfile?.estimatedSize} />
            <Field label="Geographic Scope" value={a.classProfile?.geographicScope} />
            <Field label="Commonality" value={a.classProfile?.commonalityStrength} />
            {a.riskMatrix?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Risk Matrix</div>
                {a.riskMatrix.map((r, i) => (
                  <div key={i} style={{ marginBottom: 10, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0f0" }}>{r.risk || r.factor || JSON.stringify(r)}</div>
                    {r.severity && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Severity: {r.severity}</div>}
                    {r.mitigation && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Mitigation: {r.mitigation}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === "damages" && (
          <div>
            <div style={{ padding: "14px 16px", background: "rgba(34,197,94,0.06)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)", marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Per Claimant</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{a.damagesModel?.perClaimantRange || "Unknown"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Total Fund</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#E06050" }}>{a.damagesModel?.totalFundEstimate || "Unknown"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Fee to Firm (33%)</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>{a.damagesModel?.feeToFirmAt33Pct || "Unknown"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Comcast Compliant</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: a.damagesModel?.comcastCompliant ? "#22c55e" : "#ef4444" }}>
                    {a.damagesModel?.comcastCompliant === true ? "Yes" : a.damagesModel?.comcastCompliant === false ? "No" : "Unknown"}
                  </div>
                </div>
              </div>
              <Field label="Damages Theory" value={a.damagesModel?.theory} />
            </div>
            <Field label="Regulatory — FDA" value={a.regulatoryStatus?.fdaAction !== "None" ? a.regulatoryStatus?.fdaAction : null} />
            <Field label="Regulatory — CPSC" value={a.regulatoryStatus?.cpscAction !== "None" ? a.regulatoryStatus?.cpscAction : null} />
            <Field label="Regulatory — NHTSA" value={a.regulatoryStatus?.nhtsaAction !== "None" ? a.regulatoryStatus?.nhtsaAction : null} />
            <Field label="Regulatory — EPA" value={a.regulatoryStatus?.epaAction !== "None" ? a.regulatoryStatus?.epaAction : null} />
            <Field label="Regulatory — DOJ/AG" value={a.regulatoryStatus?.dojOrAgAction !== "None" ? a.regulatoryStatus?.dojOrAgAction : null} />
            {lead.url && (
              <a href={lead.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 12, fontSize: 12, color: "#C8442F", textDecoration: "none" }}>
                View Source Article →
              </a>
            )}
          </div>
        )}

        {activeSection === "chat" && <DrawerChat lead={lead} />}
        {activeSection === "memo" && <DrawerMemo lead={lead} />}
      </div>
    </div>
  );
}

// ── Opportunity detail drawer ──────────────────────────────────────────────────
function OppDetailDrawer({ opp, onClose }) {
  const sc = scoreColor(opp.combinedScore || 0);
  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 500,
        background: "var(--bg-drawer)", borderLeft: "1px solid var(--border)",
        zIndex: 500, display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
        overflowY: "auto",
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-drawer-hd)", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "rgba(200,68,47,0.2)", color: "#C8442F", border: "1px solid rgba(200,68,47,0.4)" }}>
                #{opp.rank}
              </span>
              <span style={{ fontSize: 28, fontWeight: 800, color: sc, lineHeight: 1 }}>{opp.combinedScore}</span>
              <span style={{ fontSize: 11, color: "#555" }}>/ {opp.probabilityOfSuccess}% P(win)</span>
              {opp.urgencyLevel && opp.urgencyLevel !== "LOW" && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${urgencyColor(opp.urgencyLevel)}18`, color: urgencyColor(opp.urgencyLevel) }}>
                  {opp.urgencyLevel}
                </span>
              )}
              {opp.firstMoverAdvantage && (
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>FIRST MOVER</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e0e0f0", lineHeight: 1.4 }}>{opp.opportunityName}</div>
            {opp.caseType && <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>{opp.caseType} · {opp.caseStage || ""}</div>}
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "6px 10px", color: "#888", cursor: "pointer", fontSize: 14, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Fund */}
        {(opp.estimatedFund && opp.estimatedFund !== "Unknown") && (
          <div style={{ padding: "14px 16px", background: "rgba(34,197,94,0.06)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Estimated Fund</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#E06050" }}>{opp.estimatedFund}</div>
              </div>
              {opp.estimatedFeeToFirm && opp.estimatedFeeToFirm !== "Unknown" && (
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Fee to Firm</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{opp.estimatedFeeToFirm}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Signal Count</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#9090c0" }}>{opp.signalCount} signals</div>
              </div>
              {opp.kbReplicationGrade && opp.kbReplicationGrade !== "Unknown" && (
                <div>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>KB Grade</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: opp.kbReplicationGrade <= "B" ? "#22c55e" : opp.kbReplicationGrade <= "C" ? "#f59e0b" : "#ef4444" }}>{opp.kbReplicationGrade}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Why pursue */}
        {opp.whyPursue?.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Why Pursue</div>
            {opp.whyPursue.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: "#c8c8e0", marginBottom: 6, lineHeight: 1.5 }}>• {r}</div>
            ))}
          </div>
        )}

        {/* Immediate action */}
        {opp.immediateAction && (
          <div style={{ padding: "12px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 8, border: "1px solid rgba(200,68,47,0.25)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Immediate Action</div>
            <div style={{ fontSize: 14, color: "#e0e0f0", fontWeight: 600, lineHeight: 1.5 }}>{opp.immediateAction}</div>
          </div>
        )}

        {/* Key risk */}
        {opp.keyRisk && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Key Risk</div>
            <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{opp.keyRisk}</div>
          </div>
        )}

        {/* Supporting signals */}
        {opp.supportingSignals?.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Supporting Signals</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {opp.supportingSignals.map((s, i) => (
                <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(100,100,150,0.12)", color: "#9090c0", border: "1px solid rgba(100,100,150,0.25)" }}>
                  {s.slice(0, 70)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
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
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedOpp, setSelectedOpp] = useState(null);

  const kvTotalRef = useRef(null);

  const fetchData = useCallback((silent = false) => {
    if (!silent) { setLeadsLoading(true); setOppsLoading(true); }
    // Fetch recent high-priority leads for dashboard — top 100 by score, then show 5 most recent
    fetch("/api/leads?limit=100&minScore=60")
      .then(r => r.json())
      .then(d => {
        const all = d.leads || [];
        // Sort by scannedAt descending so dashboard shows what's NEW, not just what's highest scored
        const sorted = [...all].sort((a, b) =>
          new Date(b.scannedAt || b.pubDate || 0) - new Date(a.scannedAt || a.pubDate || 0)
        );
        setLeads(sorted.slice(0, 5));
        setTotalLeads(d.total || all.length);
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLeadsLoading(false); });

    fetch("/api/leads?stats=1")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        // Stats API is authoritative for last scan time — never derive from individual leads
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
      {/* Drawers */}
      {(selectedLead || selectedOpp) && (
        <div
          onClick={() => { setSelectedLead(null); setSelectedOpp(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 499 }}
        />
      )}
      {selectedLead && <LeadDetailDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />}
      {selectedOpp && <OppDetailDrawer opp={selectedOpp} onClose={() => setSelectedOpp(null)} />}

      {/* ── Live indicator ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginBottom: -12 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
        <span style={{ fontSize: 11, color: "var(--text-6)" }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Live Intelligence</div>
              <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 2 }}>Top leads by score — click any row to view full report</div>
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
              {leads.map(lead => <LeadRow key={lead.id} lead={lead} onClick={() => setSelectedLead(lead)} />)}
            </div>
          )}
        </Card>

        {/* AI-synthesized opportunities */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Top Case Opportunities</div>
              <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 2 }}>AI-synthesized across all leads — click to expand in Leads Inbox</div>
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
              {opportunities.map((opp, i) => <OpportunityRow key={i} opp={opp} onClick={() => setSelectedOpp(opp)} />)}
            </div>
          )}
        </Card>
      </div>

      {/* ── Case pipeline + your top tracked cases ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Pipeline — bars, fully clickable */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 2 }}>Your Case Pipeline</div>
          <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 16 }}>Click any stage to filter your cases</div>

          {statusCounts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-6)", textAlign: "center", padding: "16px 0" }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>Your Top Cases</div>
              <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 2 }}>Ranked by opportunity score — click any case to open it</div>
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
