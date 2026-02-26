import { useState, useRef, useEffect, useCallback } from "react";
import { Card, Btn } from "../components/UI.jsx";
import { KB_RUBRIC } from "../lib/kbRubric.js";
import { KB_CASES } from "../data/knowledgeBase.js";

const API_KEY  = import.meta.env.VITE_ANTHROPIC_API_KEY;
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

You have full access to:
1. A 150-case knowledge base of historical class actions with full ratings, strategy, demographics, and acquisition analysis
2. The user's active case tracker (${cases.length} cases)
3. The user's daily intelligence feed (${leads.length} leads)
4. The platform's scoring rubric

When answering:
- Reference specific case IDs and names from the knowledge base
- Give frank, actionable assessments — not hedged generalities
- If asked to compare a lead to the KB, do it with specific case analogies and scores
- If asked about plaintiff targeting, give specific channels, demographics, and hooks
- If asked about case strategy, reference specific KB cases that succeeded or failed with that approach

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

async function streamClaude(apiMessages, systemPrompt, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: apiMessages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buf  = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const evt = JSON.parse(raw);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          text += evt.delta.text;
          onChunk(text);
        }
      } catch { /* ignore parse errors on malformed SSE chunks */ }
    }
  }
  return text;
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
    else parts.push(<code key={m.index} style={{ background: "#0d0e18", borderRadius: 4, padding: "1px 6px", fontSize: "0.88em", color: "#E06050", fontFamily: "monospace" }}>{s.slice(1, -1)}</code>);
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
        <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#C8442F", opacity: 0.5,
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
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Auto-scroll to bottom when messages or stream updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

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

    const leads        = loadFeedLeads();
    const systemPrompt = buildSystemPrompt(cases, leads);
    const apiMessages  = history.map(m => ({ role: m.role, content: m.content }));

    try {
      const full = await streamClaude(apiMessages, systemPrompt, chunk => {
        setStreamText(chunk);
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
      const assistantMsg = { role: "assistant", content: full, ts: new Date().toISOString() };
      const final = [...history, assistantMsg];
      setMessages(final);
      saveMessages(final);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}`, ts: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setStreamText("");
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
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(200,68,47,0.45)"; e.currentTarget.style.color = "#c8c8e0"; }}
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
                  <div style={{ maxWidth: "72%", padding: "10px 14px", background: "rgba(200,68,47,0.13)", border: "1px solid rgba(200,68,47,0.28)", borderRadius: "12px 12px 3px 12px", fontSize: 13, color: "#e0e0f0", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant bubble */
                  <div style={{ maxWidth: "94%", padding: "14px 18px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px 12px 12px 12px", fontSize: 13, lineHeight: 1.65 }}>
                    <Markdown text={msg.content} />
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
                <div style={{ maxWidth: "94%", padding: "14px 18px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(200,68,47,0.18)", borderRadius: "3px 12px 12px 12px", fontSize: 13, lineHeight: 1.65 }}>
                  {streamText ? <Markdown text={streamText} /> : <TypingDots />}
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
