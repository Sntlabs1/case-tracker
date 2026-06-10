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
import Campaigns from "./tabs/Campaigns.jsx";
import TCPACases from "./tabs/TCPACases.jsx";
import Defendants from "./tabs/Defendants.jsx";
import PendingOutreach from "./tabs/PendingOutreach.jsx";
import Portfolio from "./tabs/Portfolio.jsx";
import Agents from "./tabs/Agents.jsx";
import BankruptcyCases from "./tabs/BankruptcyCases.jsx";
import DailyFeed from "./tabs/DailyFeed.jsx";
import SourceMonitor from "./tabs/SourceMonitor.jsx";
import CreditPortfolio from "./tabs/CreditPortfolio.jsx";
import ClaimantMatches from "./tabs/ClaimantMatches.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

const TABS = [
  { id: "dashboard",    label: "Dashboard" },
  { id: "leads",        label: "Leads Inbox" },
  { id: "dailyfeed",    label: "Daily Feed" },
  { id: "clients",      label: "Clients" },
  { id: "tcpa",         label: "TCPA Cases" },
  { id: "bankruptcy",   label: "Bankruptcy Cases" },
  { id: "defendants",   label: "Defendants" },
  { id: "outreach",     label: "Pending Outreach" },
  { id: "portfolio",    label: "Portfolio" },
  { id: "creditportfolio", label: "Credit Portfolio" },
  { id: "claimantmatches", label: "Claimant Matches" },
  { id: "campaigns",    label: "Campaigns" },
  { id: "intake",       label: "Intake Screen" },
  { id: "trends",       label: "Trends" },
  { id: "cases",        label: "Case Tracker" },
  { id: "scanner",      label: "AI Scanner" },
  { id: "intelligence", label: "Case Intelligence" },
  { id: "knowledge",    label: "Knowledge Base" },
  { id: "chat",         label: "Chat" },
  { id: "sources",      label: "Sources" },
  { id: "sourcemonitor", label: "Source Monitor" },
  { id: "agents",       label: "Agents" },
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
  dailyfeed:    {
    title: "Daily Feed",
    desc:  "Live scan feed with manual trigger and countdown to the next hourly cron. Runs the full backend scanner on demand and streams results as they arrive. Same lead data as Leads Inbox — this view is for monitoring scan activity and forcing a fresh pull.",
  },
  bankruptcy:   {
    title: "Bankruptcy Cases",
    desc:  "All federal bankruptcy filings matched against the client roster via PACER. Filter by chapter (7, 11, 12, 13), status, or debtor name. Case metadata only — no documents downloaded.",
  },
  tcpa:         {
    title: "TCPA Cases",
    desc:  "Every TCPA, FDCPA, and FCRA case the platform tracks — settled and active, federal and state. Search by defendant, filter by claim-window urgency, and drill into any case to see which credit.com clients are eligible plaintiffs.",
  },
  defendants:   {
    title: "Defendants",
    desc:  "The defendant / creditor catalog: every company ever named in a tracked TCPA / FDCPA / FCRA case. Click any defendant to see all their cases and every client in our database whose creditor history names them — the load-bearing cross-reference for the partnership match flow.",
  },
  outreach:     {
    title: "Pending Outreach",
    desc:  "(plaintiff, case) pairs that scored ≥ 80 and qualify=true — the daily action queue. Auto-populated by the match-recompute agent. Drafting a letter or dismissing a pair removes it from the queue; dismissed pairs stay sticky and won't reappear.",
  },
  portfolio:    {
    title: "Portfolio",
    desc:  "Aggregate recovery report across an entire partner's plaintiff universe. Total estimated $$$ recoverable (floor / ceiling per TCPA, FDCPA, FCRA statutory minimums plus per-claimant settlement amounts where known), top defendants and cases by exposure, claim windows closing within 30 days. Printable + CSV export — the deliverable you bring to a partner meeting.",
  },
  creditportfolio: {
    title: "Credit Portfolio",
    desc:  "Total dollar value of the credit.com dataset — 1.4M people matched against TCPA, FDCPA, FCRA, RESPA, Student Loan, Auto Lending, Data Breach, and Payday case types. Shows estimated recovery range, top defendants, and highest-priority matched individuals ready for intake.",
  },
  claimantmatches: {
    title: "Claimant Matches",
    desc:  "Every matched claimant joined to the specific cases they could bring, with plain-language reasoning for each connection and the supporting PACER / CourtListener dockets (metadata only). Filter by defendant, case type, state, or intake-readiness. Expand any claimant to see why each claim applies, the eligibility/SOL status, and the live dockets against that defendant.",
  },
  campaigns:    {
    title: "Campaigns",
    desc:  "Bulk outreach campaign manager. Select a lead, pick matching clients, and generate hundreds of personalized letters at once. Track each client through sent → responded → retained. Export a mail-merge CSV for any campaign.",
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
  sourcemonitor: {
    title: "Source Monitor",
    desc:  "Live health status for every data source. Shows last-checked time, up/degraded/down status, and error details for each integration. Pulls from the source-monitor agent rollup.",
  },
  agents:       {
    title: "Agents",
    desc:  "Recurring background jobs that keep the platform fresh. Each agent runs on a schedule, computes derived data into a rollup, and tells you when it last ran. Trigger any agent manually from this tab.",
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
  const [darkMode, setDarkMode] = useLocalStorage("tt-dark-mode", false);

  // Apply theme to body
  if (typeof document !== "undefined") {
    document.body.classList.toggle("dark", darkMode);
  }

  const SIDEBAR_W = 240;
  const [sidebarOpen, setSidebarOpen] = useLocalStorage("tt-sidebar-open", true);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)", color: "var(--text-1)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", display: "flex" }}>

      {/* ─── Floating reveal button (visible only when sidebar is hidden) ─── */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Show sidebar"
          aria-label="Show sidebar"
          style={{
            position: "fixed", top: 16, left: 16, zIndex: 200,
            width: 36, height: 36, borderRadius: 3,
            background: "var(--bg-card)", border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
            color: "var(--text-2)",
            cursor: "pointer", fontSize: 16, lineHeight: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-2)"; }}
        >
          ☰
        </button>
      )}

      {/* ─── Sidebar ─── */}
      <aside style={{
        width: sidebarOpen ? SIDEBAR_W : 0,
        flexShrink: 0,
        background: "var(--bg-drawer)",
        borderRight: sidebarOpen ? "1px solid rgba(255,255,255,0.10)" : "none",
        position: "sticky", top: 0, height: "100vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.22s ease",
      }}>
        {/* Brand */}
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(255,255,255,0.12)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 28 }}>
            <div style={{
              width: 38, height: 38, background: "rgba(255,255,255,0.18)", borderRadius: 3,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <BullIcon />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 2 }}>
                Ticket Toro
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#ffffff", letterSpacing: "0.005em", lineHeight: 1.1, fontFamily: "'Playfair Display', Georgia, serif" }}>
                Class Action Intel
              </div>
            </div>
          </div>
          {/* Collapse button */}
          <button
            onClick={() => setSidebarOpen(false)}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            style={{
              position: "absolute", top: 22, right: 14,
              width: 24, height: 24, borderRadius: 3,
              background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(255,255,255,0.60)",
              cursor: "pointer", fontSize: 12, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#ffffff"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.60)"; }}
          >
            ‹
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "14px 12px", overflowY: "auto" }}>
          <div style={{
            fontSize: 9, color: "rgba(255,255,255,0.38)", letterSpacing: "0.2em",
            textTransform: "uppercase", padding: "0 10px", marginBottom: 8,
          }}>
            Workspace
          </div>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  width: "100%",
                  padding: "9px 12px",
                  marginBottom: 1,
                  border: "none",
                  borderLeft: active ? "2px solid var(--nav-border-act)" : "2px solid transparent",
                  borderRadius: 2,
                  background: active ? "var(--nav-bg-act)" : "transparent",
                  color: active ? "var(--nav-text-act)" : "var(--nav-text)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  letterSpacing: "0.005em",
                  textAlign: "left",
                  transition: "all 0.12s",
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "#ffffff"; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--nav-text)"; } }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Footer: theme toggle + KB count */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.12)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setDarkMode(m => !m)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: 3, padding: "5px 9px", cursor: "pointer", fontSize: 13, lineHeight: 1, color: "rgba(255,255,255,0.75)" }}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#ffffff", lineHeight: 1 }}>{kbCases.length}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.50)", letterSpacing: "0.12em", textTransform: "uppercase" }}>KB Cases</div>
          </div>
        </div>
      </aside>

      {/* ─── Main column ─── */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Page header */}
        {PAGE_META[tab] && (
          <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface2)" }}>
            <div style={{ padding: "20px 32px" }}>
              <div style={{ fontSize: 9, color: "var(--text-6)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
                Workspace
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", marginBottom: 6, letterSpacing: "-0.01em" }}>
                {PAGE_META[tab].title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-5)", lineHeight: 1.6, maxWidth: 860 }}>
                {PAGE_META[tab].desc}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: "24px 32px", flex: 1 }}>
          <ErrorBoundary resetKey={tab}>
            {tab === "dashboard"    && <Dashboard cases={cases} setTab={setTab} setSelectedCase={setSelectedCase} setCaseFilter={setCaseFilter} />}
            {tab === "leads"        && <LeadsInbox cases={cases} setCases={setCases} onAddCase={() => setTab("cases")} />}
            {tab === "dailyfeed"    && <DailyFeed />}
            {tab === "clients"      && <Clients />}
            {tab === "tcpa"         && <TCPACases />}
            {tab === "bankruptcy"   && <BankruptcyCases />}
            {tab === "defendants"   && <Defendants />}
            {tab === "outreach"     && <PendingOutreach />}
            {tab === "portfolio"    && <Portfolio />}
            {tab === "campaigns"    && <Campaigns />}
            {tab === "intake"       && <Intake />}
            {tab === "trends"       && <Trends />}
            {tab === "cases"        && <CaseTracker cases={cases} setCases={setCases} selectedCase={selectedCase} setSelectedCase={setSelectedCase} showAI={showAI} setShowAI={setShowAI} caseFilter={caseFilter} />}
            {tab === "scanner"      && <AIScanner onAddCase={() => setTab("cases")} />}
            {tab === "intelligence" && <CaseIntelligence />}
            {tab === "knowledge"    && <KnowledgeBase cases={kbCases} setCases={setKbCases} />}
            {tab === "chat"         && <Chat cases={cases} />}
            {tab === "sources"      && <Sources />}
            {tab === "sourcemonitor"    && <SourceMonitor />}
            {tab === "creditportfolio" && <CreditPortfolio />}
            {tab === "claimantmatches" && <ClaimantMatches />}
            {tab === "agents"          && <Agents />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
