import { useState } from "react";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { initCases } from "./data/initCases.js";
import { KB_CASES } from "./data/knowledgeBase.js";
import Dashboard from "./tabs/Dashboard.jsx";
import CaseTracker from "./tabs/CaseTracker.jsx";
import AIScanner from "./tabs/AIScanner.jsx";
import KnowledgeBase from "./tabs/KnowledgeBase.jsx";
import CaseIntelligence from "./tabs/CaseIntelligence.jsx";
import LeadsInbox from "./tabs/LeadsInbox.jsx";
import Trends from "./tabs/Trends.jsx";
import Chat from "./tabs/Chat.jsx";
import Sources from "./tabs/Sources.jsx";
import Clients from "./tabs/Clients.jsx";
import Intake from "./tabs/Intake.jsx";

const TABS = [
  { id: "dashboard",    label: "Dashboard" },
  { id: "leads",        label: "Leads Inbox" },
  { id: "clients",      label: "Clients" },
  { id: "intake",       label: "Intake Screen" },
  { id: "trends",       label: "Trends" },
  { id: "cases",        label: "Case Tracker" },
  { id: "scanner",      label: "AI Scanner" },
  { id: "intelligence", label: "Case Intelligence" },
  { id: "knowledge",    label: "Knowledge Base" },
  { id: "chat",         label: "Chat" },
  { id: "sources",      label: "Sources" },
];

const PAGE_META = {
  dashboard:    {
    title: "Dashboard",
    desc:  "Your command center. Live intelligence leads, top AI-synthesized case opportunities, and your case pipeline — all at a glance. Everything is clickable.",
  },
  leads:        {
    title: "Leads Inbox",
    desc:  "AI-scored leads pulled hourly from 50+ sources — FDA, NHTSA, CFPB, SEC, CourtListener, Reddit, PubMed, Google News, and more. Click any lead to expand a full litigation intelligence report. Use the filters to narrow by score, urgency, case type, or stage.",
  },
  clients:      {
    title: "Clients",
    desc:  "Import client databases from acquired law firms. Claude screens every client against active case leads and scores their eligibility as a plaintiff — matching injury profiles, medications, products, demographics, state, and exposure timeline.",
  },
  intake:       {
    title: "Intake Screen",
    desc:  "Screen inbound callers in real time. Enter the caller's injuries, medications, products, state, and age — Claude instantly scores them against the top 150 active leads and returns qualifying cases with specific intake questions to confirm eligibility.",
  },
  trends:       {
    title: "Trends",
    desc:  "Emerging patterns across the plaintiff litigation landscape. Track rising case types, filing volume trends, and settlement activity over time.",
  },
  cases:        {
    title: "Case Tracker",
    desc:  "Your active case pipeline. Add cases manually or push leads directly from the Leads Inbox. Track status from first signal through MDL consolidation, bellwether trials, and settlement. Click any case row to edit details or run an AI analysis.",
  },
  scanner:      {
    title: "AI Scanner",
    desc:  "Paste any article, filing, press release, or news story. Claude scores it against the 165 historical class actions in the Knowledge Base and returns a full litigation intelligence report — damages estimate, class definition, analogous cases, and immediate next steps.",
  },
  intelligence: {
    title: "Case Intelligence",
    desc:  "Causes of action library for plaintiff class actions. Browse legal theories — products liability, consumer fraud, securities fraud, antitrust, and more — with class certification requirements, historical win rates, and strategic notes for each.",
  },
  knowledge:    {
    title: "Knowledge Base",
    desc:  "165 historical class actions analyzed in depth. For each case: what worked, what failed, settlement amount, per-claimant payout, attorney fees, key evidence, corporate misconduct pattern, and a replication grade (A–F) for how well the strategy applies to new cases.",
  },
  chat:         {
    title: "Chat",
    desc:  "Ask Claude anything about your cases, the law, or your strategy. Claude has full context on your tracked cases and the entire Knowledge Base. Use this for legal research, plaintiff acquisition strategy, case theory development, or drafting memos.",
  },
  sources:      {
    title: "Sources",
    desc:  "Every data source the platform monitors. Includes all 50 state attorney general offices, federal regulatory agencies (FDA, NHTSA, CFPB, SEC, EPA, DOJ, EEOC), federal court filings via CourtListener, PubMed, Reddit complaint clusters, social media, and Google News.",
  },
};

// Ticket Toro bull silhouette
const BullIcon = () => (
  <svg width="20" height="20" viewBox="0 0 100 90" fill="white" xmlns="http://www.w3.org/2000/svg">
    <path d="M34 32 Q24 14 30 6 Q38 18 40 32" />
    <path d="M66 32 Q76 14 70 6 Q62 18 60 32" />
    <ellipse cx="50" cy="42" rx="22" ry="17" />
    <ellipse cx="50" cy="62" rx="28" ry="19" />
    <path d="M22 58 Q8 50 12 38" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
    <rect x="27" y="77" width="9" height="13" rx="4.5" />
    <rect x="39" y="79" width="9" height="11" rx="4.5" />
    <rect x="52" y="79" width="9" height="11" rx="4.5" />
    <rect x="64" y="77" width="9" height="13" rx="4.5" />
    <circle cx="42" cy="38" r="4" fill="#0b0c14" />
    <circle cx="58" cy="38" r="4" fill="#0b0c14" />
    <circle cx="44" cy="48" r="3" fill="#0b0c14" />
    <circle cx="56" cy="48" r="3" fill="#0b0c14" />
  </svg>
);

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [cases, setCases] = useLocalStorage("mdl-cases", initCases);
  const [kbCases, setKbCases] = useLocalStorage("mdl-kb-cases", KB_CASES);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showAI, setShowAI] = useState({});
  const [caseFilter, setCaseFilter] = useState({});
  const [lightMode, setLightMode] = useLocalStorage("tt-light-mode", false);

  // Apply theme to body
  if (typeof document !== "undefined") {
    document.body.classList.toggle("light", lightMode);
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", color: "var(--text-1)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", overflowX: "hidden" }}>

      {/* Header */}
      <div style={{ background: "var(--bg-header)", borderBottom: "1px solid var(--border)", backdropFilter: "blur(16px)", position: "sticky", top: 0, zIndex: 100, height: 58, overflowX: "hidden" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "stretch", height: "100%" }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, paddingRight: 16 }}>
          <div style={{ width: 36, height: 36, background: "#C8442F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BullIcon />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.14em", color: "var(--text-1)", fontFamily: "'Playfair Display', Georgia, serif", textTransform: "uppercase", lineHeight: 1.1 }}>
              Ticket Toro
            </div>
            <div style={{ fontSize: 9, color: "var(--text-6)", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 2 }}>
              Class Action Intelligence
            </div>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", alignItems: "stretch", flex: 1, overflowX: "auto", scrollbarWidth: "none" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "0 12px",
                border: "none",
                borderBottom: tab === t.id ? "2px solid #C8442F" : "2px solid transparent",
                borderTop: "2px solid transparent",
                background: "transparent",
                color: tab === t.id ? "var(--text-1)" : "var(--text-6)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: tab === t.id ? 600 : 400,
                letterSpacing: "0.02em",
                transition: "color 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right: theme toggle + KB count */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 16, borderLeft: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={() => setLightMode(m => !m)}
            title={lightMode ? "Switch to dark mode" : "Switch to light mode"}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-md)", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 14, lineHeight: 1, color: "var(--text-4)" }}
          >
            {lightMode ? "🌙" : "☀️"}
          </button>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#C8442F", lineHeight: 1 }}>{kbCases.length}</div>
            <div style={{ fontSize: 9, color: "var(--text-6)", letterSpacing: "0.12em", textTransform: "uppercase" }}>KB Cases</div>
          </div>
        </div>
      </div>
      </div>

      {/* Page header — title + description for each tab */}
      {PAGE_META[tab] && (
        <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface2)" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 24px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
              {PAGE_META[tab].title}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-6)", lineHeight: 1.6, maxWidth: 860 }}>
              {PAGE_META[tab].desc}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "24px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {tab === "dashboard"    && <Dashboard cases={cases} setTab={setTab} setSelectedCase={setSelectedCase} setCaseFilter={setCaseFilter} />}
        {tab === "leads"        && <LeadsInbox cases={cases} setCases={setCases} onAddCase={() => setTab("cases")} />}
        {tab === "clients"      && <Clients />}
        {tab === "intake"       && <Intake />}
        {tab === "trends"       && <Trends />}
{tab === "cases"        && <CaseTracker cases={cases} setCases={setCases} selectedCase={selectedCase} setSelectedCase={setSelectedCase} showAI={showAI} setShowAI={setShowAI} caseFilter={caseFilter} />}
        {tab === "scanner"      && <AIScanner onAddCase={() => setTab("cases")} />}
        {tab === "intelligence" && <CaseIntelligence />}
        {tab === "knowledge"    && <KnowledgeBase cases={kbCases} setCases={setKbCases} />}
        {tab === "chat"         && <Chat cases={cases} />}
        {tab === "sources"      && <Sources />}
      </div>
    </div>
  );
}
