import { useState } from "react";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { initCases } from "./data/initCases.js";
import { KB_CASES } from "./data/knowledgeBase.js";
import Dashboard from "./tabs/Dashboard.jsx";
import CaseTracker from "./tabs/CaseTracker.jsx";
import SourceMonitor from "./tabs/SourceMonitor.jsx";
import AIScanner from "./tabs/AIScanner.jsx";
import KnowledgeBase from "./tabs/KnowledgeBase.jsx";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "cases",     label: "Case Tracker", icon: "⚖️" },
  { id: "sources",   label: "Source Monitor", icon: "🔍" },
  { id: "scanner",   label: "AI Scanner", icon: "🤖" },
  { id: "knowledge", label: "Knowledge Base", icon: "🧠" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [cases, setCases] = useLocalStorage("mdl-cases", initCases);
  const [kbCases, setKbCases] = useLocalStorage("mdl-kb-cases", KB_CASES);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showAI, setShowAI] = useState({});

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 50%,#16162a 100%)", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ background: "rgba(15,15,26,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚖️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>Class Action & MDL Analyzer</div>
            <div style={{ fontSize: 11, color: "#888" }}>Plaintiff Intelligence Platform · {kbCases.length} KB cases</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: tab === t.id ? "rgba(99,102,241,0.2)" : "transparent", color: tab === t.id ? "#a78bfa" : "#888", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.2s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {tab === "dashboard" && <Dashboard cases={cases} setTab={setTab} setSelectedCase={setSelectedCase} />}
        {tab === "cases"     && <CaseTracker cases={cases} setCases={setCases} selectedCase={selectedCase} setSelectedCase={setSelectedCase} showAI={showAI} setShowAI={setShowAI} />}
        {tab === "sources"   && <SourceMonitor />}
        {tab === "scanner"   && <AIScanner onAddCase={() => setTab("cases")} />}
        {tab === "knowledge" && <KnowledgeBase cases={kbCases} setCases={setKbCases} />}
      </div>
    </div>
  );
}
