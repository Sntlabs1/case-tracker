import { useState, useEffect } from "react";
import { Card, Badge, Btn, Input, Select, TextArea, Modal, ScoreBar, AIPanel } from "../components/UI.jsx";
import { CASE_TYPES, PRIORITIES, STATUSES, PRIORITY_COLORS, STATUS_COLORS } from "../data/sources.js";

export default function CaseTracker({ cases, setCases, selectedCase, setSelectedCase, showAI, setShowAI, caseFilter = {} }) {
  const [filterType, setFilterType] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Apply filter passed from Dashboard (e.g. clicking a pipeline stage)
  useEffect(() => {
    if (caseFilter.status)   setFilterStatus(caseFilter.status);
    if (caseFilter.caseType) setFilterType(caseFilter.caseType);
    if (caseFilter.priority) setFilterPriority(caseFilter.priority);
  }, [caseFilter]);
  const [searchQ, setSearchQ] = useState("");
  const [showAddCase, setShowAddCase] = useState(false);
  const [newCase, setNewCase] = useState({ title: "", source: "", caseType: "", priority: "Medium", status: "New Lead", affectedPop: "", company: "", description: "", notes: "", score: 50, jurisdiction: "" });

  const filtered = cases.filter(c => {
    if (filterType && c.caseType !== filterType) return false;
    if (filterPriority && c.priority !== filterPriority) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (searchQ && !JSON.stringify(c).toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const sortedCases = [...filtered].sort((a, b) => b.score - a.score);

  const addCase = () => {
    setCases(p => [...p, { ...newCase, id: Date.now(), dateAdded: new Date().toISOString().split("T")[0] }]);
    setNewCase({ title: "", source: "", caseType: "", priority: "Medium", status: "New Lead", affectedPop: "", company: "", description: "", notes: "", score: 50, jurisdiction: "" });
    setShowAddCase(false);
  };

  const updateCase = (id, updates) => setCases(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
  const deleteCase = id => { setCases(p => p.filter(c => c.id !== id)); setSelectedCase(null); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Case Tracker</h2>
        <Btn onClick={() => setShowAddCase(true)}>+ New Case</Btn>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 }}>
          <Input placeholder="Search cases..." value={searchQ} onChange={setSearchQ} style={{ marginBottom: 0 }} />
          <Select value={filterType} onChange={setFilterType} options={CASE_TYPES} style={{ marginBottom: 0 }} />
          <Select value={filterPriority} onChange={setFilterPriority} options={PRIORITIES} style={{ marginBottom: 0 }} />
          <Select value={filterStatus} onChange={setFilterStatus} options={STATUSES} style={{ marginBottom: 0 }} />
        </div>
      </Card>
      <div style={{ display: "grid", gap: 12 }}>
        {sortedCases.map(c => (
          <Card key={c.id} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{c.title}</span>
                  <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
                  <Badge label={c.status} color={STATUS_COLORS[c.status]} />
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{c.company} · {c.caseType} · {c.source} · Pop: {c.affectedPop}</div>
                <div style={{ fontSize: 13, color: "#a0a0b8", marginBottom: 8 }}>{c.description}</div>
                <div style={{ maxWidth: 200 }}><ScoreBar score={c.score} /></div>
              </div>
              <div style={{ textAlign: "right", minWidth: 100 }}>
                <div style={{ fontSize: 11, color: "#666" }}>{c.dateAdded}</div>
                {c.jurisdiction && <div style={{ fontSize: 11, color: "#B83E2C", marginTop: 4 }}>{c.jurisdiction}</div>}
              </div>
            </div>
            {selectedCase?.id === c.id && (
              <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <Select label="Priority" value={c.priority} onChange={v => updateCase(c.id, { priority: v })} options={PRIORITIES} />
                  <Select label="Status" value={c.status} onChange={v => updateCase(c.id, { status: v })} options={STATUSES} />
                  <Input label="Viability Score (0-100)" type="number" value={c.score} onChange={v => updateCase(c.id, { score: parseInt(v) || 0 })} />
                  <Input label="Jurisdiction" value={c.jurisdiction || ""} onChange={v => updateCase(c.id, { jurisdiction: v })} />
                </div>
                <TextArea label="Notes" value={c.notes} onChange={v => updateCase(c.id, { notes: v })} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Btn small variant="secondary" onClick={() => setShowAI(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                    🤖 {showAI[c.id] ? "Hide" : "AI"} Analysis
                  </Btn>
                  <Btn small variant="danger" onClick={() => deleteCase(c.id)}>Delete</Btn>
                </div>
                {showAI[c.id] && <AIPanel caseData={c} onClose={() => setShowAI(p => ({ ...p, [c.id]: false }))} apiKey={import.meta.env.VITE_ANTHROPIC_API_KEY} />}
              </div>
            )}
          </Card>
        ))}
        {sortedCases.length === 0 && <div style={{ textAlign: "center", color: "#666", padding: 40 }}>No cases match your filters</div>}
      </div>
      <Modal open={showAddCase} onClose={() => setShowAddCase(false)} title="Add New Case">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Case Title" value={newCase.title} onChange={v => setNewCase(p => ({ ...p, title: v }))} placeholder="e.g., XYZ Device Recall" />
          <Input label="Company/Defendant" value={newCase.company} onChange={v => setNewCase(p => ({ ...p, company: v }))} />
          <Select label="Case Type" value={newCase.caseType} onChange={v => setNewCase(p => ({ ...p, caseType: v }))} options={CASE_TYPES} />
          <Select label="Priority" value={newCase.priority} onChange={v => setNewCase(p => ({ ...p, priority: v }))} options={PRIORITIES} />
          <Select label="Status" value={newCase.status} onChange={v => setNewCase(p => ({ ...p, status: v }))} options={STATUSES} />
          <Input label="Source" value={newCase.source} onChange={v => setNewCase(p => ({ ...p, source: v }))} placeholder="e.g., FDA Recalls" />
          <Input label="Affected Population" value={newCase.affectedPop} onChange={v => setNewCase(p => ({ ...p, affectedPop: v }))} placeholder="e.g., 500,000+" />
          <Input label="Jurisdiction" value={newCase.jurisdiction} onChange={v => setNewCase(p => ({ ...p, jurisdiction: v }))} placeholder="e.g., S.D. New York" />
          <Input label="Viability Score (0-100)" type="number" value={newCase.score} onChange={v => setNewCase(p => ({ ...p, score: parseInt(v) || 0 }))} />
        </div>
        <TextArea label="Description" value={newCase.description} onChange={v => setNewCase(p => ({ ...p, description: v }))} placeholder="Brief case description..." />
        <TextArea label="Notes" value={newCase.notes} onChange={v => setNewCase(p => ({ ...p, notes: v }))} placeholder="Investigation notes, key contacts, deadlines..." />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Btn onClick={addCase}>Add Case</Btn>
          <Btn variant="secondary" onClick={() => setShowAddCase(false)}>Cancel</Btn>
        </div>
      </Modal>
    </div>
  );
}
