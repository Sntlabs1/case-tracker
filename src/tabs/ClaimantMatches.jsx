import React, { useState, useEffect, useCallback } from "react";
import { Card, Btn, Input, Select, Badge } from "../components/UI.jsx";

const CASE_TYPES = ["", "FDCPA", "FCRA", "TCPA", "AutoLending", "StudentLoan", "RESPA", "DataBreach", "UDAP_Payday"];
const ELIG_COLOR = {
  viable: "#22c55e",
  viable_ongoing: "#22c55e",
  viable_state_udap: "#f59e0b",
  federal_likely_timebarred: "#ef4444",
};
const STRENGTH_COLOR = { high: "#22c55e", medium: "#f59e0b", low: "#ef4444" };

function fmt$(n) {
  if (n == null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function ConnectionRow({ c }) {
  return (
    <div style={{ borderLeft: `3px solid ${STRENGTH_COLOR[c.strength] || "#666"}`, padding: "8px 12px", marginBottom: 8, background: "#0f1115", borderRadius: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{c.caseType}</strong>
        <span style={{ opacity: 0.7 }}>vs</span>
        <strong>{c.defendant}</strong>
        <Badge label={c.strength} color={STRENGTH_COLOR[c.strength]} />
        <Badge label={c.eligibilityLabel || c.eligibility} color={ELIG_COLOR[c.eligibility] || "#666"} />
        {c.classSettlement && <Badge label="CLASS SETTLEMENT" color="#8b5cf6" />}
        {c.newCases > 0 && <Badge label={`${c.newCases} new dockets`} color="#3b82f6" />}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{c.reasoning}</div>
      {c.dockets && c.dockets.length > 0 && (
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          <span style={{ opacity: 0.6 }}>Example dockets (metadata only): </span>
          {c.dockets.join(" · ")}
        </div>
      )}
      {(c.recoveryLow != null || c.recoveryHigh != null) && (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Est. statutory recovery: {fmt$(c.recoveryLow)}–{fmt$(c.recoveryHigh)}
        </div>
      )}
    </div>
  );
}

function ClaimantCard({ row, onOpen, expanded, detail }) {
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => onOpen(row.id)}>
        <div>
          <strong style={{ fontSize: 15 }}>{row.name}</strong>
          <span style={{ opacity: 0.6, marginLeft: 8 }}>{row.state}</span>
          {row.intakeReady && <Badge label="INTAKE READY" color="#22c55e" />}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
          <span>score <strong>{row.score}</strong></span>
          <span>{row.connectionCount} cases ({row.strongConnections} docket-backed)</span>
          <span>{fmt$(row.recovery?.low)}–{fmt$(row.recovery?.high)}</span>
          <span style={{ opacity: 0.6 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 12 }}>
          {detail?.contact && (
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
              Contact: {detail.contact.phone || "—"} · {detail.contact.email || "—"}
            </div>
          )}
          {!detail && <div style={{ opacity: 0.6, fontSize: 13 }}>Loading connections…</div>}
          {(detail?.connections || row.topConnections || []).map((c, i) => <ConnectionRow key={i} c={c} />)}
        </div>
      )}
    </Card>
  );
}

export default function ClaimantMatches() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ defendant: "", caseType: "", state: "", minScore: "", intakeReady: false });
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (filters.defendant) p.set("defendant", filters.defendant);
      if (filters.caseType) p.set("caseType", filters.caseType);
      if (filters.state) p.set("state", filters.state);
      if (filters.minScore) p.set("minScore", filters.minScore);
      if (filters.intakeReady) p.set("intakeReady", "1");
      const r = await fetch(`/api/credit-matches?${p}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      setData(await r.json());
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);

  const openClaimant = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!details[id]) {
      try {
        const r = await fetch(`/api/credit-matches?id=${encodeURIComponent(id)}`);
        if (r.ok) { const j = await r.json(); setDetails(d => ({ ...d, [id]: j })); }
      } catch {}
    }
  };

  const applyFilters = () => { setOffset(0); load(); };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Input label="Defendant" value={filters.defendant} placeholder="e.g. midland" onChange={v => setFilters(f => ({ ...f, defendant: v }))} style={{ width: 160 }} />
          <Select label="Case type" value={filters.caseType} onChange={v => setFilters(f => ({ ...f, caseType: v }))} options={CASE_TYPES.map(c => ({ value: c, label: c || "Any" }))} />
          <Input label="State" value={filters.state} placeholder="CA" onChange={v => setFilters(f => ({ ...f, state: v }))} style={{ width: 70 }} />
          <Input label="Min score" value={filters.minScore} type="number" onChange={v => setFilters(f => ({ ...f, minScore: v }))} style={{ width: 90 }} />
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={filters.intakeReady} onChange={e => setFilters(f => ({ ...f, intakeReady: e.target.checked }))} />
            Intake-ready only
          </label>
          <Btn onClick={applyFilters}>Apply</Btn>
        </div>
        <div style={{ fontSize: 12, opacity: 0.65, marginTop: 8 }}>
          {data ? `${data.total?.toLocaleString()} matched claimants in index · showing ${data.returned} from #${offset + 1}` : "—"}
        </div>
      </Card>

      {err && <Card style={{ color: "#ef4444" }}>Error: {err}</Card>}
      {loading && <div style={{ opacity: 0.6, padding: 12 }}>Loading…</div>}

      {data?.claimants?.map(row => (
        <ClaimantCard key={row.id} row={row} expanded={expanded === row.id} detail={details[row.id]} onOpen={openClaimant} />
      ))}

      {data && data.claimants.length === 0 && !loading && (
        <Card style={{ opacity: 0.6 }}>No claimants match these filters.</Card>
      )}

      {data && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
          <Btn variant="secondary" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>← Prev</Btn>
          <span style={{ fontSize: 13, alignSelf: "center", opacity: 0.7 }}>#{offset + 1}–{offset + (data.returned || 0)}</span>
          <Btn variant="secondary" onClick={() => setOffset(offset + limit)} disabled={(data.returned || 0) < limit}>Next →</Btn>
        </div>
      )}
    </div>
  );
}
