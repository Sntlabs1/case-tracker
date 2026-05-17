import { useState, useRef, useEffect, useCallback } from "react";
import { Card, Btn } from "../components/UI.jsx";
import { KB_RUBRIC } from "../lib/kbRubric.js";
import { KB_CASES } from "../data/knowledgeBase.js";

const CHAT_KEY = "mdl-chat-messages";
const MAX_MSGS = 60; // max messages to persist

// ─── KB COMPACT SUMMARY (computed once at module load) ────────────────────────
// ~500 chars per case × 150 cases ≈ 75KB — included in every system prompt

const KB_SUMMARY = KB_CASES.map(c => {
  const a = c.analysis || {};
  const lines = [
    `#${c.id} ${c.name} | ${c.type} | ${c.year || "?"} | Settlement: ${c.settlementAmount || "?"} | Plaintiffs: ${c.plaintiffs || "?"}`,
    `Defendant: ${c.defendant || "?"} | Rating: ${a.rating || "?"} | Strength: ${a.strengthScore || "?"}/10 | Years to resolve: ${a.litigationYears || "?"}`,
  ];
  if (c.summary)                     lines.push(`Summary: ${c.summary.slice(0, 160)}`);
  if (a.whyItWorked)                 lines.push(`Why it worked: ${a.whyItWorked.slice(0, 200)}`);
  if (a.challenges)                  lines.push(`Challenges: ${a.challenges.slice(0, 160)}`);
  if (a.replicationModel)            lines.push(`Replication model: ${a.replicationModel.slice(0, 200)}`);
  if (a.watchOut)                    lines.push(`Watch out: ${a.watchOut.slice(0, 160)}`);
  if (a.demographics)                lines.push(`Demographics: ${a.demographics.slice(0, 120)}`);
  if (a.clientAcquisitionStrategy)   lines.push(`Client acquisition: ${a.clientAcquisitionStrategy.slice(0, 160)}`);
  if (a.payoutPerClaimant)           lines.push(`Per claimant: ${a.payoutPerClaimant}`);
  if (a.strategiesWon?.length)       lines.push(`Strategies won: ${a.strategiesWon.slice(0, 3).join("; ")}`);
  if (a.keyEvidence)                 lines.push(`Key evidence: ${a.keyEvidence.slice(0, 140)}`);
  return lines.join("\n");
}).join("\n---\n");

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt(cases, leads) {
  const caseList = cases.length
    ? cases.map(c => `- ${c.title} | ${c.caseType} | Score: ${c.score} | Status: ${c.status} | Priority: ${c.priority}${c.company ? ` | Defendant: ${c.company}` : ""}`).join("\n")
    : "No cases tracked yet.";

  const leadList = leads.length
    ? leads.slice(0, 30).map(l => {
        const a = l.analysis || {};
        return `- ${a.headline || l.title} | ${a.caseType || "?"} | Score: ${a.score ?? "?"} | ${a.opportunityStatus || "?"} | ${a.targetingReadiness || "?"} | Source: ${l.source}`;
      }).join("\n")
    : "No leads in feed yet.";

  return `You are a senior class action litigation strategist and expert on the Ticket Toro plaintiff intelligence platform. You speak directly and practically — this is a professional tool, not an educational exercise.

You have access to:
1. A 150-case knowledge base of historical class actions (provided below)
2. The user's active case tracker (${cases.length} cases)
3. The user's daily intelligence feed (${leads.length} leads)
4. The platform's scoring rubric

You ALSO have live tools to query the platform's real database. Use them aggressively whenever a question is about current state — never guess from the static KB when live tools can answer:

CASE / DEFENDANT TOOLS:
- get_platform_state — counts, last-updated timestamps, scan health, watchlist, top defendants, trends. Call this at the start of most conversations.
- search_cases — query the 500+ ingested TCPA / FDCPA / FCRA cases by defendant, type, status, state, or keyword
- get_case — fetch full detail for one case by ID (settlement, conduct, source URL)
- search_defendants — find a defendant entity (Equifax, Capital One, etc.) and see how many cases it appears on
- get_defendant_cases — list every case for one canonical defendant
- search_leads — query the intelligence leads inbox by score/keyword
- get_source_health — see which of the 38 external data sources are up/degraded/down right now

PLAINTIFF / CLIENT TOOLS — use these when the user names a PERSON (one of OUR clients):
- search_clients — find a plaintiff by name / phone / email / state / partner
- get_client — full profile including their creditor / debt-buyer history
- get_client_matches — every TCPA case this plaintiff qualifies for, with score, claim deadline, and dollar recovery estimate per case
- estimate_client_recovery — just the dollar summary (total floor / ceiling / midpoint, breakdown by case type, top 5 matches)

How to answer "what is <plaintiff> eligible for":
  1. search_clients(name) → find them (returns id + match count)
  2. get_client_matches(id) → returns qualifying cases with $ estimates
  3. Answer in plain English: "<Name> qualifies for N cases totaling $X–$Y. Strongest: <caption>, score <S>. Claim window closes in <D> days for <case>..."

How eligibility / scoring works (so you can explain WHY a match qualifies or fails):
  • Hard disqualifiers: tcpaOptOut=true, already-claimed settlement, case status=claim_closed, statute of limitations >4y since most recent contact
  • Score signals (out of 100): +40 defendant exact match (canonical ID hit in client.collectionsHistory ↔ case.defendants), +25 defendant family / substring match, +15 state eligibility (or nationwide class), +15 residency window overlaps class period, +10 valid US phone, +5 prior TCPA/FDCPA familiarity in existingCases
  • Qualifies = true requires score ≥ 50 AND no disqualifiers — and crucially, a defendant link (max score WITHOUT defendant is 45, so it caps under threshold)
  • Recovery model: settled cases with parseable per-claimant amounts use that; otherwise TCPA $500–$1500/violation (47 USC § 227(b)(3)), FDCPA $500–$1000 (15 USC § 1692k), FCRA $100–$1000 (15 USC § 1681n); violation count from contactDates / contactMethods, default 1

When answering:
- Reference specific case IDs and names — from the live database when relevant, from the KB for historical strategy
- Give frank, actionable assessments — not hedged generalities
- If asked "how many cases against X" or "what's our biggest settlement" or "is X feed working" — call a tool, do not guess
- If asked to compare a lead to the KB, do it with specific case analogies and scores
- If asked about plaintiff targeting, give specific channels, demographics, and hooks
- If a plaintiff query returns nothing, suggest checking the Clients tab for the partner / state / name spelling expected

---
SCORING RUBRIC:
${KB_RUBRIC}

---
KNOWLEDGE BASE — 150 HISTORICAL CLASS ACTIONS:
${KB_SUMMARY}

---
ACTIVE CASE TRACKER (${cases.length} cases):
${caseList}

---
DAILY FEED LEADS (${leads.length} total; top 30 shown):
${leadList}

---
PLATFORM SOURCES MONITORED HOURLY:
Federal RSS: FDA recalls/safety alerts, SEC litigation/enforcement, FTC, DOJ press releases, EEOC, DOL, HHS, EPA enforcement, CFPB, JPML MDL orders
Google News: 45+ queries — pharma, auto defect, PFAS, data breach, securities fraud, DOJ criminal enforcement, AG investigations, False Claims Act, RICO, accounting restatements, SEC subpoenas, material weakness, stock drop
Reddit: 25+ subreddits (legal, medicine, finance, consumer, employment) + complaint cluster analysis for pre-litigation signal detection
SEC EDGAR: Targeted searches for subpoena disclosures in 8-K, material weakness in 10-K, restatements, NT 10-K late filers, securities class action disclosures
CourtListener: Class action opinions, new filings, fraud/RICO/FCA/securities dockets (nature of suit 375, 376, 470, 850)
APIs: NHTSA vehicle recalls, CFPB complaint database, PubMed medical research, YouTube (if key configured)
Claude web search: 30+ targeted queries including DOJ criminal fraud convictions, multistate AG settlements, securities class action filings, accounting fraud`;
}

// ─── STREAMING CALL ───────────────────────────────────────────────────────────
//
// The /api/chat endpoint streams a mixed SSE feed: tool_use / tool_result
// events for transparency, plus standard content_block_delta events for the
// final assistant text. We parse named events (event: foo\ndata: {...}) and
// the default data-only events.
async function streamClaude(apiMessages, systemPrompt, { onText, onToolUse, onToolResult }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMessages, system: systemPrompt }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";

  // SSE parsing — split on blank lines (event boundaries), each event has
  // optional `event:` line + one or more `data:` lines.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, boundary);
      buf = buf.slice(boundary + 2);
      let eventName = null;
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      const dataStr = dataLines.join("\n");
      if (dataStr === "[DONE]") continue;
      let evt;
      try { evt = JSON.parse(dataStr); } catch { continue; }

      if (eventName === "error" || evt.type === "error") {
        throw new Error(evt.error?.message || evt.message || "Stream error");
      }
      if (eventName === "tool_use" && onToolUse) {
        onToolUse(evt);
        continue;
      }
      if (eventName === "tool_result" && onToolResult) {
        onToolResult(evt);
        continue;
      }
      if (eventName === "done") continue;
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        text += evt.delta.text;
        onText(text);
      }
    }
  }
  return text;
}

// ─── TOOL-CALL CHIPS ──────────────────────────────────────────────────────────

const TOOL_LABELS = {
  get_platform_state:   "Reading platform state",
  search_cases:         "Searching cases",
  get_case:             "Loading case",
  search_defendants:    "Searching defendants",
  get_defendant_cases:  "Listing defendant's cases",
  search_leads:         "Searching leads",
  get_source_health:    "Checking source health",
};

function fmtToolInput(name, input) {
  if (!input) return "";
  if (name === "search_cases") {
    const parts = [];
    if (input.defendant) parts.push(`defendant: ${input.defendant}`);
    if (input.caseType)  parts.push(input.caseType);
    if (input.status)    parts.push(input.status);
    if (input.state)     parts.push(input.state);
    if (input.keyword)   parts.push(`"${input.keyword}"`);
    return parts.join(" · ");
  }
  if (name === "search_defendants") return input.name;
  if (name === "search_leads")      return input.keyword || `score ≥ ${input.minScore || 0}`;
  if (name === "get_case")          return input.id;
  if (name === "get_defendant_cases") return input.canonicalId;
  return "";
}

function ToolChips({ events }) {
  if (!events?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
      {events.map((e, i) => {
        const label = TOOL_LABELS[e.name] || e.name;
        const argLine = fmtToolInput(e.name, e.input);
        let dotColor = "#f59e0b"; // running
        if (e.status === "ok") dotColor = "#22c55e";
        else if (e.status === "error") dotColor = "#ef4444";
        return (
          <div key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 10px", borderRadius: 7,
            background: "rgba(94,234,212,0.05)",
            border: "1px solid rgba(94,234,212,0.15)",
            fontSize: 11, color: "var(--text-4)",
            alignSelf: "flex-start",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{label}</span>
            {argLine && <span style={{ color: "var(--text-6)" }}>· {argLine}</span>}
            {e.status === "ok" && e.summary && (
              <span style={{ color: "var(--text-5)" }}>→ {e.summary}</span>
            )}
            {e.status === "error" && e.error && (
              <span style={{ color: "#f87171" }}>error: {e.error.slice(0, 80)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── MARKDOWN RENDERER ────────────────────────────────────────────────────────

function InlineText({ text }) {
  const parts = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const s = m[0];
    if      (s.startsWith("**")) parts.push(<strong key={m.index} style={{ color: "#e0e0f0", fontWeight: 700 }}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("*"))  parts.push(<em     key={m.index} style={{ color: "#d0d0e8" }}>{s.slice(1, -1)}</em>);
    else parts.push(<code key={m.index} style={{ background: "#0d0e18", borderRadius: 4, padding: "1px 6px", fontSize: "0.88em", color: "var(--accent)", fontFamily: "monospace" }}>{s.slice(1, -1)}</code>);
    last = m.index + s.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Markdown({ text }) {
  const lines   = text.split("\n");
  const els     = [];
  let   k       = 0;
  let   listBuf = [];
  let   listOl  = false;
  let   inCode  = false;
  let   codeBuf = [];

  const flushList = () => {
    if (!listBuf.length) return;
    const Tag = listOl ? "ol" : "ul";
    els.push(
      <Tag key={k++} style={{ paddingLeft: 20, margin: "6px 0" }}>
        {listBuf.map((item, i) => (
          <li key={i} style={{ marginBottom: 4, color: "#c8c8e0", lineHeight: 1.65 }}>
            <InlineText text={item} />
          </li>
        ))}
      </Tag>
    );
    listBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.startsWith("```")) {
      if (!inCode) { flushList(); inCode = true; codeBuf = []; }
      else {
        els.push(
          <pre key={k++} style={{ background: "#0d0e18", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#a8a8c0", overflowX: "auto", margin: "8px 0", fontFamily: "monospace", lineHeight: 1.55 }}>
            {codeBuf.join("\n")}
          </pre>
        );
        inCode = false;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // Headings
    if (line.startsWith("### ")) {
      flushList();
      els.push(<div key={k++} style={{ fontWeight: 700, fontSize: 13, color: "#e0e0f0", marginTop: 14, marginBottom: 4 }}><InlineText text={line.slice(4)} /></div>);
    } else if (line.startsWith("## ")) {
      flushList();
      els.push(<div key={k++} style={{ fontWeight: 700, fontSize: 14, color: "#e0e0f0", marginTop: 16, marginBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 4 }}><InlineText text={line.slice(3)} /></div>);
    } else if (line.startsWith("# ")) {
      flushList();
      els.push(<div key={k++} style={{ fontWeight: 800, fontSize: 15, color: "#e0e0f0", marginTop: 16, marginBottom: 6 }}><InlineText text={line.slice(2)} /></div>);
    }
    // Bullet list
    else if (/^[-*•] /.test(line)) {
      if (listOl) flushList();
      listOl = false;
      listBuf.push(line.replace(/^[-*•] /, ""));
    }
    // Ordered list
    else if (/^\d+\. /.test(line)) {
      if (!listOl) flushList();
      listOl = true;
      listBuf.push(line.replace(/^\d+\. /, ""));
    }
    // HR
    else if (/^---+$/.test(line.trim())) {
      flushList();
      els.push(<hr key={k++} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.07)", margin: "10px 0" }} />);
    }
    // Blank line
    else if (line.trim() === "") {
      flushList();
      if (els.length) els.push(<div key={k++} style={{ height: 6 }} />);
    }
    // Paragraph
    else {
      flushList();
      els.push(<div key={k++} style={{ color: "#c8c8e0", lineHeight: 1.7, marginBottom: 1 }}><InlineText text={line} /></div>);
    }
  }

  flushList();
  if (inCode && codeBuf.length) {
    els.push(<pre key={k++} style={{ background: "#0d0e18", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#a8a8c0", overflowX: "auto", margin: "8px 0", fontFamily: "monospace" }}>{codeBuf.join("\n")}</pre>);
  }
  return <>{els}</>;
}

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

function loadMessages()   { try { return JSON.parse(localStorage.getItem(CHAT_KEY)          || "[]"); } catch { return []; } }
function saveMessages(m)  { try { localStorage.setItem(CHAT_KEY, JSON.stringify(m.slice(-MAX_MSGS))); } catch {} }
function loadFeedLeads()  { try { return JSON.parse(localStorage.getItem("mdl-feed-leads")  || "[]"); } catch { return []; } }

// ─── SUGGESTED QUESTIONS ─────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What are the top 5 cases in the KB to replicate right now, and why?",
  "Compare my current feed leads to the knowledge base — what stands out?",
  "Walk me through the scoring rubric — what moves a case from INVESTIGATE to CREATE?",
  "Which case types historically have the highest attorney fee potential per year?",
  "Show me all A+ and A rated cases with their client acquisition strategies",
  "What DOJ criminal convictions should I be monitoring for civil plaintiff opportunities?",
  "How do I use SEC subpoena disclosures and restatements to find securities targets?",
  "What are the biggest failure modes that kill cases at class certification?",
];

// ─── TYPING DOTS ─────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", opacity: 0.5,
          animation: `tdot 1.2s ${i * 0.4}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function Chat({ cases }) {
  const [messages,   setMessages]   = useState(() => loadMessages());
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolEvents, setToolEvents] = useState([]); // [{name, status, summary, error}]
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Auto-scroll to bottom when messages, stream, or tool events update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText, toolEvents]);

  const send = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");

    const userMsg  = { role: "user",      content, ts: new Date().toISOString() };
    const history  = [...messages, userMsg];
    setMessages(history);
    saveMessages(history);

    setLoading(true);
    setStreamText("");
    setToolEvents([]);

    const leads        = loadFeedLeads();
    const systemPrompt = buildSystemPrompt(cases, leads);
    const apiMessages  = history.map(m => ({ role: m.role, content: m.content }));

    const turnEvents = [];

    try {
      const full = await streamClaude(apiMessages, systemPrompt, {
        onText: (chunk) => setStreamText(chunk),
        onToolUse: (evt) => {
          turnEvents.push({ id: evt.id, name: evt.name, input: evt.input, status: "running" });
          setToolEvents([...turnEvents]);
        },
        onToolResult: (evt) => {
          const idx = turnEvents.findIndex((t) => t.id === evt.id);
          if (idx >= 0) {
            turnEvents[idx] = { ...turnEvents[idx], status: evt.ok ? "ok" : "error", summary: evt.summary, error: evt.error };
            setToolEvents([...turnEvents]);
          }
        },
      });
      const assistantMsg = { role: "assistant", content: full, ts: new Date().toISOString(), toolEvents: turnEvents };
      const final = [...history, assistantMsg];
      setMessages(final);
      saveMessages(final);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}`, ts: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setStreamText("");
      setToolEvents([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, cases, input, loading]);

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(CHAT_KEY);
  };

  const leads    = loadFeedLeads();
  const isEmpty  = messages.length === 0 && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)", maxHeight: 920 }}>
      <style>{`
        @keyframes tdot { 0%,100% { opacity:0.3; transform:scale(0.8); } 50% { opacity:1; transform:scale(1.15); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e0e0f0" }}>Platform Intelligence Chat</h2>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{KB_CASES.length} KB cases</span>
            <span>·</span>
            <span>{cases.length} tracked cases</span>
            <span>·</span>
            <span>{leads.length} feed leads</span>
            <span>·</span>
            <span style={{ color: "#444" }}>claude-sonnet-4-6 · streaming</span>
          </div>
        </div>
        {messages.length > 0 && (
          <Btn small variant="secondary" onClick={clearChat}>Clear chat</Btn>
        )}
      </div>

      {/* Message area */}
      <div style={{ flex: 1, overflowY: "auto", marginBottom: 12, paddingRight: 2 }}>

        {isEmpty ? (
          /* Empty state — suggestions */
          <div>
            <Card style={{ marginBottom: 14, padding: "20px 24px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e0f0", marginBottom: 6 }}>What can I help you with?</div>
              <div style={{ fontSize: 13, color: "#666", lineHeight: 1.65 }}>
                I have full access to all {KB_CASES.length} KB cases with complete analysis, your {cases.length} tracked cases, and {leads.length} current feed leads.
                Ask anything about cases, plaintiff targeting, strategy, scoring, or what to act on right now.
              </div>
            </Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  style={{ textAlign: "left", padding: "11px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, cursor: "pointer", fontSize: 12, color: "#a0a0b8", lineHeight: 1.55, fontFamily: "inherit", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(94,234,212,0.45)"; e.currentTarget.style.color = "#c8c8e0"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#a0a0b8"; }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message history */
          <>
            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 18, display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {/* Label */}
                <div style={{ fontSize: 10, color: "#3a3a4a", marginBottom: 3, paddingLeft: msg.role === "user" ? 0 : 2, paddingRight: msg.role === "user" ? 2 : 0 }}>
                  {msg.role === "user" ? "You" : "Ticket Toro AI"}
                  {msg.ts && <> · {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>}
                </div>
                {msg.role === "user" ? (
                  /* User bubble */
                  <div style={{ maxWidth: "72%", padding: "10px 14px", background: "rgba(94,234,212,0.13)", border: "1px solid rgba(94,234,212,0.28)", borderRadius: "12px 12px 3px 12px", fontSize: 13, color: "#e0e0f0", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant bubble */
                  <div style={{ maxWidth: "94%" }}>
                    {msg.toolEvents?.length > 0 && <ToolChips events={msg.toolEvents} />}
                    <div style={{ padding: "14px 18px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px 12px 12px 12px", fontSize: 13, lineHeight: 1.65 }}>
                      <Markdown text={msg.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Streaming in-progress */}
            {loading && (
              <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <div style={{ fontSize: 10, color: "#3a3a4a", marginBottom: 3, paddingLeft: 2 }}>
                  Ticket Toro AI · now
                </div>
                <div style={{ maxWidth: "94%" }}>
                  {toolEvents.length > 0 && <ToolChips events={toolEvents} />}
                  {(streamText || toolEvents.length === 0) && (
                    <div style={{ padding: "14px 18px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(94,234,212,0.18)", borderRadius: "3px 12px 12px 12px", fontSize: 13, lineHeight: 1.65 }}>
                      {streamText ? <Markdown text={streamText} /> : <TypingDots />}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder="Ask anything about your cases, leads, strategy, or the platform...  (Enter to send · Shift+Enter for new line)"
          rows={2}
          disabled={loading}
          style={{ flex: 1, background: "#0d0e18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#e0e0f0", resize: "none", outline: "none", lineHeight: 1.6, fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}
        />
        <Btn
          onClick={() => send(input)}
          style={{ alignSelf: "stretch", minWidth: 72, opacity: loading || !input.trim() ? 0.45 : 1 }}>
          {loading ? "..." : "Send"}
        </Btn>
      </div>
    </div>
  );
}
