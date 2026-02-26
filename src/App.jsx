import { useState } from "react";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { initCases } from "./data/initCases.js";
import { KB_CASES } from "./data/knowledgeBase.js";
import Dashboard from "./tabs/Dashboard.jsx";
import CaseTracker from "./tabs/CaseTracker.jsx";
import AIScanner from "./tabs/AIScanner.jsx";
import KnowledgeBase from "./tabs/KnowledgeBase.jsx";
import CaseIntelligence from "./tabs/CaseIntelligence.jsx";
import DailyFeed from "./tabs/DailyFeed.jsx";
import LeadsInbox from "./tabs/LeadsInbox.jsx";
import Trends from "./tabs/Trends.jsx";
import Chat from "./tabs/Chat.jsx";
import Sources from "./tabs/Sources.jsx";

const TABS = [
  { id: "dashboard",    label: "Dashboard" },
  { id: "leads",        label: "Leads Inbox" },
  { id: "trends",       label: "Trends" },
  { id: "feed",         label: "Daily Feed" },
  { id: "cases",        label: "Case Tracker" },
  { id: "scanner",      label: "AI Scanner" },
  { id: "intelligence", label: "Case Intelligence" },
  { id: "knowledge",    label: "Knowledge Base" },
  { id: "chat",         label: "Chat" },
  { id: "sources",      label: "Sources" },
];

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

  return (
    <div style={{ minHeight: "100vh", background: "#0b0c14", color: "#e8e8f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ background: "rgba(10,11,18,0.98)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 32px", display: "flex", justifyContent: "space-between", alignItems: "stretch", backdropFilter: "blur(16px)", position: "sticky", top: 0, zIndex: 100, height: 58 }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, flexShrink: 0, paddingRight: 32 }}>
          <div style={{ width: 36, height: 36, background: "#C8442F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BullIcon />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.14em", color: "#fff", fontFamily: "'Playfair Display', Georgia, serif", textTransform: "uppercase", lineHeight: 1.1 }}>
              Ticket Toro
            </div>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 2 }}>
              Class Action Intelligence
            </div>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "0 20px",
                border: "none",
                borderBottom: tab === t.id ? "2px solid #C8442F" : "2px solid transparent",
                borderTop: "2px solid transparent",
                background: "transparent",
                color: tab === t.id ? "#ffffff" : "#555",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: tab === t.id ? 600 : 400,
                letterSpacing: "0.02em",
                transition: "color 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right: KB count */}
        <div style={{ display: "flex", alignItems: "center", paddingLeft: 24, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#C8442F", lineHeight: 1 }}>{kbCases.length}</div>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase" }}>KB Cases</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "28px 32px", maxWidth: 1400, margin: "0 auto" }}>
        {tab === "dashboard"    && <Dashboard cases={cases} setTab={setTab} setSelectedCase={setSelectedCase} />}
        {tab === "leads"        && <LeadsInbox cases={cases} setCases={setCases} onAddCase={() => setTab("cases")} />}
        {tab === "trends"       && <Trends />}
        {tab === "feed"         && <DailyFeed cases={cases} setCases={setCases} setTab={setTab} kbCases={kbCases} setKbCases={setKbCases} />}
        {tab === "cases"        && <CaseTracker cases={cases} setCases={setCases} selectedCase={selectedCase} setSelectedCase={setSelectedCase} showAI={showAI} setShowAI={setShowAI} />}
        {tab === "scanner"      && <AIScanner onAddCase={() => setTab("cases")} />}
        {tab === "intelligence" && <CaseIntelligence />}
        {tab === "knowledge"    && <KnowledgeBase cases={kbCases} setCases={setKbCases} />}
        {tab === "chat"         && <Chat cases={cases} />}
        {tab === "sources"      && <Sources />}
      </div>
    </div>
  );
}
