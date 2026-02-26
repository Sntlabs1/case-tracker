import { useState, useCallback, useEffect, useRef } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";
import { QUICK_TRIAGE_PROMPT, DEEP_ANALYSIS_PROMPT } from "../lib/kbRubric.js";

const API_KEY         = import.meta.env.VITE_ANTHROPIC_API_KEY;
const LEADS_KEY       = "mdl-feed-leads";
const SEEN_KEY        = "mdl-feed-seen";
const LAST_SCAN_KEY   = "mdl-feed-last-scan";
const INTERVAL_KEY    = "mdl-feed-interval";
const THIRTY_DAYS     = 30 * 24 * 60 * 60 * 1000;
const MAX_LEADS       = 300;

const SCAN_INTERVALS  = [
  { short: "15m", hours: 0.25 },
  { short: "30m", hours: 0.5  },
  { short: "1h",  hours: 1    },
  { short: "2h",  hours: 2    },
  { short: "4h",  hours: 4    },
];

const FEED_QUERIES = [
  // Plaintiff intel sites — highest signal
  "new class action lawsuit filed 2026 site:classaction.org OR site:topclassactions.com OR site:aboutlawsuits.com",
  "new MDL mass tort consolidation JPML transfer order 2026",
  "new settlement verdict product liability pharmaceutical site:millerandzois.com 2026",
  "new investigation lawsuit filed consumer drugs devices site:classaction.com 2026",

  // Government agency actions
  "FDA recall injury class action lawsuit 2026",
  "SEC enforcement action securities fraud class action 2026",
  "FTC consumer protection enforcement action lawsuit 2026",
  "NHTSA vehicle defect recall investigation class action 2026",
  "EPA environmental contamination PFAS toxic lawsuit 2026",

  // Case categories
  "pharmaceutical drug injury lawsuit FDA warning 2026",
  "product recall personal injury class action filed 2026",
  "data breach settlement class action 2026",
  "social media addiction youth mental health lawsuit 2026",
  "mass tort new filing complaint injury attorney 2026",
  "product liability injury complaint Reddit consumers 2026",
  "corporate fraud whistleblower class action 2026",
  "medical device defect recall injury lawsuit 2026",

  // DOJ criminal enforcement → civil plaintiff pipeline
  "DOJ criminal fraud conviction company executives guilty plea victims civil lawsuit 2026",
  "criminal plea agreement corporate fraud consumer patients investors victims compensation 2026",
  "USA v company criminal charges fraud victims class action civil RICO 2026",

  // State AG investigations
  "state attorney general investigation enforcement action corporate fraud consumer victims 2026",
  "multistate attorney general settlement investigation consumer protection fraud 2026",

  // False Claims Act — government contract fraud
  "False Claims Act qui tam whistleblower settlement healthcare hospital fraud victims 2026",

  // SEC EDGAR signals → securities class action
  "company disclosed SEC subpoena DOJ investigation 8-K investor class action 2026",
  "accounting restatement prior earnings reduced securities class action complaint investor loss 2026",
  "material weakness internal controls restatement securities fraud lawsuit investor 2026",
  "securities fraud stock drop class action complaint filed 2026 site:securities.stanford.edu OR site:classaction.org",

  // SEC filing failures
  "company late SEC filing NT 10-K restatement securities class action investor damages 2026",

  // Criminal corporate cases to find civil victims
  "RICO criminal civil lawsuit corporate fraud victims damages class action 2026",
  "healthcare insurance fraud criminal conviction patients victims civil lawsuit 2026",
];

// ─── UTILITIES ────────────────────────────────────────────────────────────────

async function hashUrl(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function loadLeads()  { try { return JSON.parse(localStorage.getItem(LEADS_KEY)  || "[]");   } catch { return [];        } }
function saveLeads(v) { try { localStorage.setItem(LEADS_KEY,  JSON.stringify(v)); }           catch {} }
function loadSeen()   { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } }
function saveSeen(v)  { try { localStorage.setItem(SEEN_KEY,   JSON.stringify([...v])); }       catch {} }
function loadLastScan()     { return localStorage.getItem(LAST_SCAN_KEY) || null; }
function saveLastScan(iso)  { localStorage.setItem(LAST_SCAN_KEY, iso); }
function loadInterval()     { return Number(localStorage.getItem(INTERVAL_KEY) || 1); }
function saveInterval(h)    { localStorage.setItem(INTERVAL_KEY, String(h)); }

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

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url.slice(0, 30); }
}

// ─── FULL-TEXT EXTRACTION (Jina AI reader) ───────────────────────────────────

const SKIP_FULLTEXT = ["reddit.com", "storage.googleapis.com"];

async function fetchArticleText(url) {
  if (!url || SKIP_FULLTEXT.some(s => url.includes(s))) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 3000);
  } catch { return ""; }
}

// ─── API CALLS ────────────────────────────────────────────────────────────────

const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

async function runWebSearch(query) {
  try {
    const res  = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: `Search: ${query}\n\nReturn ONLY a JSON array of up to 5 relevant results. Each: {"title":"...","url":"...","description":"...","pubDate":"ISO date or today"}. Focus on 2025–2026 results. Return ONLY the JSON array.` }],
      }),
    });
    const data  = await res.json();
    const text  = data.content?.map(b => b.text || "").filter(Boolean).join("") || "[]";
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    return JSON.parse(match[0])
      .filter(i => i.url && i.title)
      .map(i => ({ title: String(i.title), url: String(i.url), description: String(i.description || ""), pubDate: String(i.pubDate || new Date().toISOString()), source: extractDomain(i.url) }));
  } catch { return []; }
}

async function triageLead(item) {
  try {
    const res  = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 120,
        system: QUICK_TRIAGE_PROMPT,
        messages: [{ role: "user", content: `Lead: ${item.title}\nSource: ${item.source}\nDate: ${item.pubDate}\n${item.description ? `Summary: ${item.description.slice(0, 300)}` : ""}` }],
      }),
    });
    const data  = await res.json();
    const text  = data.content?.map(b => b.text || "").join("") || "{}";
    const match = text.match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

async function deepAnalyzeLead(item) {
  try {
    const fullText = await fetchArticleText(item.url);
    const content  = fullText
      ? `${item.description}\n\n--- FULL ARTICLE TEXT ---\n${fullText}`
      : item.description;
    const res  = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 2500,
        system: DEEP_ANALYSIS_PROMPT,
        messages: [{ role: "user", content: `Full litigation intelligence analysis:\n\nTitle: ${item.title}\nSource: ${item.source}\nDate: ${item.pubDate}\nContent: ${content}\nURL: ${item.url}` }],
      }),
    });
    const data  = await res.json();
    const text  = data.content?.map(b => b.text || "").join("") || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// ─── SCAN ORCHESTRATOR ────────────────────────────────────────────────────────

async function runScan(onProgress) {
  const seen     = loadSeen();
  const existing = loadLeads();
  const rawItems = [];

  // Phase 1: search all queries
  for (let i = 0; i < FEED_QUERIES.length; i++) {
    onProgress({ phase: "search", qi: i + 1, total: FEED_QUERIES.length, query: FEED_QUERIES[i] });
    const results = await runWebSearch(FEED_QUERIES[i]);
    for (const r of results) {
      const id = await hashUrl(r.url);
      if (!seen.has(id)) rawItems.push({ ...r, id });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Mark all seen upfront
  rawItems.forEach(i => seen.add(i.id));
  saveSeen(seen);

  if (rawItems.length === 0) {
    onProgress({ phase: "done", newLeads: 0 });
    return loadLeads();
  }

  // Phase 2: triage
  const toAnalyze = [];
  for (let i = 0; i < rawItems.length; i++) {
    onProgress({ phase: "triage", qi: i + 1, total: rawItems.length });
    const t = await triageLead(rawItems[i]);
    if (t?.score >= 55) toAnalyze.push({ ...rawItems[i], triageScore: t.score });
    await new Promise(r => setTimeout(r, 150));
  }

  if (toAnalyze.length === 0) {
    onProgress({ phase: "done", newLeads: 0 });
    return loadLeads();
  }

  // Phase 3: deep analyze
  const newLeads = [];
  for (let i = 0; i < toAnalyze.length; i++) {
    onProgress({ phase: "analyze", qi: i + 1, total: toAnalyze.length });
    const a = await deepAnalyzeLead(toAnalyze[i]);
    if (a) newLeads.push({ id: toAnalyze[i].id, url: toAnalyze[i].url, title: toAnalyze[i].title, description: toAnalyze[i].description, source: toAnalyze[i].source, pubDate: toAnalyze[i].pubDate, scannedAt: new Date().toISOString(), analysis: a });
    await new Promise(r => setTimeout(r, 500));
  }

  // Merge, expire, cap
  const cutoff = Date.now() - THIRTY_DAYS;
  const merged = [...newLeads, ...existing.filter(l => new Date(l.scannedAt).getTime() > cutoff)];
  merged.sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));
  const final = merged.slice(0, MAX_LEADS);
  saveLeads(final);
  saveLastScan(new Date().toISOString());
  onProgress({ phase: "done", newLeads: newLeads.length });
  return final;
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
          {/* Opportunity status — always visible */}
          {a.opportunityStatus && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: ops.bg, color: ops.color, border: `1px solid ${ops.border}` }}>
              {ops.label}
            </span>
          )}
          {/* Targeting readiness */}
          {rs && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: rs.color + "18", color: rs.color, border: `1px solid ${rs.color}44` }}>
              {rs.label}
            </span>
          )}
          {a.caseType && <span style={{ fontSize: 11, color: "#888" }}>{a.caseType}</span>}
        </div>
      </div>

      {/* Days to act — critical countdown, shown when < 180 days */}
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
        {age && <span>· Published <span style={{ color: age === "today" || age?.includes("day") && parseInt(age) < 8 ? "#4ade80" : "#666" }}>{age}</span></span>}
        {a.timeline?.opportunityWindow && <span>· Window: <span style={{ color: "#c8c8e0" }}>{a.timeline.opportunityWindow}</span></span>}
      </div>

      {/* Targeting readiness reason — always visible when READY_NOW */}
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
  const [leads,          setLeads]          = useState(() => loadLeads());
  const [lastScan,       setLastScan]       = useState(() => loadLastScan());
  const [intervalHours,  setIntervalHours]  = useState(() => loadInterval());
  const [isScanning,     setIsScanning]     = useState(false);
  const [scanPhase,      setScanPhase]      = useState("");   // live status text
  const [scanProgress,   setScanProgress]   = useState(0);    // 0-100
  const [newLeadCount,   setNewLeadCount]   = useState(null); // result of last scan
  const [countdown,      setCountdown]      = useState(0);    // ms until next scan
  const [dismissed,      setDismissed]      = useState(() => new Set());
  const [minScore,       setMinScore]       = useState(55);
  const [joinFilter,     setJoinFilter]     = useState("ALL");
  const [caseTypeFilter, setCaseTypeFilter] = useState("");
  const scanningRef = useRef(false);

  // ── Countdown ticker (every second) ─────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const last = loadLastScan();
      if (!last) { setCountdown(0); return; }
      const next = new Date(last).getTime() + intervalHours * 3600000;
      setCountdown(Math.max(0, next - Date.now()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [intervalHours, lastScan]);

  // ── Auto-scan trigger (check every 30 seconds) ───────────────────────────────
  useEffect(() => {
    const check = async () => {
      if (scanningRef.current) return;
      const last = loadLastScan();
      const due  = !last || (Date.now() - new Date(last).getTime()) >= intervalHours * 3600000;
      if (due) triggerScan();
    };
    check(); // check immediately on mount or interval change
    const id = setInterval(check, 30000);
    // Re-check when tab becomes visible (catches scans missed while tab was in background)
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [intervalHours]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setIsScanning(true);
    setScanProgress(0);
    setNewLeadCount(null);

    try {
      const result = await runScan(({ phase, qi, total, newLeads }) => {
        if (phase === "search")  { setScanPhase(`Searching source ${qi}/${total}...`);  setScanProgress(Math.round((qi / total) * 40)); }
        if (phase === "triage")  { setScanPhase(`Triaging ${total} new items...`);       setScanProgress(40 + Math.round((qi / total) * 25)); }
        if (phase === "analyze") { setScanPhase(`Analyzing lead ${qi}/${total}...`);     setScanProgress(65 + Math.round((qi / total) * 33)); }
        if (phase === "done")    { setScanPhase(`Scan complete — ${newLeads} new leads found`); setScanProgress(100); setNewLeadCount(newLeads); }
      });
      setLeads(result);
      setLastScan(loadLastScan());
    } catch (e) {
      setScanPhase("Scan error: " + e.message);
    } finally {
      scanningRef.current = false;
      setIsScanning(false);
    }
  }, []);

  const changeInterval = (h) => {
    setIntervalHours(h);
    saveInterval(h);
  };

  const handleAddToTracker = useCallback((lead) => {
    const a = lead.analysis || {};
    setCases(prev => [...prev, {
      id: Date.now(),
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
    const a    = lead.analysis || {};
    const score = a.score || 0;
    const rating = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B+" : score >= 60 ? "B" : "C";
    const nextId = Math.max(0, ...(kbCases || []).map(c => c.id || 0)) + 1;
    const kbCase = {
      id:               nextId,
      title:            a.headline || lead.title,
      company:          a.defendantProfile?.name || "Unknown",
      type:             a.caseType || "Other",
      industry:         a.caseType || "Other",
      outcome:          "pending",
      year:             new Date().getFullYear(),
      affectedPop:      a.classProfile?.estimatedSize || "TBD",
      jurisdiction:     a.classProfile?.geographicScope || "Federal",
      mdlNumber:        a.existingLitigation?.mdlNumber || "",
      settlementAmount: a.damagesModel?.totalFundEstimate || "Pending",
      classSize:        a.classProfile?.estimatedSize || "TBD",
      rule23bType:      "b(3)",
      harmCategory:     (a.caseType || "").toLowerCase().includes("physical") || (a.caseType || "").toLowerCase().includes("device") || (a.caseType || "").toLowerCase().includes("pharma") ? "physical" : "economic",
      keyFact:          a.executiveSummary || lead.description,
      tags:             [a.caseType, a.joinOrCreate, "promoted-from-feed"].filter(Boolean),
      notes:            `Promoted from Daily Feed scan (score: ${score}/100). Source: ${lead.source}. URL: ${lead.url}`,
      analysis: {
        rating,
        strengthScore:          Math.min(10, Math.round(score / 10)),
        payoutPerClaimant:      a.damagesModel?.perClaimantRange || "TBD — pending enrichment",
        litigationYears:        3,
        whyItWorked:            a.whyItScored || a.executiveSummary || "",
        challenges:             a.topRisk || "",
        strategiesWon:          a.immediateNextSteps || [],
        strategiesFailed:       [],
        demographics:           a.plaintiffProfile?.demographics || "",
        injuryTypes:            a.causesOfAction?.map(c => c.name) || [],
        keyEvidence:            a.executiveSummary || "",
        corporateMisconduct:    a.executiveSummary || "",
        regulatoryActions:      a.regulatoryStatus?.recentActions || "",
        settlementStructure:    a.damagesModel?.totalFundEstimate || "TBD",
        bellwetherOutcome:      a.timeline?.opportunityWindow || "Pending",
        attorneyFees:           a.damagesModel?.feeToFirmAt33Pct || "TBD",
        replicationModel:       `${rating} — promoted from Daily Feed, requires full enrichment`,
        clientAcquisitionStrategy: [a.plaintiffProfile?.acquisitionHook, ...(a.plaintiffProfile?.whereToFind || [])].filter(Boolean).join(". ") || "",
        watchOut:               a.riskMatrix?.keyRisks?.[0] || a.topRisk || "",
      },
    };
    setKbCases(prev => [...prev, kbCase]);
    setTab("knowledge");
  }, [kbCases, setKbCases, setTab]);

  const handleDismiss = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
    const updated = loadLeads().filter(l => l.id !== id);
    saveLeads(updated);
    setLeads(updated);
  }, []);

  const visible = leads
    .filter(l => !dismissed.has(l.id))
    .filter(l => (l.analysis?.score || 0) >= minScore)
    .filter(l => joinFilter === "ALL" || l.analysis?.joinOrCreate === joinFilter)
    .filter(l => !caseTypeFilter || l.analysis?.caseType === caseTypeFilter)
    .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

  const allActive = leads.filter(l => !dismissed.has(l.id));
  const stats = {
    total:  allActive.length,
    high:   allActive.filter(l => (l.analysis?.score || 0) >= 75).length,
    create: allActive.filter(l => l.analysis?.joinOrCreate === "CREATE").length,
    join:   allActive.filter(l => l.analysis?.joinOrCreate === "JOIN").length,
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#e0e0f0" }}>Daily Intelligence Feed</h2>
          <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Last scan: <span style={{ color: "#a0a0b8" }}>{timeAgo(lastScan)}</span></span>
            {!isScanning && countdown > 0 && <span>Next scan: <span style={{ color: "#C8442F" }}>{fmtCountdown(countdown)}</span></span>}
            {isScanning && <span style={{ color: "#E06050" }}>Scanning now...</span>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Frequency selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#666" }}>Scan</span>
            <div style={{ display: "flex", gap: 2 }}>
              {SCAN_INTERVALS.map(s => (
                <button key={s.hours} onClick={() => changeInterval(s.hours)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: intervalHours === s.hours ? 700 : 400, background: intervalHours === s.hours ? "rgba(200,68,47,0.3)" : "rgba(255,255,255,0.06)", color: intervalHours === s.hours ? "#E06050" : "#666", cursor: "pointer" }}>
                  {s.short}
                </button>
              ))}
            </div>
          </div>
          <Btn small onClick={triggerScan} style={{ opacity: isScanning ? 0.5 : 1 }}>
            {isScanning ? "Scanning..." : "Scan Now"}
          </Btn>
        </div>
      </div>

      {/* ── Scan progress bar (non-blocking — sits above the feed) ─────────── */}
      {isScanning && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#E06050", marginBottom: 6 }}>
            <span>{scanPhase}</span>
            <span>{scanProgress}%</span>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${scanProgress}%`, background: "linear-gradient(90deg,#C8442F,#B83E2C)", borderRadius: 2, transition: "width 0.4s" }} />
          </div>
        </div>
      )}

      {/* ── New leads banner ─────────────────────────────────────────────────── */}
      {!isScanning && newLeadCount !== null && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: newLeadCount > 0 ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${newLeadCount > 0 ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`, fontSize: 13, color: newLeadCount > 0 ? "#4ade80" : "#666" }}>
          {newLeadCount > 0 ? `${newLeadCount} new lead${newLeadCount > 1 ? "s" : ""} added from latest scan` : "No new leads this scan — all sources up to date"}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!isScanning && leads.length === 0 && (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e0e0f0", marginBottom: 8 }}>Waiting for first scan</div>
          <div style={{ fontSize: 13, color: "#555", maxWidth: 420, margin: "0 auto 20px", lineHeight: 1.6 }}>
            The scanner will start automatically. It searches 30+ targeted queries covering DOJ/AG criminal enforcement, SEC EDGAR subpoenas and restatements, government databases, legal sites, news, Reddit, and social media — then scores each result for class action viability using your 150-case knowledge base.
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>Scanning {fmtCountdown(countdown) === "now" ? "starting..." : `in ${fmtCountdown(countdown)}`}</div>
        </Card>
      )}

      {leads.length > 0 && (
        <>
          {/* ── Stats ────────────────────────────────────────────────────────── */}
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

          {/* ── Filters ──────────────────────────────────────────────────────── */}
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

          {/* ── Lead cards ───────────────────────────────────────────────────── */}
          {visible.length === 0
            ? <div style={{ textAlign: "center", padding: "32px 0", color: "#555", fontSize: 13 }}>No leads match current filters. Try lowering the minimum score.</div>
            : visible.map(lead => <LeadCard key={lead.id} lead={lead} onAddToTracker={handleAddToTracker} onDismiss={handleDismiss} onPromoteToKB={setKbCases ? handlePromoteToKB : null} />)
          }
        </>
      )}
    </div>
  );
}
