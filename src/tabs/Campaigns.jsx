import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Btn } from "../components/UI.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const LETTER_STATUSES = ["generated", "sent", "responded", "retained", "declined"];
const LETTER_STATUS_COLORS = {
  generated: "#6b7280",
  sent:      "#3b82f6",
  responded: "#f59e0b",
  retained:  "#22c55e",
  declined:  "#ef4444",
};

function statusColor(s) { return LETTER_STATUS_COLORS[s] || "#6b7280"; }

function StatusBadge({ status }) {
  const c = statusColor(status);
  return (
    <span style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4, fontWeight: 600,
      background: `${c}22`, color: c, border: `1px solid ${c}44`,
    }}>{status || "generated"}</span>
  );
}

function ProgressBar({ done, total, color = "#C8442F" }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{done} / {total} letters generated</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--bg-surface)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ── Campaign list card ────────────────────────────────────────────────────────
function CampaignCard({ campaign, onOpen, onDelete }) {
  const [hov, setHov] = useState(false);
  const total    = campaign.clientCount    || 0;
  const sent     = campaign.sentCount      || 0;
  const responded= campaign.respondedCount || 0;
  const retained = campaign.retainedCount  || 0;
  const convRate = total > 0 ? Math.round((retained / total) * 100) : 0;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "16px 20px", borderRadius: 10, cursor: "pointer",
        background: hov ? "var(--bg-card-hov)" : "var(--bg-card)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        transition: "all 0.13s",
      }}
      onClick={onOpen}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-1)", marginBottom: 3 }}>{campaign.name}</div>
          {campaign.leadTitle && (
            <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 8 }}>
              Lead: {campaign.leadTitle.slice(0, 80)}
            </div>
          )}
          {/* Stats row */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { label: "Letters", value: total,     color: "var(--text-2)" },
              { label: "Sent",    value: sent,      color: "#3b82f6" },
              { label: "Responded",value: responded, color: "#f59e0b" },
              { label: "Retained",value: retained,  color: "#22c55e" },
              { label: "Conv. rate",value: `${convRate}%`, color: retained > 0 ? "#22c55e" : "var(--text-5)" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-6)" }}>
            {new Date(campaign.createdAt).toLocaleDateString()}
          </div>
          {hov && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(campaign.id); }}
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#ef4444", cursor: "pointer" }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Letter card ───────────────────────────────────────────────────────────────
function LetterCard({ letter, campaignId, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [saving, setSaving]     = useState(false);

  async function updateStatus(newStatus) {
    setSaving(true);
    try {
      await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, clientId: letter.clientId, letterStatus: newStatus }),
      });
      onStatusChange(letter.clientId, newStatus);
    } catch {}
    setSaving(false);
  }

  function copyLetter() {
    navigator.clipboard.writeText(letter.letter || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const subjectMatch = (letter.letter || "").match(/^Subject:\s*(.+)/im);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";

  return (
    <div style={{
      borderRadius: 8, border: "1px solid var(--border)",
      background: "var(--bg-card)", overflow: "hidden", marginBottom: 6,
    }}>
      {/* Header row */}
      <div
        style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              {letter.firstName} {letter.lastName}
            </span>
            {letter.state && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(100,120,220,0.12)", color: "#8090d0", border: "1px solid rgba(100,120,220,0.2)" }}>
                {letter.state}
              </span>
            )}
            <StatusBadge status={letter.status} />
            {letter.error && (
              <span style={{ fontSize: 10, color: "#ef4444" }}>Error: {letter.error}</span>
            )}
          </div>
          {subject && <div style={{ fontSize: 11, color: "var(--text-5)" }}>Subject: {subject}</div>}
          {letter.email && <div style={{ fontSize: 11, color: "var(--text-6)" }}>{letter.email}</div>}
        </div>
        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <select
            value={letter.status || "generated"}
            disabled={saving}
            onChange={e => updateStatus(e.target.value)}
            style={{
              fontSize: 11, padding: "3px 6px", borderRadius: 6, cursor: "pointer",
              background: "var(--bg-surface)", border: "1px solid var(--border-md)",
              color: statusColor(letter.status), fontWeight: 600,
            }}
          >
            {LETTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {letter.letter && (
            <button
              onClick={copyLetter}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer", background: "var(--bg-surface)", border: "1px solid var(--border-md)", color: "var(--text-3)" }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
        <span style={{ fontSize: 14, color: "var(--text-6)", flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Letter body */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
          {letter.letter ? (
            <pre style={{
              fontSize: 12, color: "var(--text-2)", lineHeight: 1.75, margin: "12px 0 0",
              fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {letter.letter}
            </pre>
          ) : (
            <div style={{ padding: "12px 0", fontSize: 12, color: "#ef4444" }}>Letter generation failed for this client.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Campaigns tab ────────────────────────────────────────────────────────
export default function Campaigns() {
  const [view, setView]           = useState("list"); // list | new | detail
  const [campaigns, setCampaigns] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  // Detail view
  const [activeCampaign, setActiveCampaign]   = useState(null);
  const [campaignLetters, setCampaignLetters] = useState([]);
  const [loadingDetail, setLoadingDetail]     = useState(false);
  const [letterSearch, setLetterSearch]       = useState("");
  const [letterStatusFilter, setLetterStatusFilter] = useState("all");

  // Wizard state
  const [wizStep, setWizStep]           = useState(1);
  const [campaignName, setCampaignName] = useState("");
  const [recentLeads, setRecentLeads]   = useState([]);
  const [leadSearch, setLeadSearch]     = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [allClients, setAllClients]     = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientStateFilter, setClientStateFilter] = useState("");
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [generating, setGenerating]     = useState(false);
  const [genDone, setGenDone]           = useState(0);
  const [genTotal, setGenTotal]         = useState(0);
  const [genLetters, setGenLetters]     = useState([]);
  const [genError, setGenError]         = useState("");
  const [saving, setSaving]             = useState(false);

  // ── Fetch campaign list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (view === "list") fetchCampaigns();
  }, [view]);

  async function fetchCampaigns() {
    setLoadingList(true);
    try {
      const r = await fetch("/api/campaigns");
      const d = await r.json();
      setCampaigns(d.campaigns || []);
    } catch {}
    setLoadingList(false);
  }

  // ── Open campaign detail ─────────────────────────────────────────────────────
  async function openCampaign(id) {
    setLoadingDetail(true);
    setView("detail");
    try {
      const r = await fetch(`/api/campaigns?id=${id}`);
      const d = await r.json();
      setActiveCampaign(d);
      setCampaignLetters(d.letters || []);
    } catch {}
    setLoadingDetail(false);
  }

  async function deleteCampaign(id) {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    await fetch(`/api/campaigns?id=${id}`, { method: "DELETE" });
    setCampaigns(cs => cs.filter(c => c.id !== id));
  }

  function handleLetterStatusChange(clientId, newStatus) {
    setCampaignLetters(ls => ls.map(l => l.clientId === clientId ? { ...l, status: newStatus } : l));
    setActiveCampaign(prev => {
      if (!prev) return prev;
      const updated = (prev.letters || campaignLetters).map(l =>
        l.clientId === clientId ? { ...l, status: newStatus } : l
      );
      const sentCount      = updated.filter(l => ["sent","responded","retained"].includes(l.status)).length;
      const respondedCount = updated.filter(l => ["responded","retained"].includes(l.status)).length;
      const retainedCount  = updated.filter(l => l.status === "retained").length;
      return { ...prev, sentCount, respondedCount, retainedCount };
    });
  }

  // ── Export CSV ────────────────────────────────────────────────────────────────
  function exportCSV() {
    const header = ["firstName","lastName","email","phone","state","status","letter"];
    const rows = campaignLetters.map(l => [
      l.firstName, l.lastName, l.email, l.phone, l.state, l.status || "generated",
      `"${(l.letter || "").replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${activeCampaign?.name || "campaign"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Wizard: fetch leads ───────────────────────────────────────────────────────
  async function fetchLeads() {
    try {
      const r = await fetch("/api/leads?limit=100&sort=score");
      const d = await r.json();
      setRecentLeads(d.leads || []);
    } catch {}
  }

  // ── Wizard: fetch clients ─────────────────────────────────────────────────────
  async function fetchClients() {
    try {
      const r = await fetch("/api/clients?limit=5000");
      const d = await r.json();
      setAllClients(d.clients || []);
    } catch {}
  }

  function startWizard() {
    setWizStep(1);
    setCampaignName("");
    setSelectedLead(null);
    setLeadSearch("");
    setAllClients([]);
    setClientSearch("");
    setClientStateFilter("");
    setSelectedIds(new Set());
    setGenerating(false);
    setGenDone(0);
    setGenTotal(0);
    setGenLetters([]);
    setGenError("");
    setSaving(false);
    fetchLeads();
    fetchClients();
    setView("new");
  }

  // ── Wizard Step 3: generate letters in batches ────────────────────────────────
  async function generateLetters() {
    const clients = allClients.filter(c => selectedIds.has(c.id));
    if (!clients.length || !selectedLead) return;
    setGenerating(true);
    setGenError("");
    setGenLetters([]);
    setGenDone(0);
    setGenTotal(clients.length);

    const BATCH = 10;
    const allLetters = [];

    for (let i = 0; i < clients.length; i += BATCH) {
      const batch = clients.slice(i, i + BATCH);
      try {
        const r = await fetch("/api/bulk-outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clients: batch, lead: selectedLead }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        allLetters.push(...(d.letters || []));
      } catch (e) {
        // On batch failure, push error placeholders
        batch.forEach(c => allLetters.push({
          clientId: c.id, firstName: c.firstName, lastName: c.lastName,
          email: c.email || "", phone: c.phone || "", state: c.state || "",
          letter: "", error: e.message,
        }));
      }
      setGenDone(Math.min(i + BATCH, clients.length));
      setGenLetters([...allLetters]);
    }

    setGenerating(false);
  }

  // ── Save campaign to KV ───────────────────────────────────────────────────────
  async function saveCampaign() {
    if (!genLetters.length) return;
    setSaving(true);
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName || `${selectedLead?.analysis?.headline?.slice(0, 50) || "Campaign"} — ${new Date().toLocaleDateString()}`,
          leadId: selectedLead?.id || null,
          leadTitle: selectedLead?.analysis?.headline || selectedLead?.title || null,
          leadSnapshot: selectedLead || null,
          letters: genLetters,
        }),
      });
      const d = await r.json();
      setSaving(false);
      await openCampaign(d.id);
    } catch (e) {
      setGenError("Save failed: " + e.message);
      setSaving(false);
    }
  }

  // ── Filtered clients for step 2 ───────────────────────────────────────────────
  const filteredClients = allClients.filter(c => {
    if (clientStateFilter && c.state !== clientStateFilter) return false;
    if (clientSearch) {
      const q = clientSearch.toLowerCase();
      if (!`${c.firstName} ${c.lastName} ${c.injuries} ${c.medicationsUsed}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const filteredLeads = recentLeads.filter(l => {
    if (!leadSearch) return true;
    const q = leadSearch.toLowerCase();
    return (l.analysis?.headline || l.title || "").toLowerCase().includes(q);
  });

  const filteredLetters = campaignLetters.filter(l => {
    if (letterStatusFilter !== "all" && l.status !== letterStatusFilter) return false;
    if (letterSearch) {
      const q = letterSearch.toLowerCase();
      if (!`${l.firstName} ${l.lastName} ${l.email} ${l.state}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const clientStates = [...new Set(allClients.map(c => c.state).filter(Boolean))].sort();

  // ── Render ────────────────────────────────────────────────────────────────────

  // ── Campaign list ─────────────────────────────────────────────────────────────
  if (view === "list") {
    const totalLetters  = campaigns.reduce((s, c) => s + (c.clientCount    || 0), 0);
    const totalSent     = campaigns.reduce((s, c) => s + (c.sentCount      || 0), 0);
    const totalRetained = campaigns.reduce((s, c) => s + (c.retainedCount  || 0), 0);

    return (
      <div>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              { label: "Campaigns",    value: campaigns.length, color: "#C8442F" },
              { label: "Letters",      value: totalLetters,     color: "var(--text-1)" },
              { label: "Sent",         value: totalSent,        color: "#3b82f6" },
              { label: "Retained",     value: totalRetained,    color: "#22c55e" },
            ].map(s => (
              <div key={s.label} style={{ padding: "10px 16px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 3, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <Btn onClick={startWizard}>+ New Campaign</Btn>
        </div>

        {loadingList ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-5)" }}>Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{ fontSize: 15, color: "var(--text-4)", marginBottom: 8 }}>No campaigns yet</div>
            <div style={{ fontSize: 12, color: "var(--text-6)", marginBottom: 20 }}>
              Create a campaign to bulk-generate personalized outreach letters for matched clients.
            </div>
            <Btn onClick={startWizard}>Create First Campaign</Btn>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onOpen={() => openCampaign(c.id)}
                onDelete={() => deleteCampaign(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Campaign detail ───────────────────────────────────────────────────────────
  if (view === "detail") {
    const total     = activeCampaign?.clientCount    || campaignLetters.length;
    const sent      = activeCampaign?.sentCount      || 0;
    const responded = activeCampaign?.respondedCount || 0;
    const retained  = activeCampaign?.retainedCount  || 0;
    const convRate  = total > 0 ? Math.round((retained / total) * 100) : 0;

    return (
      <div>
        {/* Back + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button
            onClick={() => setView("list")}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-md)", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "var(--text-3)", cursor: "pointer" }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>{activeCampaign?.name || "Campaign"}</div>
            {activeCampaign?.leadTitle && (
              <div style={{ fontSize: 11, color: "var(--text-5)" }}>Lead: {activeCampaign.leadTitle.slice(0, 100)}</div>
            )}
          </div>
          <Btn variant="secondary" onClick={exportCSV}>Export CSV</Btn>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total Letters", value: total,     color: "var(--text-1)" },
            { label: "Sent",          value: sent,      color: "#3b82f6" },
            { label: "Responded",     value: responded, color: "#f59e0b" },
            { label: "Retained",      value: retained,  color: "#22c55e" },
            { label: "Conv. Rate",    value: `${convRate}%`, color: retained > 0 ? "#22c55e" : "var(--text-5)" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, minWidth: 90, padding: "12px 16px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 3, fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Status pipeline bar */}
        {total > 0 && (
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 20, gap: 1 }}>
            {["generated","sent","responded","retained","declined"].map(s => {
              const count = campaignLetters.filter(l => (l.status || "generated") === s).length;
              const pct = (count / total) * 100;
              return pct > 0 ? (
                <div key={s} title={`${s}: ${count}`} style={{ width: `${pct}%`, background: statusColor(s), minWidth: 2 }} />
              ) : null;
            })}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={letterSearch}
            onChange={e => setLetterSearch(e.target.value)}
            placeholder="Search by name, email, state..."
            style={{ flex: 1, minWidth: 180, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 12 }}
          />
          <select
            value={letterStatusFilter}
            onChange={e => setLetterStatusFilter(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 12 }}
          >
            <option value="all">All statuses</option>
            {LETTER_STATUSES.map(s => (
              <option key={s} value={s}>{s} ({campaignLetters.filter(l => (l.status || "generated") === s).length})</option>
            ))}
          </select>
        </div>

        {loadingDetail ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-5)" }}>Loading letters...</div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
              {filteredLetters.length} of {total} letters
            </div>
            {filteredLetters.map(l => (
              <LetterCard
                key={l.clientId}
                letter={l}
                campaignId={activeCampaign?.id}
                onStatusChange={handleLetterStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── New campaign wizard ───────────────────────────────────────────────────────
  if (view === "new") {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Step indicator */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 24 }}>
          <button onClick={() => setView("list")} style={{ background: "none", border: "none", fontSize: 12, color: "var(--text-5)", cursor: "pointer", padding: "0 4px 0 0" }}>← Back</button>
          {[
            { n: 1, label: "Choose Lead" },
            { n: 2, label: "Select Clients" },
            { n: 3, label: "Generate & Save" },
          ].map((s, i) => (
            <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <div style={{ width: 24, height: 1, background: "var(--border-md)" }} />}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: wizStep === s.n ? "#C8442F" : wizStep > s.n ? "rgba(200,68,47,0.15)" : "var(--bg-surface)",
                color: wizStep === s.n ? "#fff" : wizStep > s.n ? "#C8442F" : "var(--text-5)",
                border: `1px solid ${wizStep >= s.n ? "#C8442F44" : "transparent"}`,
              }}>
                <span>{s.n}</span><span>{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Step 1: Pick lead ─────────────────────────────────────────────── */}
        {wizStep === 1 && (
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Name this campaign</div>
            <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 14 }}>Give it a name you'll recognize (e.g. "GLP-1 Outreach March 2026")</div>
            <input
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="Campaign name (optional — will auto-generate if blank)"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 13, marginBottom: 24, boxSizing: "border-box" }}
            />

            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Select a lead</div>
            <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 14 }}>Letters will be written based on this case's plaintiff profile, defendant, and compensation data.</div>
            <input
              value={leadSearch}
              onChange={e => setLeadSearch(e.target.value)}
              placeholder="Search leads..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 12, marginBottom: 10, boxSizing: "border-box" }}
            />

            <div style={{ maxHeight: 380, overflowY: "auto", display: "grid", gap: 6 }}>
              {filteredLeads.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: "var(--text-5)", fontSize: 12 }}>
                  No leads loaded — make sure leads exist in the system.
                </div>
              )}
              {filteredLeads.map(l => {
                const a = l.analysis || {};
                const isSelected = selectedLead?.id === l.id;
                return (
                  <div
                    key={l.id}
                    onClick={() => setSelectedLead(l)}
                    style={{
                      padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${isSelected ? "#C8442F" : "var(--border)"}`,
                      background: isSelected ? "rgba(200,68,47,0.08)" : "var(--bg-surface2)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      {a.score != null && (
                        <span style={{ fontSize: 18, fontWeight: 800, color: a.score >= 70 ? "#22c55e" : a.score >= 50 ? "#f59e0b" : "#ef4444", lineHeight: 1, flexShrink: 0 }}>
                          {a.score}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
                          {a.headline || l.title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                          {a.caseType} · {a.defendantProfile?.name} · {a.damagesModel?.perClaimantRange}
                        </div>
                      </div>
                      {isSelected && <span style={{ color: "#C8442F", fontWeight: 700, fontSize: 16 }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <Btn disabled={!selectedLead} onClick={() => setWizStep(2)}>
                Next: Select Clients →
              </Btn>
            </div>
          </Card>
        )}

        {/* ── Step 2: Select clients ─────────────────────────────────────────── */}
        {wizStep === 2 && (
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 2 }}>Select clients to contact</div>
            <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 14 }}>
              Letters will be personalized based on each client's injury/medication/product profile. {allClients.length} clients in database.
            </div>

            {/* Filters + select all */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Search by name, injury, medication..."
                style={{ flex: 1, minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 12 }}
              />
              <select
                value={clientStateFilter}
                onChange={e => setClientStateFilter(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-input)", color: "var(--text-1)", fontSize: 12 }}
              >
                <option value="">All states</option>
                {clientStates.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => {
                  const allFilteredIds = new Set(filteredClients.map(c => c.id));
                  const allSelected = filteredClients.every(c => selectedIds.has(c.id));
                  if (allSelected) {
                    setSelectedIds(ids => { const n = new Set(ids); allFilteredIds.forEach(id => n.delete(id)); return n; });
                  } else {
                    setSelectedIds(ids => { const n = new Set(ids); allFilteredIds.forEach(id => n.add(id)); return n; });
                  }
                }}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-md)", background: "var(--bg-surface)", color: "var(--text-3)", fontSize: 12, cursor: "pointer" }}
              >
                {filteredClients.every(c => selectedIds.has(c.id)) ? "Deselect All" : "Select All"} ({filteredClients.length})
              </button>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 10, fontWeight: 600 }}>
              {selectedIds.size} clients selected · {filteredClients.length} shown
            </div>

            {/* Client list */}
            <div style={{ maxHeight: 400, overflowY: "auto", display: "grid", gap: 4 }}>
              {filteredClients.map(c => {
                const checked = selectedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedIds(ids => {
                      const n = new Set(ids);
                      checked ? n.delete(c.id) : n.add(c.id);
                      return n;
                    })}
                    style={{
                      display: "flex", gap: 10, alignItems: "center", padding: "8px 12px",
                      borderRadius: 7, cursor: "pointer",
                      border: `1px solid ${checked ? "rgba(200,68,47,0.3)" : "var(--border)"}`,
                      background: checked ? "rgba(200,68,47,0.06)" : "var(--bg-surface2)",
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${checked ? "#C8442F" : "var(--border-hov)"}`,
                      background: checked ? "#C8442F" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {checked && <span style={{ fontSize: 10, color: "#fff", lineHeight: 1, fontWeight: 800 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{c.firstName} {c.lastName}</span>
                        {c.state && <span style={{ fontSize: 10, color: "#8090d0" }}>{c.state}</span>}
                        {c.age && <span style={{ fontSize: 10, color: "var(--text-5)" }}>age {c.age}</span>}
                      </div>
                      {c.injuries && <div style={{ fontSize: 11, color: "var(--text-5)" }}>{c.injuries.slice(0, 80)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => setWizStep(1)}>← Back</Btn>
              <Btn disabled={selectedIds.size === 0} onClick={() => setWizStep(3)}>
                Next: Generate {selectedIds.size} Letters →
              </Btn>
            </div>
          </Card>
        )}

        {/* ── Step 3: Generate ──────────────────────────────────────────────── */}
        {wizStep === 3 && (
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 2 }}>Generate letters</div>
            <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 20 }}>
              {selectedIds.size} personalized letters will be generated using AI based on each client's profile and the selected lead.
            </div>

            {/* Summary */}
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border)", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6, fontWeight: 600 }}>Campaign Summary</div>
              <div style={{ fontSize: 13, color: "var(--text-1)", marginBottom: 4 }}>
                <strong>Name:</strong> {campaignName || `${selectedLead?.analysis?.headline?.slice(0, 50) || "Campaign"} — ${new Date().toLocaleDateString()}`}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-1)", marginBottom: 4 }}>
                <strong>Lead:</strong> {selectedLead?.analysis?.headline || selectedLead?.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-1)" }}>
                <strong>Clients:</strong> {selectedIds.size} selected
              </div>
            </div>

            {/* Generate button or progress */}
            {!generating && genLetters.length === 0 && (
              <div style={{ textAlign: "center" }}>
                <Btn onClick={generateLetters}>Generate {selectedIds.size} Letters</Btn>
                <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 8 }}>
                  Takes ~{Math.ceil(selectedIds.size / 10) * 8}–{Math.ceil(selectedIds.size / 10) * 12} seconds
                </div>
              </div>
            )}

            {generating && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 4 }}>Generating letters...</div>
                <ProgressBar done={genDone} total={genTotal} />
                {genLetters.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 8 }}>
                    {genLetters.filter(l => l.letter).length} letters ready so far
                  </div>
                )}
              </div>
            )}

            {!generating && genLetters.length > 0 && (
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", marginBottom: 16 }}>
                  <span style={{ fontSize: 20 }}>✓</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>
                      {genLetters.filter(l => l.letter).length} of {genLetters.length} letters generated
                    </div>
                    {genLetters.filter(l => l.error).length > 0 && (
                      <div style={{ fontSize: 11, color: "#ef4444" }}>
                        {genLetters.filter(l => l.error).length} failed
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview first 3 letters */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 8 }}>Preview (first 3):</div>
                  {genLetters.slice(0, 3).map((l, i) => (
                    <div key={i} style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-surface2)", marginBottom: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
                        {l.firstName} {l.lastName} {l.state && `· ${l.state}`}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-4)", lineHeight: 1.6 }}>
                        {l.letter.slice(0, 200)}...
                      </div>
                    </div>
                  ))}
                </div>

                {genError && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{genError}</div>}

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Btn variant="secondary" onClick={generateLetters}>Regenerate</Btn>
                  <Btn disabled={saving} onClick={saveCampaign}>
                    {saving ? "Saving..." : "Save Campaign →"}
                  </Btn>
                </div>
              </div>
            )}

            {!generating && genLetters.length === 0 && (
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-start" }}>
                <Btn variant="secondary" onClick={() => setWizStep(2)}>← Back</Btn>
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  return null;
}
