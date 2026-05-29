import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, Btn } from "../components/UI.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const RETAINER_STATUSES = ["Uncontacted", "Contacted", "Consultation", "Retained", "Filed", "Declined"];
const RETAINER_COLORS = {
  Uncontacted:  "#6b7280",
  Contacted:    "#3b82f6",
  Consultation: "#f59e0b",
  Retained:     "#22c55e",
  Filed:        "#8b5cf6",
  Declined:     "#ef4444",
};

function retainerColor(status) {
  return RETAINER_COLORS[status] || "#6b7280";
}

function scoreColor(s) {
  return s >= 75 ? "#22c55e" : s >= 50 ? "#f59e0b" : s >= 30 ? "#fb923c" : "#ef4444";
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ClaimCountdown({ closes }) {
  const days = daysUntil(closes);
  if (days === null) return null;
  let color = "#22c55e";
  let label = `${days}d to claim`;
  if (days < 0) { color = "#6b7280"; label = "Window closed"; }
  else if (days <= 7) { color = "#ef4444"; label = `${days}d left`; }
  else if (days <= 30) { color = "#f59e0b"; label = `${days}d left`; }
  return (
    <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: `${color}20`, color, border: `1px solid ${color}40`, fontWeight: 700 }}>
      {label}
    </span>
  );
}

// ── Bankruptcy status helpers ─────────────────────────────────────────────────

const STATUS_META = {
  active:     { label: "Active",     color: "#f59e0b" },
  discharged: { label: "Discharged", color: "#22c55e" },
  dismissed:  { label: "Dismissed",  color: "#6b7280" },
  converted:  { label: "Converted",  color: "#3b82f6" },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active;
  return (
    <span style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700,
      background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}40`,
    }}>
      {meta.label}
    </span>
  );
}

function inferStatus(f) {
  if (f.status) return f.status;
  const d = (f.disposition || "").toLowerCase();
  if (d.includes("discharg")) return "discharged";
  if (d.includes("dismiss"))  return "dismissed";
  if (d.includes("convert"))  return "converted";
  return "active";
}

// ── Inline lead match — run match-cases for this client vs a selected lead ─────
function InlineLeadMatch({ client }) {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || leads) return;
    fetch("/api/leads?limit=2000")
      .then(r => r.json())
      .then(d => setLeads(d.leads || d.items || []))
      .catch(() => setLeads([]));
  }, [open]);

  async function runMatch() {
    if (!selectedLead || !client?.id) return;
    setStatus("loading");
    setResult(null);
    try {
      const r = await fetch("/api/match-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "client-to-cases",
          clientId: client.id,
          leadId: selectedLead.id,
          topN: 1,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const matches = d.matches || [];
      const m = matches[0];
      setResult({ match: m, lead: selectedLead });
      setStatus("done");
    } catch (e) {
      setResult({ error: e.message });
      setStatus("error");
    }
  }

  const filtered = (leads || []).filter(l => {
    if (!search) return true;
    const h = `${l.analysis?.headline || l.title || ""} ${l.analysis?.caseType || ""}`.toLowerCase();
    return h.includes(search.toLowerCase());
  });

  const sc = result?.match?.score ?? null;
  const scoreColor = sc == null ? "var(--text-5)" : sc >= 70 ? "#22c55e" : sc >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {open ? "▾ Hide lead match" : "▸ Run firm-wide match against a lead"}
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            placeholder="Search leads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 11, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-1)", outline: "none" }}
          />
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-surface)" }}>
            {leads === null ? (
              <div style={{ padding: "12px 14px", fontSize: 11, color: "var(--text-5)" }}>Loading leads…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 11, color: "var(--text-5)" }}>No leads found.</div>
            ) : filtered.map(l => {
              const headline = l.analysis?.headline || l.title || l.id;
              const isSelected = selectedLead?.id === l.id;
              return (
                <div key={l.id} onClick={() => { setSelectedLead(l); setStatus("idle"); setResult(null); }}
                  style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 11,
                    background: isSelected ? "rgba(var(--accent-rgb, 94,234,212),0.12)" : "transparent",
                    color: isSelected ? "var(--accent)" : "var(--text-2)", fontWeight: isSelected ? 600 : 400 }}>
                  <div>{headline}</div>
                  {l.analysis?.caseType && <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 2 }}>{l.analysis.caseType}</div>}
                </div>
              );
            })}
          </div>

          {selectedLead && (
            <button onClick={runMatch} disabled={status === "loading"}
              style={{ fontSize: 11, padding: "7px 14px", borderRadius: 6, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, opacity: status === "loading" ? 0.7 : 1 }}>
              {status === "loading" ? "Matching…" : `Match ${client.firstName || "client"} against "${(selectedLead.analysis?.headline || selectedLead.title || "").slice(0, 40)}"`}
            </button>
          )}

          {status === "done" && result?.match && (
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: `1px solid ${result.match.qualifies ? "#22c55e40" : "var(--border)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>Match result</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor }}>{sc}/100</span>
                  {result.match.qualifies && (
                    <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "#22c55e20", color: "#22c55e", fontWeight: 700, border: "1px solid #22c55e40" }}>QUALIFIES</span>
                  )}
                </div>
              </div>
              {result.match.reason && <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 6 }}>{result.match.reason}</div>}
              {result.match.matchingFactors?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                  {result.match.matchingFactors.map((f, i) => (
                    <span key={i} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>{f}</span>
                  ))}
                </div>
              )}
              {result.match.disqualifyingFactors?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {result.match.disqualifyingFactors.map((f, i) => (
                    <span key={i} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {status === "done" && !result?.match && (
            <div style={{ fontSize: 11, color: "var(--text-5)", padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
              No match data returned for this lead.
            </div>
          )}
          {status === "error" && (
            <div style={{ fontSize: 11, color: "#ef4444", padding: "10px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)" }}>
              {result?.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Quick client-side recovery estimate from a match object.
// Full calculation is in src/lib/recoveryEstimate.js (server-side).
// This version is for inline display only — mirrors the PER_VIOLATION table.
function quickRecovery(m) {
  const c = m.case || {};
  const client = m.client || {};
  const range = c.settlement?.perClaimantRange;
  if (range) {
    const nums = [...String(range).matchAll(/\$?([\d,]+)/g)]
      .map(x => parseInt(x[1].replace(/,/g, ""), 10)).filter(n => n > 0);
    if (nums.length >= 2) return { floor: Math.min(...nums), ceiling: Math.max(...nums), source: "settlement" };
    if (nums.length === 1) return { floor: nums[0], ceiling: nums[0], source: "settlement" };
  }
  const ct = (c.caseType || "TCPA").toUpperCase();
  const clientState = (client.state || "").toUpperCase();
  // State-aware statutory table (mirrors recoveryEstimate.js PER_VIOLATION)
  const perVMap = {
    TCPA:           { floor: 500,  ceiling: 1500  },
    FDCPA:          { floor: 500,  ceiling: 1000  },
    FCRA:           { floor: 100,  ceiling: 1000  },
    "TCPA+FDCPA":   { floor: 1000, ceiling: 2500  },
    CROA:           { floor: 1000, ceiling: 5000  },
    CIPA:           { floor: 5000, ceiling: 5000  }, // CA fixed $5k; override below for other states
    FL_FTSA:        { floor: 500,  ceiling: 1500  },
    UDAAP:          { floor: 500,  ceiling: 10000 },
    FCRA_FURNISHER: { floor: 100,  ceiling: 1000  },
    ECOA:           { floor: 500,  ceiling: 10000 },
    ROSENTHAL:      { floor: 100,  ceiling: 1000  },
    FCCPA:          { floor: 1000, ceiling: 1000  },
    GLBA:           { floor: 100,  ceiling: 2500  },
  };
  let perV = perVMap[ct] || { floor: 500, ceiling: 1500 };
  // State-specific overrides for the most common scenarios
  if (ct === "CIPA" && !["CA","FL","MA"].includes(clientState)) {
    perV = { floor: 1000, ceiling: 5000 };
  }
  if (ct === "FL_FTSA" && clientState !== "FL") {
    perV = { floor: 500, ceiling: 1500 }; // fall back — still worth noting
  }
  if (ct === "UDAAP" && clientState === "MA") {
    perV = { floor: 1000, ceiling: 10000 }; // MA 93A 2x-3x multiplier
  }
  return { floor: perV.floor, ceiling: perV.ceiling, source: "statutory" };
}

function BankruptcyPanel({ client }) {
  const [result, setResult] = useState(client.bankruptcyLookup || null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const creditBkr    = client.bankruptcies || [];
  const clFilings    = result?.courtListenerFilings || result?.pacerFilings || [];
  const pacerFilings = client.pacerBankruptcies || []; // from pacer-sync bulk ingest
  const stayViolations = result?.stayViolations || [];
  const hasAny = creditBkr.length > 0 || clFilings.length > 0 || pacerFilings.length > 0;

  async function runLookup() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/bankruptcy-lookup?clientId=${client.id}`);
      const d = await r.json();
      if (d.error && !d.pacerFilings) { setErr(d.error); }
      else setResult(d);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  return (
    <div style={{ padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Bankruptcy Filings
          {hasAny && <span style={{ marginLeft: 6, background: "#8b5cf620", color: "#8b5cf6", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>{pacerFilings.length || clFilings.length || creditBkr.length}</span>}
        </div>
        <button onClick={runLookup} disabled={loading} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-3)", cursor: loading ? "default" : "pointer" }}>
          {loading ? "Searching…" : result ? "Re-check CourtListener" : "Check Federal Courts (Free)"}
        </button>
      </div>

      {err && (
        <div style={{ fontSize: 11, color: "#f59e0b", padding: "6px 10px", background: "#f59e0b10", borderRadius: 6, marginBottom: 8 }}>
          {err}
        </div>
      )}

      {creditBkr.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-6)", marginBottom: 6 }}>From credit report</div>
          {creditBkr.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 700, color: "#8b5cf6" }}>Ch. {b.type?.replace("bankruptcy_ch", "") || "?"}</span>
              <span style={{ color: "var(--text-4)" }}>Filed {b.dateFiled || "unknown"}</span>
              {b.dateDischarged && <span style={{ color: "#22c55e" }}>Discharged {b.dateDischarged}</span>}
              {b.disposition && <span style={{ color: "var(--text-6)" }}>{b.disposition}</span>}
            </div>
          ))}
        </div>
      )}

      {pacerFilings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-6)", marginBottom: 8 }}>From PACER bulk sync</div>
          {pacerFilings.map((f, i) => {
            const parties = f.parties?.length
              ? f.parties
              : f.debtorName ? [{ role: "debtor", name: f.debtorName }] : [];
            const status = inferStatus(f);
            return (
              <div key={f.id || i} style={{
                padding: "10px 12px", marginBottom: 8, borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg-surface2)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                    {parties[0]?.name || "Unknown Debtor"}
                    {parties.length > 1 && (
                      <span style={{ fontSize: 10, color: "var(--text-5)", fontWeight: 400, marginLeft: 6 }}>
                        +{parties.length - 1} co-debtor{parties.length > 2 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                    {f.chapter && <span style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6" }}>Ch. {f.chapter}</span>}
                    <StatusBadge status={status} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 4 }}>
                  {f.caseNumber && <span style={{ fontFamily: "monospace", fontSize: 10, marginRight: 8 }}>{f.caseNumber}</span>}
                  {f.court && <span>{f.court}</span>}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-5)", marginBottom: parties.length > 0 ? 4 : 0 }}>
                  <span>Filed {fmtDate(f.dateFiled)}</span>
                  {f.dispositionDate && <span>Closed {fmtDate(f.dispositionDate)}</span>}
                </div>
                {parties.length > 0 && (
                  <div style={{ fontSize: 10, color: "var(--text-6)", marginBottom: 4 }}>
                    Parties: {parties.map((p, pi) => (
                      <span key={pi}>
                        {pi > 0 && " · "}
                        {p.name}
                        {p.role && <span style={{ fontStyle: "italic", color: "var(--text-7)" }}> ({p.role})</span>}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {f.matchConfidence === "low" && (
                    <span style={{ fontSize: 9, color: "#f59e0b", background: "#f59e0b15", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                      Review match
                    </span>
                  )}
                  {f.sourceUrl && (
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--accent)" }}>
                      View on PACER →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {clFilings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-6)", marginBottom: 6 }}>From CourtListener federal court records</div>
          {clFilings.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "6px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "#8b5cf6" }}>Ch. {f.chapter || "?"}</span>
              <span style={{ color: "var(--text-3)", fontFamily: "monospace", fontSize: 10 }}>{f.caseNumber}</span>
              <span style={{ color: "var(--text-4)" }}>{f.court}</span>
              <span style={{ color: "var(--text-5)" }}>Filed {f.filingDate || "?"}</span>
              {f.dischargeDate && <span style={{ color: "#22c55e" }}>Discharged {f.dischargeDate}</span>}
              {f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--accent)" }}>View docket</a>}
            </div>
          ))}
        </div>
      )}

      {stayViolations.length > 0 && (
        <div style={{ marginTop: 8, padding: "10px 12px", background: "#ef444415", border: "1px solid #ef444440", borderRadius: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>
            {stayViolations.length} Automatic Stay Violation{stayViolations.length > 1 ? "s" : ""} Detected
          </div>
          {stayViolations.map((v, i) => (
            <div key={i} style={{ fontSize: 11, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{v.creditor}</span>
              <span style={{ color: "var(--text-5)", marginLeft: 8 }}>contacted client after filing</span>
              <span style={{ marginLeft: 8, fontSize: 10, color: "#ef4444", fontWeight: 600 }}>{v.estimatedValue}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 6 }}>11 U.S.C. § 362 — each violation carries actual damages + punitive</div>
        </div>
      )}

      {!hasAny && !result && !loading && (
        <div style={{ fontSize: 11, color: "var(--text-6)", textAlign: "center", padding: "8px 0" }}>
          No bankruptcy filings on credit report. Click above to search PACER federal court records.
        </div>
      )}
      {result && !hasAny && (
        <div style={{ fontSize: 11, color: "var(--text-6)", textAlign: "center", padding: "8px 0" }}>
          No federal bankruptcy filings found for this client.
        </div>
      )}
    </div>
  );
}

function MatchedCasesPanel({ client, onMatchDone }) {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setState("loading");
    setError(null);
    try {
      const r = await fetch("/api/match-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "client-to-cases", clientId: client.id, topN: 30 }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMatches(d);
      setState("done");
      // Notify parent so it can show the banner + tab badge
      if (onMatchDone) {
        const allM = d.matches || [];
        const qual = allM.filter(m => m.kind === "tcpa" && m.qualifies);
        const floor   = qual.reduce((s, m) => s + (quickRecovery(m).floor   || 0), 0);
        const ceiling = qual.reduce((s, m) => s + (quickRecovery(m).ceiling || 0), 0);
        onMatchDone({ qualifying: qual.length, totalFloor: floor, totalCeiling: ceiling });
      }
    } catch (e) {
      setError(e.message);
      setState("error");
    }
  }

  // Auto-run whenever a client with credit data is selected
  useEffect(() => {
    setMatches(null);
    setState("idle");
    if (client?.id && (client?.creditAccounts?.length > 0 || client?.collectionsHistory?.length > 0)) {
      run();
    }
  }, [client?.id]);

  const fmtUSD = n => n >= 1000 ? `$${(n/1000).toFixed(0)}k` : `$${n}`;
  const reportUrl = client?.id ? `/api/client-report?clientId=${encodeURIComponent(client.id)}&format=html&fresh=1` : null;

  if (state === "idle") {
    return (
      <div style={{ padding: "14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 10 }}>Score this client against all TCPA / FDCPA cases and active leads</div>
        <Btn small onClick={run}>Find matches</Btn>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div style={{ padding: "16px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", textAlign: "center", fontSize: 11, color: "var(--text-5)" }}>
        Scoring against TCPA case database…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#ef4444" }}>
        {error}
        <button onClick={run} style={{ marginLeft: 10, fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
      </div>
    );
  }

  const all = (matches?.matches || []);
  const qualifying = all.filter(m => m.kind === "tcpa" && m.qualifies);
  const watchlist  = all.filter(m => m.kind === "tcpa" && !m.qualifies && m.score >= 40);
  const leads      = all.filter(m => m.kind === "lead");

  // Total recovery estimate across qualifying cases
  const totalFloor   = qualifying.reduce((s, m) => s + (quickRecovery(m).floor || 0), 0);
  const totalCeiling = qualifying.reduce((s, m) => s + (quickRecovery(m).ceiling || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Recovery summary + report button */}
      {qualifying.length > 0 && (
        <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", marginBottom: 2 }}>
                {qualifying.length} qualifying case{qualifying.length !== 1 ? "s" : ""} found
              </div>
              <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 700 }}>
                Est. {fmtUSD(totalFloor)} – {fmtUSD(totalCeiling)} potential recovery
              </div>
              <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>
                Based on statutory minimums and known settlement amounts
              </div>
            </div>
            {reportUrl && (
              <a href={reportUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, padding: "10px 18px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 700, flexShrink: 0 }}>
                Generate Full Report →
              </a>
            )}
          </div>
        </div>
      )}

      {qualifying.length === 0 && watchlist.length === 0 && leads.length === 0 && (
        <div style={{ padding: "14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 11, color: "var(--text-5)", textAlign: "center" }}>
          No matches found in the current case database. As new TCPA cases are ingested this client will be re-scored automatically.
        </div>
      )}

      {/* Qualifying cases */}
      {qualifying.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
            Qualifying — file claim now ({qualifying.length})
          </div>
          {qualifying.map((m, i) => {
            const cs = m.case || {};
            const sc = scoreColor(m.score || 0);
            const rec = quickRecovery(m);
            return (
              <div key={m.id || i} style={{ padding: "11px 12px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid rgba(34,197,94,0.3)", marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>
                      {cs.caption || m.caseId || "—"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 4 }}>
                      {(cs.defendants || []).map(d => d.displayName).filter(Boolean).join(", ") || cs.caseType || "—"}
                      {cs.settlement?.claimWindowCloses && (
                        <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 600 }}>
                          · Claim closes {cs.settlement.claimWindowCloses}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(m.matchingFactors || []).slice(0, 3).map((f, j) => (
                        <span key={j} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>{f}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#22c55e" }}>
                      {fmtUSD(rec.floor)} – {fmtUSD(rec.ceiling)}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-6)" }}>
                      {rec.source === "settlement" ? "settlement range" : "statutory est."}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: sc, marginTop: 4 }}>{m.score}/100</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Watchlist */}
      {watchlist.length > 0 && (
        <details>
          <summary style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.07em", cursor: "pointer", marginBottom: 6 }}>
            Watchlist — review eligibility ({watchlist.length})
          </summary>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            {watchlist.map((m, i) => {
              const cs = m.case || {};
              const rec = quickRecovery(m);
              return (
                <div key={m.id || i} style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface2)", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{cs.caption || "—"}</div>
                    <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 2 }}>{(m.disqualifyingFactors || []).slice(0, 2).join(" · ")}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>{fmtUSD(rec.floor)} – {fmtUSD(rec.ceiling)}</div>
                    <div style={{ fontSize: 10, color: "var(--text-5)" }}>{m.score}/100</div>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Mass tort leads */}
      {leads.length > 0 && (
        <details>
          <summary style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", cursor: "pointer", marginBottom: 6 }}>
            Mass tort leads ({leads.length})
          </summary>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {leads.map((m, i) => {
              const l = m.lead || {};
              return (
                <div key={m.id || i} style={{ padding: "7px 10px", borderRadius: 6, background: "var(--bg-surface2)", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>{l.analysis?.headline || l.title || "—"}</div>
                  <div style={{ fontSize: 10, color: scoreColor(m.score || 0), fontWeight: 700, flexShrink: 0 }}>{m.score}/100</div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Report + re-run controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, padding: "6px 14px", borderRadius: 6, background: qualifying.length ? "var(--accent)" : "var(--bg-surface2)", color: qualifying.length ? "#fff" : "var(--text-3)", border: qualifying.length ? "none" : "1px solid var(--border)", textDecoration: "none", fontWeight: 600 }}>
            {qualifying.length ? "Full eligibility report →" : "Generate report →"}
          </a>
        )}
        {reportUrl && (
          <a href={`/api/client-report?clientId=${encodeURIComponent(client.id)}&format=csv`} download
            style={{ fontSize: 11, padding: "6px 12px", borderRadius: 6, background: "var(--bg-surface2)", color: "var(--text-4)", border: "1px solid var(--border)", textDecoration: "none" }}>
            CSV
          </a>
        )}
        <button onClick={run} style={{ fontSize: 10, color: "var(--text-6)", background: "none", border: "none", cursor: "pointer", marginLeft: "auto" }}>Re-run</button>
      </div>
    </div>
  );
}

// ── Simple CSV parser (handles quoted fields, comma + tab + semicolon) ────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect delimiter
  const firstLine = lines[0];
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  function parseLine(line) {
    const fields = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === delim && !inQ) {
        fields.push(cur.trim()); cur = "";
      } else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, "_"));
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v));

  return { headers, rows };
}

// Flexible column mapping — tries to auto-detect common header names
function autoMap(headers) {
  const find = (...terms) => headers.find(h => terms.some(t => h.includes(t))) || "";
  return {
    firstName:        find("first_name", "firstname", "first"),
    lastName:         find("last_name", "lastname", "last"),
    email:            find("email"),
    phone:            find("phone", "mobile", "cell"),
    state:            find("state"),
    city:             find("city"),
    dob:              find("dob", "birth", "birthdate", "date_of_birth"),
    age:              find("age"),
    injuries:         find("injur", "condition", "diagnosis", "medical", "harm"),
    productsUsed:     find("product", "device", "item"),
    medicationsUsed:  find("medication", "drug", "medicine", "rx", "prescription"),
    exposurePeriod:   find("exposure", "period", "exposure_date", "dates"),
    occupation:       find("occupation", "job", "employer", "employment", "work"),
    caseNotes:        find("notes", "comment", "description", "detail", "memo"),
    originalCaseType: find("case_type", "casetype", "type_of_case", "matter"),
    existingCases:    find("existing", "prior", "previous", "history"),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({ label, value, color = "var(--accent)" }) {
  return (
    <div style={{ padding: "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function RetainerBadge({ status }) {
  if (!status) return null;
  const color = retainerColor(status);
  return (
    <span style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4,
      background: `${color}20`,
      color,
      border: `1px solid ${color}40`,
      fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function ClientRow({ client, onSelect, onDelete, selected }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "center", padding: "10px 14px",
        borderRadius: 8, cursor: "pointer", transition: "all 0.13s",
        background: selected ? "rgba(94,234,212,0.08)" : hov ? "var(--bg-surface)" : "transparent",
        border: `1px solid ${selected ? "rgba(94,234,212,0.3)" : hov ? "var(--border-hov)" : "var(--border)"}`,
        marginBottom: 4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }} onClick={onSelect}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {client.firstName} {client.lastName}
          </span>
          {client.state && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(100,120,220,0.12)", color: "#8090d0", border: "1px solid rgba(100,120,220,0.2)" }}>
              {client.state}
            </span>
          )}
          {client.age && <span style={{ fontSize: 10, color: "var(--text-5)" }}>age {client.age}</span>}
          {client.matchedLeads?.length > 0 && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
              {client.matchedLeads.length} match{client.matchedLeads.length > 1 ? "es" : ""}
            </span>
          )}
          <RetainerBadge status={client.retainerStatus || "Uncontacted"} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {client.injuries && (
            <span style={{ fontSize: 11, color: "var(--text-5)" }}>Injuries: {client.injuries.slice(0, 60)}</span>
          )}
          {client.medicationsUsed && (
            <span style={{ fontSize: 11, color: "var(--text-6)" }}>Rx: {client.medicationsUsed.slice(0, 40)}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 2 }}>{client.sourceFirm}</div>
      </div>
      {hov && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(client.id); }}
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#ef4444", cursor: "pointer", flexShrink: 0 }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

// ── Outreach Drafter sub-component ────────────────────────────────────────────
function OutreachDrafter({ client, lead }) {
  const [status, setStatus] = useState("idle"); // idle | loading | streaming | done | error
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  async function draft() {
    setText("");
    setCopied(false);
    setStatus("loading");

    try {
      const resp = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, lead }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        setStatus("error");
        setText(`Error ${resp.status}: ${err.slice(0, 200)}`);
        return;
      }

      setStatus("streaming");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              setText(t => t + ev.delta.text);
            }
            if (ev.type === "message_stop") {
              setStatus("done");
            }
            if (ev.type === "error") {
              setStatus("error");
              setText(ev.error?.message || "Unknown error");
            }
          } catch {
            // non-JSON SSE line, skip
          }
        }
      }
      setStatus(s => s === "streaming" ? "done" : s);
    } catch (e) {
      setStatus("error");
      setText(e.message);
    }
  }

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
      {status === "idle" && (
        <button
          onClick={draft}
          style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "rgba(59,130,246,0.12)", color: "#3b82f6",
            border: "1px solid rgba(59,130,246,0.3)", cursor: "pointer",
          }}
        >
          Draft Outreach Letter
        </button>
      )}

      {status === "loading" && (
        <div style={{ fontSize: 11, color: "var(--text-5)", padding: "6px 0" }}>Drafting letter…</div>
      )}

      {(status === "streaming" || status === "done" || status === "error") && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Outreach Letter{status === "streaming" ? " (streaming…)" : status === "done" ? " — Done" : " — Error"}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {status === "done" && (
                <button
                  onClick={copy}
                  style={{ padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", background: copied ? "rgba(34,197,94,0.15)" : "var(--bg-surface)", color: copied ? "#22c55e" : "var(--text-4)", border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : "var(--border)"}` }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
              <button
                onClick={() => { setStatus("idle"); setText(""); }}
                style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer", background: "none", color: "var(--text-6)", border: "1px solid var(--border)" }}
              >
                Clear
              </button>
              {status !== "streaming" && (
                <button
                  onClick={draft}
                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer", background: "none", color: "var(--text-5)", border: "1px solid var(--border)" }}
                >
                  Regenerate
                </button>
              )}
            </div>
          </div>
          <pre style={{
            margin: 0, padding: "10px 12px", borderRadius: 7,
            background: "var(--bg-surface2)", border: "1px solid var(--border)",
            fontSize: 11, color: status === "error" ? "#ef4444" : "var(--text-2)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6,
            maxHeight: 320, overflowY: "auto",
            fontFamily: "inherit",
          }}>
            {text || " "}
          </pre>
        </div>
      )}
    </div>
  );
}

function MatchResult({ match, rank }) {
  const [hov, setHov] = useState(false);
  const [exp, setExp] = useState(false);
  const sc = scoreColor(match.score || 0);
  const c = match.client || {};

  return (
    <div
      onClick={() => setExp(x => !x)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "12px 14px", borderRadius: 8, marginBottom: 6,
        background: hov ? "var(--bg-surface)" : "var(--bg-surface2)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 46, flexShrink: 0, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", fontWeight: 700 }}>#{rank}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: sc, lineHeight: 1.1 }}>{match.score}</div>
          {match.qualifies && <div style={{ fontSize: 9, fontWeight: 700, color: "#22c55e" }}>QUALIFIES</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>
            {c.firstName} {c.lastName}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 3 }}>{match.reason}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {c.state && <span style={{ fontSize: 10, color: "var(--text-6)" }}>{c.state}</span>}
            {c.age && <span style={{ fontSize: 10, color: "var(--text-6)" }}>age {c.age}</span>}
            <span style={{ fontSize: 10, color: "var(--text-7)" }}>{c.sourceFirm}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-6)", flexShrink: 0 }}>{exp ? "▲" : "▼"}</div>
      </div>

      {exp && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {c.injuries && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Injuries</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.injuries}</div></div>}
            {c.medicationsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Medications</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.medicationsUsed}</div></div>}
            {c.productsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Products</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.productsUsed}</div></div>}
            {c.exposurePeriod && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Exposure Period</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.exposurePeriod}</div></div>}
          </div>
          {match.matchingFactors?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Qualifying Factors</div>
              {match.matchingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>+ {f}</div>)}
            </div>
          )}
          {match.disqualifyingFactors?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 9, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Disqualifying Factors</div>
              {match.disqualifyingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "#f87171" }}>− {f}</div>)}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>{c.email}</a>}
            {c.phone && <span style={{ fontSize: 11, color: "var(--text-5)" }}>{c.phone}</span>}
          </div>
          <OutreachDrafter client={c} lead={match.lead || {}} />
        </div>
      )}
    </div>
  );
}

// ── URL-based ingest panel (for large files from credit.com download links) ──
function UrlIngestPanel({ partner, onStart }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/ingest-credit-report-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), partner }),
      });
      const d = await r.json();
      if (!d.jobId) throw new Error(d.error || "Failed to start");
      onStart({ jobId: d.jobId, total: d.total || 0, processed: 0, pct: 0, status: "running", imported: 0, updated: 0, failed: 0 });
    } catch (e) {
      setErr(e.message);
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setOpen(true)} style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          Ingest from URL (credit.com download link / S3)
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ingest from URL</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 8 }}>Paste a direct download URL (CSV or JSON). No size limit — streams directly from the source.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://files.credit.com/export/clients-2026-05.csv"
          style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
        <Btn onClick={submit} disabled={loading || !url.trim()}>{loading ? "Starting…" : "Start"}</Btn>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-5)", fontSize: 12 }}>Cancel</button>
      </div>
      {err && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// ── Import Wizard ─────────────────────────────────────────────────────────────
function ImportWizard({ onImported, onGoToClient }) {
  const [step, setStep] = useState("upload"); // upload → map → confirm → done
  const [firmName, setFirmName] = useState("");
  const [partnerId, setPartnerId] = useState("manual"); // partner registry dropdown
  const [partners, setPartners] = useState([]);         // loaded from /api/partners
  const [parsed, setParsed] = useState(null);     // { headers, rows }
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);     // rich import report
  const [manualMode, setManualMode] = useState(false);
  const [crMode, setCrMode] = useState(false);    // credit-report upload mode
  const [crFile, setCrFile] = useState(null);
  const [crPreview, setCrPreview] = useState(null);
  const [crMatches, setCrMatches] = useState(null);   // loaded after ingest
  const [crMatchState, setCrMatchState] = useState("idle"); // idle|loading|done|error
  const fileRef = useRef(null);
  const crFileRef = useRef(null);

  useEffect(() => {
    fetch("/api/partners")
      .then(r => r.json())
      .then(d => setPartners(d.partners || []))
      .catch(() => setPartners([]));
  }, []);

  // Auto-run case matching once the credit report client is saved
  useEffect(() => {
    const clientId = result?.client?.id;
    if (!result?.isCreditReport || !clientId) return;
    setCrMatchState("loading");
    setCrMatches(null);
    fetch("/api/match-cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "client-to-cases", clientId, caseType: "AUTO", topN: 20 }),
    })
      .then(r => r.json())
      .then(d => { setCrMatches(d.matches || []); setCrMatchState("done"); })
      .catch(() => { setCrMatchState("error"); });
  }, [result?.client?.id]);

  // Manual entry state
  const [manual, setManual] = useState({ firstName: "", lastName: "", email: "", phone: "", state: "", age: "", injuries: "", medicationsUsed: "", productsUsed: "", exposurePeriod: "", occupation: "", caseNotes: "", originalCaseType: "" });

  const FIELD_LABELS = {
    firstName: "First Name *", lastName: "Last Name *", email: "Email", phone: "Phone",
    state: "State (2-letter)", age: "Age", dob: "Date of Birth",
    injuries: "Injuries / Conditions", medicationsUsed: "Medications / Drugs",
    productsUsed: "Products / Devices", exposurePeriod: "Exposure Period",
    occupation: "Occupation", caseNotes: "Case Notes / Comments",
    originalCaseType: "Original Case Type", existingCases: "Prior Cases",
  };

  // ── Credit-report upload handler ─────────────────────────────────────────
  const [crJob, setCrJob] = useState(null); // { jobId, pct, status, ... }
  const crPollRef = useRef(null);
  const [crElapsed, setCrElapsed] = useState(0); // seconds since extraction started
  const crTimerRef = useRef(null);

  async function handleCrFile(file) {
    if (!file) return;
    setCrFile(file);
    const mb = file.size / 1024 / 1024;
    const warn = mb > 8 ? `File is ${mb.toFixed(1)} MB — extraction may take 60+ seconds. For faster processing, print the credit report to a smaller PDF or export as JSON.` : null;
    setCrPreview({ status: warn ? "warn" : "ready", name: file.name, size: mb.toFixed(1) + " MB", warn });
  }

  function stopCrPoll() {
    if (crPollRef.current) { clearInterval(crPollRef.current); crPollRef.current = null; }
  }

  async function pollJob(jobId) {
    try {
      const r = await fetch(`/api/ingest-job?id=${jobId}`);
      const d = await r.json();
      setCrJob(d);
      if (d.status === "complete" || d.status === "error") {
        stopCrPoll();
        setResult({
          imported:       d.imported || 0,
          updated:        d.updated  || 0,
          invalid:        d.failed   || 0,
          queuedForMatch: d.imported + d.updated || 0,
          errors:         (d.errors || []).slice(0, 10),
        });
        setStep("done");
        onImported((d.imported || 0) + (d.updated || 0));
        setImporting(false);
      }
    } catch { /* network blip — keep polling */ }
  }

  function stopCrTimer() {
    if (crTimerRef.current) { clearInterval(crTimerRef.current); crTimerRef.current = null; }
  }

  async function submitCrUpload(isBulk) {
    if (!crFile) return;
    setImporting(true);
    setCrJob(null);
    setCrElapsed(0);
    stopCrTimer();
    crTimerRef.current = setInterval(() => setCrElapsed(s => s + 1), 1000);
    try {
      const p = partnerId && partnerId !== "manual" ? partnerId : "credit_com";

      // Convert file to base64 — chunked to avoid call stack overflow on large files
      const arrayBuffer = await crFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      const base64 = btoa(binary);

      if (isBulk) {
        // Bulk path — job-based, poll for progress
        const r = await fetch("/api/ingest-credit-report-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: base64, filename: crFile.name, contentType: crFile.type || "", partner: p }),
        });
        const d = await r.json();
        if (!d.ok && !d.jobId) throw new Error(d.error || "Ingest failed to start");
        setCrJob({ jobId: d.jobId, total: d.total, processed: 0, pct: 0, status: "running",
                   imported: 0, updated: 0, failed: 0 });
        // Poll every 2 seconds
        crPollRef.current = setInterval(() => pollJob(d.jobId), 2000);
      } else {
        // Single-report path — synchronous (120s timeout on backend)
        const r = await fetch("/api/ingest-credit-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: base64, filename: crFile.name, contentType: crFile.type || "", partner: p }),
        });
        let d;
        try {
          d = await r.json();
        } catch {
          throw new Error(`Server error ${r.status} — the PDF may be too large, or the extraction service timed out. Try a smaller file.`);
        }
        if (!d.ok) throw new Error(d.error || "Ingest failed");
        stopCrTimer();
        setImporting(false);
        onImported((d.imported || 0) + (d.updated || 0) || 1);
        // Navigate straight to the client card — pass pdfUrl so card shows it immediately
        if (d.client?.id && onGoToClient) {
          onGoToClient(d.client.id, d.client.creditReportPdfUrl || null);
        } else {
          // Fallback: show done screen if no ID came back
          setResult({
            imported: d.imported || 0, updated: d.updated || 0,
            invalid: 0, queuedForMatch: d.matchQueued || 0, errors: [],
            client: d.client || null, extraction: d.extraction || null,
            matches: [], isCreditReport: true,
          });
          setStep("done");
        }
      }
    } catch (e) {
      stopCrTimer();
      setCrPreview({ status: "error", error: e.message });
      setImporting(false);
    }
  }

  async function handleFile(file) {
    const name = (file.name || "").toLowerCase();
    const isExcel = /\.(xlsx|xls)$/.test(name);
    try {
      if (isExcel) {
        // Lazy-load SheetJS only when we actually see an Excel file — keeps
        // the main bundle clean for the common CSV path.
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        // Convert to row-of-arrays (matches our parseCSV output shape).
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
        if (!aoa.length) {
          alert(`No rows found in sheet '${sheetName}'.`);
          return;
        }
        const headers = aoa[0].map(h => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "_"));
        const rows = aoa.slice(1).map(arr => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = arr[i] != null ? String(arr[i]).trim() : ""; });
          return obj;
        }).filter(r => Object.values(r).some(v => v));
        const map = autoMap(headers);
        setParsed({ headers, rows });
        setMapping(map);
        setStep("map");
        return;
      }
      // CSV path — existing behavior
      const reader = new FileReader();
      reader.onload = e => {
        const { headers, rows } = parseCSV(e.target.result);
        const map = autoMap(headers);
        setParsed({ headers, rows });
        setMapping(map);
        setStep("map");
      };
      reader.readAsText(file);
    } catch (e) {
      alert(`Failed to parse file: ${e.message}`);
    }
  }

  function buildClients(rows, map) {
    return rows.map(row => {
      const get = field => map[field] ? row[map[field]] || "" : "";
      return {
        firstName: get("firstName"), lastName: get("lastName"),
        email: get("email"), phone: get("phone"), state: get("state"),
        age: get("age"), dob: get("dob"),
        injuries: get("injuries"), medicationsUsed: get("medicationsUsed"),
        productsUsed: get("productsUsed"), exposurePeriod: get("exposurePeriod"),
        occupation: get("occupation"), caseNotes: get("caseNotes"),
        originalCaseType: get("originalCaseType"), existingCases: get("existingCases"),
        sourceFirm: firmName || "Imported Firm",
      };
    }).filter(c => c.firstName || c.lastName);
  }

  async function doImport(clients) {
    setImporting(true);
    // Send in batches of 500 — accumulate the rich import report.
    const aggregate = { imported: 0, updated: 0, invalid: 0, queuedForMatch: 0, errors: [] };
    const BATCH_SIZE = 500;
    const qs = partnerId && partnerId !== "manual" ? `?partner=${encodeURIComponent(partnerId)}` : "";
    for (let i = 0; i < clients.length; i += BATCH_SIZE) {
      const r = await fetch(`/api/clients${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: clients.slice(i, i + BATCH_SIZE) }),
      });
      const d = await r.json();
      aggregate.imported       += d.imported       || 0;
      aggregate.updated        += d.updated        || 0;
      aggregate.invalid        += d.invalid        || 0;
      aggregate.queuedForMatch += d.queuedForMatch || 0;
      if (Array.isArray(d.errors)) aggregate.errors.push(...d.errors.slice(0, 10));
    }
    setResult(aggregate);
    setImporting(false);
    setStep("done");
    onImported(aggregate.imported + aggregate.updated);
  }

  if (step === "done") {
    const r = result || {};

    // ── Credit report extraction result ──────────────────────────────────────
    if (r.isCreditReport) {
      const c = r.client || {};
      const x = r.extraction || {};
      const SCORE_COLOR = s => s >= 70 ? "#22c55e" : s >= 50 ? "#f59e0b" : "#6b7280";
      const qualifying = (crMatches || []).filter(m => m.qualifies);
      const nonQual    = (crMatches || []).filter(m => !m.qualifies && m.score >= 40);

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Client card saved banner ────────────────────────────── */}
          <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)", marginBottom: 2 }}>
                {c.name || "Client"} — saved to database
                {r.updated && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-5)", marginLeft: 8 }}>(merged with existing record)</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-5)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                {c.state && <span>{c.state}</span>}
                {c.dob && <span>DOB {c.dob}</span>}
                {c.creditScore && <span>Score {c.creditScore}</span>}
                {c.ssnLast4 && <span>SSN ···{c.ssnLast4}</span>}
                {c.phones?.[0] && <span>{c.phones[0]}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {c.id && onGoToClient && (
                <button onClick={() => onGoToClient(c.id)}
                  style={{ fontSize: 12, padding: "8px 16px", borderRadius: 6, background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>
                  View client profile →
                </button>
              )}
              {c.id && (
                <a href={`/api/client-report?clientId=${encodeURIComponent(c.id)}&format=html`}
                   target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 12, padding: "8px 14px", borderRadius: 6, background: "var(--bg-surface2)", color: "var(--text-2)", textDecoration: "none", fontWeight: 600, border: "1px solid var(--border)" }}>
                  Full report ↗
                </a>
              )}
            </div>
          </div>

          {/* ── Extraction snapshot ─────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
            {[
              [x.totalAccounts || 0,  "Total accounts",  "var(--accent)"],
              [x.collections   || 0,  "Collections",      "#ef4444"],
              [x.lateAccounts  || 0,  "Accounts w/ lates","#f59e0b"],
              [x.bankruptcies  || 0,  "Bankruptcies",     "#8b5cf6"],
              [x.taxLiens      || 0,  "Tax liens",        "#f59e0b"],
              [x.civilJudgments|| 0,  "Civil judgments",  "#f59e0b"],
              [x.inquiries     || 0,  "Inquiries",        "#6b7280"],
            ].filter(([n]) => n > 0).map(([n, label, color]) => (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-surface2)", border: `1px solid ${color}30`, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── Creditors extracted ─────────────────────────────────── */}
          {x.creditors?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                {x.creditors.length} creditors on file — each a potential TCPA/FDCPA defendant
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {x.creditors.map(cr => (
                  <span key={cr} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, background: "var(--bg-surface2)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
                    {cr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Case analysis ───────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 10, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
              TCPA / FDCPA case analysis
            </div>

            {crMatchState === "loading" && (
              <div style={{ padding: "16px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-5)", textAlign: "center" }}>
                Scoring against case database…
              </div>
            )}

            {crMatchState === "error" && (
              <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", fontSize: 12, color: "#ef4444" }}>
                Match analysis unavailable — view the client profile for manual matching.
              </div>
            )}

            {crMatchState === "done" && qualifying.length === 0 && nonQual.length === 0 && (
              <div style={{ padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-5)" }}>
                No qualifying matches against current case database. As new cases are ingested this client will be re-scored automatically each hour.
              </div>
            )}

            {crMatchState === "done" && (qualifying.length > 0 || nonQual.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...qualifying, ...nonQual].map((m, i) => (
                  <div key={m.caseId || i} style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: `1px solid ${m.qualifies ? "#22c55e40" : "var(--border)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>
                        {m.caption || m.caseId}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: SCORE_COLOR(m.score) }}>{m.score}/100</span>
                        {m.qualifies && (
                          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "#22c55e20", color: "#22c55e", fontWeight: 700, border: "1px solid #22c55e40", whiteSpace: "nowrap" }}>
                            QUALIFIES
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 4 }}>
                      {m.caseType} · {m.status}
                      {m.perClaimantRange && <span style={{ color: "#22c55e", fontWeight: 600 }}> · Est. {m.perClaimantRange}</span>}
                      {m.claimWindowCloses && ` · Claim closes ${m.claimWindowCloses}`}
                    </div>
                    {m.matchingFactors?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {m.matchingFactors.slice(0, 4).map((f, j) => (
                          <span key={j} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(34,197,94,0.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.disqualifyingFactors?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {m.disqualifyingFactors.slice(0, 2).map((f, j) => (
                          <span key={j} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Address + employment sidebar ────────────────────────── */}
          {(x.addressHistory?.length > 0 || x.employmentHistory?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {x.addressHistory?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Address history</div>
                  {x.addressHistory.map((a, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>{a}</div>)}
                </div>
              )}
              {x.employmentHistory?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Employment</div>
                  {x.employmentHistory.map((e, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>{e}</div>)}
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-6)" }}>
              Client ID: <span style={{ fontFamily: "monospace", color: "var(--text-4)" }}>{c.id}</span>
            </div>
            <Btn onClick={() => { setStep("upload"); setParsed(null); setResult(null); setCrFile(null); setCrPreview(null); setCrJob(null); setCrMatches(null); setCrMatchState("idle"); }}>
              Upload another
            </Btn>
          </div>
        </div>
      );
    }

    // ── CSV / bulk import result (existing) ──────────────────────────────────
    const partnerName = partners.find(p => p.id === partnerId)?.name || firmName || "imported firm";
    return (
      <div style={{ padding: "32px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#22c55e", lineHeight: 1, marginBottom: 8 }}>
            {(r.imported || 0) + (r.updated || 0)}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Clients ingested</div>
          <div style={{ fontSize: 13, color: "var(--text-5)" }}>from {partnerName}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20, maxWidth: 600, margin: "0 auto 20px" }}>
          {[
            ["New",            r.imported || 0,       "#22c55e"],
            ["Merged",         r.updated || 0,        "#3b82f6"],
            ["Invalid",        r.invalid || 0,        "#ef4444"],
            ["Queued to match", r.queuedForMatch || 0, "var(--accent)"],
          ].map(([label, value, color]) => (
            <div key={label} style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 4, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
        {r.errors?.length > 0 && (
          <div style={{ maxWidth: 600, margin: "0 auto 20px", fontSize: 11, color: "var(--text-5)" }}>
            <details>
              <summary style={{ cursor: "pointer", color: "#ef4444" }}>{r.errors.length} validation error(s) — first 10 shown</summary>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {r.errors.map((e, i) => <li key={i}>Row {e.index}: {e.error}</li>)}
              </ul>
            </details>
          </div>
        )}
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-6)", marginBottom: 20 }}>
          Auto-matching against TCPA case database in background.
          High-confidence matches will surface in <strong style={{ color: "var(--accent)" }}>Campaigns → Pending Outreach</strong> within an hour.
        </div>
        <div style={{ textAlign: "center" }}>
          <Btn onClick={() => { setStep("upload"); setParsed(null); setFirmName(""); setResult(null); }}>Import another roster</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Partner dropdown — drives which importer normalizes the upload */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 6, fontWeight: 600 }}>PARTNER</div>
        <select
          value={partnerId}
          onChange={e => setPartnerId(e.target.value)}
          style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text-1)", fontSize: 13, outline: "none" }}
        >
          <option value="manual">Manual / No partner</option>
          {partners.filter(p => p.status === "active").map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 4 }}>
          Picks the per-partner field mapper. Adding a new partner: <code style={{ color: "var(--accent)" }}>POST /api/partners</code> + drop a normalizer in <code style={{ color: "var(--accent)" }}>api/_partner-importers/</code>.
        </div>
      </div>

      {/* Firm name — used when partner = manual, or as a sub-grouping under a partner */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 6, fontWeight: 600 }}>ACQUIRED FIRM NAME (optional)</div>
        <input
          value={firmName}
          onChange={e => setFirmName(e.target.value)}
          placeholder="e.g. Johnson & Associates Law Firm"
          style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text-1)", fontSize: 13, outline: "none" }}
        />
      </div>

      {/* Toggle manual vs CSV vs Credit Report */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setManualMode(false); setCrMode(false); }} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: !manualMode && !crMode ? "var(--accent)" : "var(--bg-surface)", color: !manualMode && !crMode ? "#fff" : "var(--text-4)", border: `1px solid ${!manualMode && !crMode ? "var(--accent)" : "var(--border)"}` }}>
          CSV / Spreadsheet
        </button>
        <button onClick={() => { setManualMode(false); setCrMode(true); setCrFile(null); setCrPreview(null); }} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: crMode ? "var(--accent)" : "var(--bg-surface)", color: crMode ? "#fff" : "var(--text-4)", border: `1px solid ${crMode ? "var(--accent)" : "var(--border)"}` }}>
          Credit Report (PDF / JSON)
        </button>
        <button onClick={() => { setManualMode(true); setCrMode(false); }} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: manualMode ? "var(--accent)" : "var(--bg-surface)", color: manualMode ? "#fff" : "var(--text-4)", border: `1px solid ${manualMode ? "var(--accent)" : "var(--border)"}` }}>
          Add Single Client
        </button>
      </div>

      {/* MANUAL ENTRY */}
      {manualMode && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field} style={{ gridColumn: ["caseNotes", "injuries"].includes(field) ? "1 / -1" : undefined }}>
                <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
                {["caseNotes", "injuries"].includes(field) ? (
                  <textarea value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))} rows={2}
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none", resize: "vertical" }} />
                ) : field === "state" ? (
                  <select value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))}
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                    <option value="">— Select —</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))} placeholder=""
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
                )}
              </div>
            ))}
          </div>
          <Btn onClick={() => doImport([{ ...manual, sourceFirm: firmName || "Manual Entry" }])} disabled={importing || !manual.firstName}>
            {importing ? "Saving…" : "Add Client"}
          </Btn>
        </div>
      )}

      {/* CREDIT REPORT UPLOAD */}
      {crMode && (
        <div>
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-4)", lineHeight: 1.6 }}>
            Upload a credit report PDF (TransUnion, Experian, Equifax, Stretto joint) or JSON export.
            We extract every tradeline as a potential TCPA defendant and run full case matching automatically.
          </div>
          {/* Drop zone */}
          <div
            onClick={() => crFileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCrFile(f); }}
            style={{ border: "2px dashed var(--border-md)", borderRadius: 12, padding: "36px 24px", textAlign: "center", cursor: "pointer", marginBottom: 14, background: crFile ? "var(--bg-surface2)" : "transparent" }}
          >
            {crFile ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>{crFile.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-5)" }}>{(crFile.size / 1024).toFixed(0)} KB — click to replace</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Drop credit report here</div>
                <div style={{ fontSize: 11, color: "var(--text-5)" }}>PDF (TransUnion, Experian, Equifax, Stretto) · JSON · CSV tradeline export</div>
              </div>
            )}
            <input ref={crFileRef} type="file" accept=".pdf,.json,.csv,.tsv,.txt" style={{ display: "none" }}
              onChange={e => e.target.files[0] && handleCrFile(e.target.files[0])} />
          </div>

          {crPreview?.status === "error" && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fee2e2", border: "1px solid #fca5a5", fontSize: 12, color: "#b91c1c", marginBottom: 12 }}>
              <strong>Extraction failed:</strong> {crPreview.error}
            </div>
          )}
          {crPreview?.status === "warn" && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef3c7", border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
              {crPreview.warn}
            </div>
          )}

          {/* Live progress bar for bulk jobs */}
          {crJob && crJob.status === "running" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-5)", marginBottom: 6 }}>
                <span>Processing {(crJob.processed || 0).toLocaleString()} / {(crJob.total || 0).toLocaleString()} records</span>
                <span>{crJob.pct || 0}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--bg-surface2)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${crJob.pct || 0}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.5s" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
                {[["New", crJob.imported || 0, "#22c55e"], ["Merged", crJob.updated || 0, "#3b82f6"], ["Failed", crJob.failed || 0, "#ef4444"]].map(([label, val, color]) => (
                  <div key={label} style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface2)", border: "1px solid var(--border)", textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{val.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {crFile && !crJob && (
            <div>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => submitCrUpload(false)} disabled={importing} style={{ flex: 1 }}>
                  {importing
                    ? `Extracting… (${crElapsed}s — Claude is reading the PDF, usually 30-60s)`
                    : "Single report (PDF / JSON)"}
                </Btn>
                <Btn onClick={() => submitCrUpload(true)} disabled={importing} style={{ flex: 1, background: "var(--bg-surface2)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
                  {importing ? "Starting…" : "Bulk upload (CSV — millions of records)"}
                </Btn>
              </div>
              {importing && crElapsed > 5 && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-5)", textAlign: "center" }}>
                  Claude is reading every tradeline, address, employment record, and public filing from the PDF.
                  This takes 30–60 seconds — do not close this tab.
                </div>
              )}
            </div>
          )}

          {/* URL-based ingest for large files */}
          {!crJob && (
            <UrlIngestPanel partner={partnerId && partnerId !== "manual" ? partnerId : "credit_com"}
              onStart={(job) => { setCrJob(job); setImporting(true); crPollRef.current = setInterval(() => pollJob(job.jobId), 2000); }} />
          )}

          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-5)", lineHeight: 1.7 }}>
            <strong style={{ color: "var(--text-3)", display: "block", marginBottom: 6 }}>What gets extracted from each report:</strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 20px" }}>
              {[
                ["Name, DOB, SSN last 4", "Identity + dedup key"],
                ["All phone numbers", "TCPA contact evidence"],
                ["Address history + dates", "Geographic eligibility"],
                ["Every tradeline (all creditors)", "TCPA defendant matching"],
                ["Payment history strings", "Violation count estimate"],
                ["Collection accounts", "FDCPA defendant matching"],
                ["Bankruptcy records", "§ 362/524 claims"],
                ["Hard inquiries", "FCRA permissible-purpose"],
              ].map(([field, use]) => (
                <div key={field}>
                  <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{field}</span>
                  <span style={{ color: "var(--text-6)" }}> — {use}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CSV UPLOAD */}
      {!manualMode && !crMode && step === "upload" && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          style={{
            border: "2px dashed var(--border-md)", borderRadius: 12, padding: "48px 24px",
            textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Drop CSV or spreadsheet here</div>
          <div style={{ fontSize: 12, color: "var(--text-5)" }}>Supports CSV, TSV, or semicolon-delimited exports from Clio, MyCase, PracticePanther, Filevine, or any spreadsheet</div>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>
      )}

      {/* COLUMN MAPPING */}
      {!manualMode && !crMode && step === "map" && parsed && (
        <div>
          <div style={{ marginBottom: 14, fontSize: 13, color: "var(--text-2)" }}>
            Detected <strong style={{ color: "var(--text-1)" }}>{parsed.rows.length} rows</strong>. Map your columns to client fields:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field}>
                <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
                <select
                  value={mapping[field] || ""}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                  style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
                >
                  <option value="">— Skip —</option>
                  {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Preview first 3 rows */}
          <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Preview (first 3 rows)</div>
            {buildClients(parsed.rows.slice(0, 3), mapping).map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                {c.firstName} {c.lastName} | {c.state} | {c.injuries?.slice(0, 40)} | {c.medicationsUsed?.slice(0, 40)}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => { const clients = buildClients(parsed.rows, mapping); doImport(clients); }} disabled={importing}>
              {importing ? `Importing…` : `Import ${parsed.rows.length} Clients →`}
            </Btn>
            <Btn variant="secondary" onClick={() => { setParsed(null); setStep("upload"); }}>Back</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lead picker for match runner ───────────────────────────────────────────────
function LeadPicker({ onPick }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/leads?limit=200&minScore=50")
      .then(r => r.json())
      .then(d => { setLeads(d.leads || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!q) return leads;
    const ql = q.toLowerCase();
    return leads.filter(l => {
      const a = l.analysis || {};
      return `${a.headline || l.title} ${a.caseType} ${a.defendantProfile?.name}`.toLowerCase().includes(ql);
    });
  }, [leads, q]);

  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search leads…"
        style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text-1)", fontSize: 13, outline: "none", marginBottom: 10 }} />
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-5)", padding: "16px 0" }}>Loading leads…</div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {filtered.slice(0, 60).map(lead => {
            const a = lead.analysis || {};
            return (
              <div key={lead.id} onClick={() => onPick(lead)}
                style={{ padding: "10px 12px", borderRadius: 7, cursor: "pointer", background: "var(--bg-surface2)", border: "1px solid var(--border)", transition: "all 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface)"}
                onMouseLeave={e => e.currentTarget.style.background = "var(--bg-surface2)"}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", lineHeight: 1, width: 32, flexShrink: 0 }}>{a.score || 0}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.headline || lead.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                      {a.caseType}{a.defendantProfile?.name && a.defendantProfile.name !== "Unknown" ? ` · vs. ${a.defendantProfile.name}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ fontSize: 12, color: "var(--text-6)", padding: "16px 0", textAlign: "center" }}>No leads match</div>}
        </div>
      )}
    </div>
  );
}

// ── Per-partner stat row ──────────────────────────────────────────────────────
// Reads from the freshness agent's rollup (counts.clients.byPartner). Cheap —
// one read per render. If the rollup hasn't run yet, renders nothing.
function PartnerStats() {
  const [byPartner, setByPartner] = useState(null);
  const [partners, setPartners] = useState({});

  useEffect(() => {
    Promise.all([
      fetch("/api/agents?rollup=freshness").then(r => r.json()).catch(() => ({})),
      fetch("/api/partners").then(r => r.json()).catch(() => ({})),
    ]).then(([rollup, partnerList]) => {
      setByPartner(rollup?.rollup?.counts?.clients?.byPartner || {});
      const map = {};
      (partnerList?.partners || []).forEach(p => { map[p.id] = p; });
      setPartners(map);
    });
  }, []);

  if (!byPartner) return null;
  const entries = Object.entries(byPartner).sort((a, b) => (b[1].total || 0) - (a[1].total || 0));
  if (!entries.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(entries.length, 4)}, 1fr)`, gap: 12 }}>
      {entries.slice(0, 4).map(([pid, stat]) => {
        const partnerName = partners[pid]?.name || (pid === "manual" ? "Manual / no partner" : pid);
        const pct = stat.total ? Math.round((stat.qualifyingMatches / stat.total) * 100) : 0;
        return (
          <div key={pid} style={{ padding: "14px 16px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, color: "var(--text-6)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
              {partnerName}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)", lineHeight: 1, marginTop: 6 }}>
              {(stat.total || 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4 }}>
              {stat.qualifyingMatches || 0} qualifying ({pct}%) · {stat.retained || 0} retained
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PACER Bankruptcy Sync Panel ───────────────────────────────────────────────
// ── MatchedCasesTable — browseable global view of all PACER-matched cases ────

function MatchedCasesTable({ clients, onNavigateToClient }) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [cases,   setCases]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [chapter, setChapter] = useState("");
  const [status,  setStatus]  = useState("");
  const [search,  setSearch]  = useState("");

  async function load(p = 0) {
    setLoading(true);
    const params = new URLSearchParams({ browse: "1", page: p });
    if (chapter) params.set("chapter", chapter);
    if (status)  params.set("status",  status);
    const d = await fetch(`/api/pacer-sync?${params}`).then(r => r.json()).catch(() => ({}));
    setCases(d.cases || []);
    setTotal(d.total || 0);
    setPage(p);
    setLoading(false);
  }

  useEffect(() => { if (open) load(0); }, [open, chapter, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = search
    ? cases.filter(c => {
        const hay = [c.debtorName, c.caseNumber, ...(c.parties || []).map(p => p.name)]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(search.toLowerCase());
      })
    : cases;

  const chipStyle = (active) => ({
    fontSize: 11, padding: "3px 10px", borderRadius: 99, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "rgba(99,102,241,0.12)" : "var(--bg-input)",
    color: active ? "var(--accent)" : "var(--text-4)",
    fontWeight: active ? 700 : 400,
  });

  const thStyle = {
    textAlign: "left", padding: "6px 8px", fontSize: 9, color: "var(--text-6)",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
          fontSize: 13, fontWeight: 700, color: "var(--text-2)",
          display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        Matched Cases
        {total > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-5)" }}>({total} indexed)</span>}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            {["", "7", "11", "12", "13"].map(ch => (
              <button key={ch} onClick={() => setChapter(ch)} style={chipStyle(chapter === ch)}>
                {ch ? `Ch. ${ch}` : "All chapters"}
              </button>
            ))}
            <select
              value={status} onChange={e => setStatus(e.target.value)}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg-input)",
                color: "var(--text-3)", outline: "none" }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="discharged">Discharged</option>
              <option value="dismissed">Dismissed</option>
              <option value="converted">Converted</option>
            </select>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name or case #…"
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg-input)",
                color: "var(--text-1)", outline: "none", minWidth: 180 }}
            />
          </div>

          {loading ? (
            <div style={{ fontSize: 12, color: "var(--text-5)", padding: "20px 0", textAlign: "center" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-6)", padding: "20px 0", textAlign: "center" }}>
              {cases.length === 0 ? "No matched cases yet — run a sync to populate." : "No cases match current filters."}
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Debtor Name", "Case #", "Ch.", "Court", "Filed", "Status", "Client", "Conf."].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c, i) => {
                      const primaryName = c.parties?.[0]?.name || c.debtorName || "—";
                      const extraParties = (c.parties?.length || 0) > 1 ? ` +${c.parties.length - 1}` : "";
                      const clientNames = (c.clientIds || [])
                        .map(id => { const cl = clients.find(x => x.id === id); return cl ? `${cl.firstName || ""} ${cl.lastName || ""}`.trim() : null; })
                        .filter(Boolean).join(", ");
                      const firstClientId = c.clientIds?.[0];
                      return (
                        <tr
                          key={c.id || i}
                          onClick={() => firstClientId && onNavigateToClient?.(firstClientId)}
                          style={{
                            borderBottom: "1px solid var(--border)",
                            cursor: firstClientId ? "pointer" : "default",
                            background: i % 2 === 0 ? "transparent" : "var(--bg-surface2)",
                          }}
                        >
                          <td style={{ padding: "7px 8px", fontWeight: 600, color: "var(--text-2)" }}>
                            {primaryName}
                            {extraParties && <span style={{ fontSize: 9, color: "var(--text-6)", marginLeft: 4 }}>{extraParties}</span>}
                          </td>
                          <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: 10, color: "var(--text-4)" }}>{c.caseNumber || "—"}</td>
                          <td style={{ padding: "7px 8px", color: "#8b5cf6", fontWeight: 700 }}>{c.chapter || "—"}</td>
                          <td style={{ padding: "7px 8px", color: "var(--text-5)" }}>{c.court || "—"}</td>
                          <td style={{ padding: "7px 8px", color: "var(--text-5)", whiteSpace: "nowrap" }}>{fmtDate(c.dateFiled)}</td>
                          <td style={{ padding: "7px 8px" }}><StatusBadge status={c.status || "active"} /></td>
                          <td style={{ padding: "7px 8px", color: "var(--text-3)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientNames || "—"}</td>
                          <td style={{ padding: "7px 8px" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: c.matchConfidence === "high" ? "#22c55e" : "#f59e0b" }}>
                              {c.matchConfidence === "high" ? "High" : "Low"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, justifyContent: "flex-end" }}>
                <span style={{ fontSize: 11, color: "var(--text-5)" }}>Page {page + 1} · {total} total</span>
                <button onClick={() => load(page - 1)} disabled={page === 0}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--bg-input)", color: page === 0 ? "var(--text-7)" : "var(--text-3)",
                    cursor: page === 0 ? "default" : "pointer" }}>
                  ← Prev
                </button>
                <button onClick={() => load(page + 1)} disabled={cases.length < 50}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--bg-input)", color: cases.length < 50 ? "var(--text-7)" : "var(--text-3)",
                    cursor: cases.length < 50 ? "default" : "pointer" }}>
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Pulls ALL bankruptcy filings from PACER (complete national coverage),
// matches debtor names against the client roster. Only case metadata is
// retrieved — no documents or docket sheets are downloaded.
function PacerSyncPanel({ clients = [], onNavigateToClient }) {
  const [backfillActive, setBackfillActive] = useState(false);
  const [backfillClient, setBackfillClient] = useState(null);
  const [backfillDone,   setBackfillDone]   = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, withFilings: 0 });
  const [msg, setMsg] = useState(null);

  // Per-client backfill: calls bankruptcy-lookup for every client that doesn't
  // already have a lookup result. CourtListener searches by name across all
  // federal BK courts — no rate-limit problem, complete historical coverage.
  async function startBackfill() {
    const unchecked = clients.filter(c => !c.bankruptcyLookup && (c.firstName || c.lastName));
    if (!unchecked.length) {
      setMsg("All clients already checked.");
      return;
    }
    setBackfillActive(true); setBackfillDone(false); setMsg(null);
    setProgress({ done: 0, total: unchecked.length, withFilings: 0 });

    let withFilings = 0;
    // /api/bankruptcy-lookup POST accepts up to 50 clientIds at once
    const BATCH = 10;
    for (let i = 0; i < unchecked.length; i += BATCH) {
      const batch = unchecked.slice(i, i + BATCH);
      setBackfillClient(`${batch[0].firstName || ""} ${batch[0].lastName || ""}`.trim());
      try {
        const r = await fetch("/api/bankruptcy-lookup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientIds: batch.map(c => c.id) }),
        });
        const d = await r.json();
        if (d.error) { setMsg(`Error: ${d.error}`); break; }
        withFilings += d.withFilings || 0;
        const done = Math.min(i + BATCH, unchecked.length);
        setProgress({ done, total: unchecked.length, withFilings });
        setMsg(`Checked ${done} / ${unchecked.length} clients — ${withFilings} with filings`);
      } catch (e) { setMsg(`Error: ${e.message}`); break; }
    }

    setBackfillActive(false);
    setBackfillClient(null);
    setBackfillDone(true);
  }

  const uncheckedCount = clients.filter(c => !c.bankruptcyLookup && (c.firstName || c.lastName)).length;
  const checkedCount   = clients.filter(c => !!c.bankruptcyLookup).length;
  const withFilings    = clients.filter(c => c.bankruptcyLookup?.hasFilings).length;

  return (
    <Card>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
          Bankruptcy Lookup
        </div>
        <div style={{ fontSize: 11, color: "var(--text-5)" }}>
          Searches CourtListener for each client's name across all 95 federal bankruptcy courts.
          Free, no documents downloaded, covers all available history.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        {[
          ["Clients checked",   `${checkedCount} / ${clients.length}`],
          ["With BK filings",   String(withFilings)],
          ["Not yet checked",   String(uncheckedCount)],
        ].map(([l, v]) => (
          <div key={l} style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>{v}</div>
          </div>
        ))}
      </div>

      {backfillActive && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 6 }}>
            Checking {backfillClient || "…"} — {progress.done} / {progress.total} clients
          </div>
          <div style={{ height: 4, background: "var(--bg-surface2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", background: "var(--accent)", borderRadius: 2, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, transition: "width 0.3s" }} />
          </div>
        </div>
      )}

      {msg && (
        <div style={{
          fontSize: 11, padding: "8px 12px", borderRadius: 6, marginBottom: 12,
          background: msg.startsWith("Error") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.06)",
          color:      msg.startsWith("Error") ? "#ef4444" : "#22c55e",
          border:     `1px solid ${msg.startsWith("Error") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.2)"}`,
        }}>
          {msg}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small onClick={startBackfill} disabled={backfillActive || uncheckedCount === 0}
          style={!backfillActive ? { background: "#8b5cf6", borderColor: "#8b5cf6" } : {}}>
          {backfillActive ? `Checking clients…` : backfillDone ? "Re-run Lookup" : `Check ${uncheckedCount} Clients`}
        </Btn>
        {backfillDone && uncheckedCount === 0 && (
          <Btn small onClick={() => { setBackfillDone(false); clients.forEach(c => { if (c.bankruptcyLookup) delete c.bankruptcyLookup; }); }}>
            Re-check All
          </Btn>
        )}
      </div>

      <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 10 }}>
        Runs in batches of 10. Already-checked clients are skipped unless you re-check all.
        Results appear on each client's bankruptcy panel automatically.
      </div>

      <MatchedCasesTable clients={clients} onNavigateToClient={onNavigateToClient} />
    </Card>
  );
}



// ── Main Clients tab ───────────────────────────────────────────────────────────
export default function Clients() {
  const [view, setView] = useState("database"); // database | import | match | bankruptcy
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [firms, setFirms] = useState([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [retainerFilter, setRetainerFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [importCount, setImportCount] = useState(0);

  // Reset client tab when selection changes; open Credit Report tab automatically
  // for clients that have credit report data
  useEffect(() => {
    if (!selectedClient) return;
    setClientMatchData(null);
    const hasCreditReport = selectedClient.creditAccounts?.length > 0 ||
                            selectedClient.collectionsHistory?.length > 0 ||
                            selectedClient.bankruptcies?.length > 0;
    setClientTab(hasCreditReport ? "credit" : "profile");
  }, [selectedClient?.id]);

  // Match state
  const [matchView, setMatchView] = useState("pick"); // pick | running | results
  const [matchLead, setMatchLead] = useState(null);
  const [matchFirmFilter, setMatchFirmFilter] = useState("");
  const [matchResults, setMatchResults] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [clientTab, setClientTab] = useState("profile"); // profile | credit | cases
  const [clientMatchData, setClientMatchData] = useState(null); // { qualifying, totalFloor, totalCeiling }

  const fetchClients = useCallback((params = "") => {
    setLoading(true);
    fetch(`/api/clients${params}`)
      .then(r => r.json())
      .then(d => { setClients(d.clients || []); setFirms(d.firms || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients, importCount]);

  // Apply filters
  const filtered = useMemo(() => {
    let out = clients;
    if (firmFilter) out = out.filter(c => c.sourceFirm === firmFilter);
    if (stateFilter) out = out.filter(c => c.state === stateFilter);
    if (retainerFilter) out = out.filter(c => (c.retainerStatus || "Uncontacted") === retainerFilter);
    if (searchQ) {
      const ql = searchQ.toLowerCase();
      out = out.filter(c => `${c.firstName} ${c.lastName} ${c.injuries} ${c.medicationsUsed} ${c.productsUsed}`.toLowerCase().includes(ql));
    }
    return out;
  }, [clients, firmFilter, stateFilter, retainerFilter, searchQ]);

  async function deleteClient(id) {
    await fetch(`/api/clients?id=${id}`, { method: "DELETE" });
    setClients(cs => cs.filter(c => c.id !== id));
    if (selectedClient?.id === id) setSelectedClient(null);
  }

  async function updateRetainerStatus(clientId, status) {
    // Optimistically update local state
    setClients(cs => cs.map(c => {
      if (c.id !== clientId) return c;
      const now = new Date().toISOString();
      const history = [...(c.retainerHistory || []), { status, date: now }];
      return { ...c, retainerStatus: status, retainerHistory: history };
    }));
    if (selectedClient?.id === clientId) {
      setSelectedClient(sc => {
        if (!sc) return sc;
        const now = new Date().toISOString();
        const history = [...(sc.retainerHistory || []), { status, date: now }];
        return { ...sc, retainerStatus: status, retainerHistory: history };
      });
    }
    // Persist to backend
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: clientId, retainerStatus: status }),
    });
  }

  async function runMatch() {
    if (!matchLead) return;
    setMatchLoading(true);
    setMatchView("running");
    try {
      const r = await fetch("/api/match-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: matchLead.id, firmFilter: matchFirmFilter || undefined }),
      });
      const d = await r.json();
      setMatchResults(d);
      setMatchView("results");
    } catch (e) {
      alert("Match error: " + e.message);
      setMatchView("pick");
    }
    setMatchLoading(false);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const retainedCount = clients.filter(c => c.retainerStatus === "Retained").length;
  const inProgressCount = clients.filter(c => c.retainerStatus === "Contacted" || c.retainerStatus === "Consultation").length;
  const statesRepresented = [...new Set(clients.map(c => c.state).filter(Boolean))].length;

  const hasFilters = firmFilter || stateFilter || retainerFilter || searchQ;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Total Clients" value={clients.length} color="var(--accent)" />
        <StatPill label="Firms Imported" value={firms.length} color="#3b82f6" />
        <StatPill label="Retained" value={retainedCount || "—"} color="#22c55e" />
        <StatPill label="In Progress" value={inProgressCount || "—"} color="#f59e0b" />
      </div>

      {/* ── Per-partner stat row (data from freshness rollup) ── */}
      <PartnerStats />

      {/* ── View selector ── */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {[
          { id: "database",    label: `Client Database (${clients.length})` },
          { id: "import",      label: "Import Clients" },
          { id: "match",       label: "Match to Cases" },
          { id: "bankruptcy",  label: "Bankruptcy Sync" },
        ].map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            padding: "9px 18px", border: "none", background: "transparent",
            borderBottom: view === v.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: view === v.id ? "var(--text-1)" : "var(--text-5)",
            fontWeight: view === v.id ? 700 : 400, fontSize: 13, cursor: "pointer", marginBottom: -1,
          }}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── DATABASE VIEW ── */}
      {view === "database" && (
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>
          {/* Left: list */}
          <Card>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search name, injury, medication…"
                style={{ flex: 1, minWidth: 180, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
              <select value={firmFilter} onChange={e => setFirmFilter(e.target.value)}
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none", minWidth: 160 }}>
                <option value="">All Firms</option>
                {firms.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                <option value="">All States</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={retainerFilter} onChange={e => setRetainerFilter(e.target.value)}
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                <option value="">All Statuses</option>
                {RETAINER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
              Showing {filtered.length} of {clients.length} clients
              {hasFilters && (
                <button onClick={() => { setFirmFilter(""); setStateFilter(""); setRetainerFilter(""); setSearchQ(""); }}
                  style={{ marginLeft: 8, fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>
                  Clear filters
                </button>
              )}
            </div>
            {loading ? (
              <div style={{ fontSize: 12, color: "var(--text-5)", textAlign: "center", padding: "32px 0" }}>Loading clients…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 13, color: "var(--text-5)", marginBottom: 12 }}>
                  {clients.length === 0 ? "No clients imported yet." : "No clients match your filters."}
                </div>
                {clients.length === 0 && <Btn onClick={() => setView("import")}>Import Clients →</Btn>}
              </div>
            ) : (
              <div style={{ maxHeight: 600, overflowY: "auto" }}>
                {filtered.map(c => (
                  <ClientRow
                    key={c.id}
                    client={c}
                    selected={selectedClient?.id === c.id}
                    onSelect={() => setSelectedClient(c)}
                    onDelete={deleteClient}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Right: client detail */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {!selectedClient ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-6)", fontSize: 12 }}>
                Click a client to view their full profile
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

                {/* ── Header ── */}
                <div style={{ padding: "14px 16px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)" }}>
                        {selectedClient.firstName} {selectedClient.lastName}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 1, display: "flex", gap: 10 }}>
                        <span>{selectedClient.sourceFirm}</span>
                        {selectedClient.state && <span>{selectedClient.state}</span>}
                        {selectedClient.phone && <span>{selectedClient.phone}</span>}
                        {selectedClient.creditScore && <span style={{ color: "var(--accent)", fontWeight: 700 }}>Score {selectedClient.creditScore}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <RetainerBadge status={selectedClient.retainerStatus || "Uncontacted"} />
                      <button onClick={() => setSelectedClient(null)} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>✕</button>
                    </div>
                  </div>

                  {/* ── Tab bar ── */}
                  <div style={{ display: "flex", gap: 0 }}>
                    {[
                      { id: "profile", label: "Profile" },
                      ...(selectedClient.creditAccounts?.length > 0 || selectedClient.collectionsHistory?.length > 0 || selectedClient.bankruptcies?.length > 0
                        ? [{ id: "credit", label: `Credit Report (${(selectedClient.creditAccounts?.length || 0) + (selectedClient.collectionsHistory?.length || 0)})` }]
                        : []),
                      {
                        id: "cases",
                        label: clientMatchData?.qualifying > 0
                          ? `Matched Cases (${clientMatchData.qualifying})`
                          : "Matched Cases",
                        badge: clientMatchData?.qualifying > 0,
                      },
                    ].map(t => (
                      <button key={t.id} onClick={() => setClientTab(t.id)} style={{
                        padding: "7px 14px", border: "none", background: "transparent", fontSize: 11, cursor: "pointer",
                        borderBottom: clientTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                        color: t.badge ? "#22c55e" : clientTab === t.id ? "var(--text-1)" : "var(--text-5)",
                        fontWeight: (clientTab === t.id || t.badge) ? 700 : 400, marginBottom: -1,
                      }}>{t.label}</button>
                    ))}
                  </div>

                  {/* Match results banner — shown on Profile and Credit Report tabs */}
                  {clientMatchData?.qualifying > 0 && clientTab !== "cases" && (
                    <button onClick={() => setClientTab("cases")}
                      style={{ margin: "10px 16px 0", padding: "10px 14px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", width: "calc(100% - 32px)", textAlign: "left" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#22c55e" }}>
                          {clientMatchData.qualifying} case{clientMatchData.qualifying !== 1 ? "s" : ""} matched — Est. ${Math.round(clientMatchData.totalFloor/1000)}k – ${Math.round(clientMatchData.totalCeiling/1000)}k recovery
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 1 }}>Click to view cases and generate report</div>
                      </div>
                      <span style={{ fontSize: 14, color: "#22c55e" }}>→</span>
                    </button>
                  )}
                </div>

                {/* ── Tab content ── */}
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>

                  {/* PROFILE TAB */}
                  {clientTab === "profile" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          ["State", selectedClient.state], ["DOB", selectedClient.dob],
                          ["Age", selectedClient.age], ["SSN last 4", selectedClient.ssnLast4 ? `···${selectedClient.ssnLast4}` : null],
                          ["Email", selectedClient.email], ["Phone", selectedClient.phone],
                          ["Occupation", selectedClient.occupation], ["Original Case", selectedClient.originalCaseType],
                        ].map(([l, v]) => v ? (
                          <div key={l}>
                            <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{l}</div>
                            <div style={{ fontSize: 12, color: "var(--text-2)" }}>{v}</div>
                          </div>
                        ) : null)}
                      </div>

                      <div style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontWeight: 700 }}>Retainer Status</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <select value={selectedClient.retainerStatus || "Uncontacted"} onChange={e => updateRetainerStatus(selectedClient.id, e.target.value)}
                            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 12, color: retainerColor(selectedClient.retainerStatus || "Uncontacted"), outline: "none", cursor: "pointer", fontWeight: 600 }}>
                            {RETAINER_STATUSES.map(s => <option key={s} value={s} style={{ color: retainerColor(s) }}>{s}</option>)}
                          </select>
                        </div>
                        {selectedClient.retainerHistory?.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                            {selectedClient.retainerHistory.map((entry, i) => (
                              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: retainerColor(entry.status), flexShrink: 0, display: "inline-block" }} />
                                <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{entry.status}</span>
                                <span style={{ fontSize: 10, color: "var(--text-6)" }}>{entry.date ? new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {selectedClient.injuries && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Injuries / Conditions</div><div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.injuries}</div></div>}
                      {selectedClient.medicationsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Medications</div><div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.medicationsUsed}</div></div>}
                      {selectedClient.productsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Products / Devices</div><div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{selectedClient.productsUsed}</div></div>}
                      {selectedClient.caseNotes && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Case Notes</div><div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.caseNotes}</div></div>}

                      <BankruptcyPanel client={selectedClient} />
                    </div>
                  )}

                  {/* CREDIT REPORT TAB */}
                  {clientTab === "credit" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                      {/* PDF viewer — uses Blob URL if available, falls back to /api/client-pdf */}
                      {(() => {
                        const pdfSrc = selectedClient.creditReportPdfUrl ||
                          (selectedClient.id ? `/api/client-pdf?clientId=${selectedClient.id}` : null);
                        if (!pdfSrc) return null;
                        return (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              Original Credit Report PDF
                              <a href={pdfSrc} target="_blank" rel="noopener noreferrer"
                                 style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
                                Open full screen ↗
                              </a>
                            </div>
                            <object
                              data={pdfSrc}
                              type="application/pdf"
                              style={{ width: "100%", height: 500, borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }}
                            >
                              <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-5)", background: "var(--bg-surface2)", borderRadius: 8 }}>
                                PDF preview not supported in this browser.{" "}
                                <a href={pdfSrc} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                                  Open PDF →
                                </a>
                              </div>
                            </object>
                          </div>
                        );
                      })()}

                      {/* Summary row */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {[
                          [(selectedClient.creditAccounts?.length || 0) + (selectedClient.collectionsHistory?.length || 0), "Accounts", "var(--accent)"],
                          [(selectedClient.creditAccounts || []).filter(a => a.isCollection).length + (selectedClient.collectionsHistory?.length || 0), "Collections", "#ef4444"],
                          [(selectedClient.creditAccounts || []).filter(a => (a.latePayments?.d30||0)+(a.latePayments?.d60||0)+(a.latePayments?.d90||0)>0).length, "Late Accts", "#f59e0b"],
                          [selectedClient.bankruptcies?.length || 0, "Bankruptcies", "#8b5cf6"],
                          [selectedClient.taxLiens?.length || 0, "Tax Liens", "#f59e0b"],
                          [selectedClient.creditInquiries?.length || 0, "Inquiries", "#6b7280"],
                        ].filter(([n]) => n > 0).map(([n, label, color]) => (
                          <div key={label} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg-surface2)", border: `1px solid ${color}28`, textAlign: "center" }}>
                            <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{n}</div>
                            <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Collections — highlighted first */}
                      {(() => {
                        const cols = [...(selectedClient.creditAccounts || []).filter(a => a.isCollection), ...(selectedClient.collectionsHistory || [])];
                        if (!cols.length) return null;
                        return (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                              Collections ({cols.length}) — primary FDCPA/TCPA targets
                            </div>
                            {cols.map((a, i) => (
                              <div key={i} style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", marginBottom: 4 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                  <div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444" }}>{a.creditor || a.debtBuyer || "Unknown collector"}</div>
                                    {(a.originalCreditor || a.creditor !== a.debtBuyer) && <div style={{ fontSize: 10, color: "var(--text-5)" }}>Original: {a.originalCreditor || a.creditor}</div>}
                                  </div>
                                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                                    {a.balance != null && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>${Number(a.balance).toLocaleString()}</div>}
                                    {a.dateLastActivity && <div style={{ fontSize: 9, color: "var(--text-6)" }}>{a.dateLastActivity}</div>}
                                  </div>
                                </div>
                                {(a.latePayments?.d30||0)+(a.latePayments?.d60||0)+(a.latePayments?.d90||0) > 0 && (
                                  <div style={{ fontSize: 9, color: "#f59e0b", marginTop: 4 }}>
                                    {a.latePayments?.d30 > 0 && `${a.latePayments.d30}× 30d  `}
                                    {a.latePayments?.d60 > 0 && `${a.latePayments.d60}× 60d  `}
                                    {a.latePayments?.d90 > 0 && `${a.latePayments.d90}× 90d+ late`}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Tradelines grouped by type */}
                      {(() => {
                        const nonCol = (selectedClient.creditAccounts || []).filter(a => !a.isCollection);
                        if (!nonCol.length) return null;

                        const groups = [
                          { key: "revolving",    label: "Credit Cards",       color: "#3b82f6", accts: nonCol.filter(a => a.type === "revolving") },
                          { key: "installment",  label: "Installment Loans",  color: "#8b5cf6", accts: nonCol.filter(a => a.type === "installment") },
                          { key: "mortgage",     label: "Mortgages",          color: "#22c55e", accts: nonCol.filter(a => a.type === "mortgage") },
                          { key: "other",        label: "Other Accounts",     color: "#6b7280", accts: nonCol.filter(a => !["revolving","installment","mortgage"].includes(a.type)) },
                        ].filter(g => g.accts.length > 0);

                        const fmt = n => n != null ? `$${Number(n).toLocaleString()}` : null;
                        const statusColor = s => s?.includes("charged_off") || s?.includes("collection") ? "#ef4444"
                          : s?.includes("past_due") ? "#f59e0b" : "var(--text-6)";

                        return groups.map(g => (
                          <div key={g.key}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                              {g.label} ({g.accts.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                              {g.accts.map((a, i) => {
                                const lates = (a.latePayments?.d30||0)+(a.latePayments?.d60||0)+(a.latePayments?.d90||0);
                                const util = a.creditLimit > 0 && a.balance != null
                                  ? Math.round((a.balance / a.creditLimit) * 100) : null;
                                return (
                                  <div key={i} style={{ padding: "9px 11px", borderRadius: 7, background: "var(--bg-surface2)", border: `1px solid ${lates > 0 ? "#f59e0b40" : "var(--border)"}` }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                                      <div>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{a.creditor || "Unknown"}</span>
                                        {a.accountNumber && <span style={{ fontSize: 9, color: "var(--text-6)", marginLeft: 6 }}>···{a.accountNumber}</span>}
                                        {a.dateOpened && <span style={{ fontSize: 9, color: "var(--text-6)", marginLeft: 6 }}>opened {a.dateOpened.slice(0,7)}</span>}
                                      </div>
                                      <span style={{ fontSize: 10, color: statusColor(a.status), fontWeight: 500 }}>
                                        {(a.status || "").replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <div style={{ display: "flex", gap: 14, fontSize: 10, flexWrap: "wrap" }}>
                                      {a.balance != null && (
                                        <span>
                                          <span style={{ color: "var(--text-6)" }}>Balance </span>
                                          <span style={{ fontWeight: 700, color: "var(--text-2)" }}>{fmt(a.balance)}</span>
                                        </span>
                                      )}
                                      {a.creditLimit != null && (
                                        <span>
                                          <span style={{ color: "var(--text-6)" }}>Limit </span>
                                          <span style={{ color: "var(--text-3)" }}>{fmt(a.creditLimit)}</span>
                                          {util != null && (
                                            <span style={{ marginLeft: 4, color: util >= 90 ? "#ef4444" : util >= 60 ? "#f59e0b" : "#22c55e", fontWeight: 700 }}>
                                              {util}% util
                                            </span>
                                          )}
                                        </span>
                                      )}
                                      {a.monthlyPayment != null && (
                                        <span>
                                          <span style={{ color: "var(--text-6)" }}>Monthly </span>
                                          <span style={{ color: "var(--text-3)" }}>{fmt(a.monthlyPayment)}</span>
                                        </span>
                                      )}
                                      {lates > 0 && (
                                        <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                                          {a.latePayments?.d30 > 0 && `${a.latePayments.d30}×30d `}
                                          {a.latePayments?.d60 > 0 && `${a.latePayments.d60}×60d `}
                                          {a.latePayments?.d90 > 0 && `${a.latePayments.d90}×90d+`}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}

                      {/* Bankruptcies */}
                      {selectedClient.bankruptcies?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Bankruptcies</div>
                          {selectedClient.bankruptcies.map((b, i) => (
                            <div key={i} style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.2)", marginBottom: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#8b5cf6" }}>{(b.type || "Bankruptcy").replace(/_/g, " ").toUpperCase()}</div>
                              <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 2 }}>
                                {b.dateFiled && `Filed ${b.dateFiled}`}
                                {b.dateDischarged && ` · Discharged ${b.dateDischarged}`}
                                {b.disposition && ` · ${b.disposition}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Inquiries */}
                      {selectedClient.creditInquiries?.length > 0 && (
                        <details>
                          <summary style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", cursor: "pointer", marginBottom: 6 }}>
                            Inquiries ({selectedClient.creditInquiries.length})
                          </summary>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                            {selectedClient.creditInquiries.map((q, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", borderRadius: 5, background: "var(--bg-surface2)", border: "1px solid var(--border)", fontSize: 10 }}>
                                <span style={{ color: "var(--text-2)" }}>{q.creditor}</span>
                                <span style={{ color: "var(--text-6)" }}>{q.date} · {q.type}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* FCRA Signals — address variations, collection '9' codes, multi-bureau */}
                      {(() => {
                        const addrCount = selectedClient.addressHistory?.length || 0;
                        const allAccts  = [
                          ...(selectedClient.creditAccounts || []),
                          ...(selectedClient.collectionsHistory || []),
                        ];
                        // Accounts where payment history contains '9' = collection contact events
                        const nineAccts = allAccts.filter(a =>
                          a.paymentHistory && /9/.test(a.paymentHistory)
                        );
                        // Collection accounts with a balance outstanding (FDCPA + TCPA targets)
                        const colAccts = allAccts.filter(a =>
                          a.isCollection || a.type === "collection" || a.status === "in_collection"
                        );
                        const signals = [];
                        if (addrCount > 3) signals.push({
                          label: `${addrCount} address variations`,
                          detail: "Multiple address entries across bureaus = FCRA inaccuracy signal (§ 1681s-2 dispute)",
                          color: "#f59e0b",
                        });
                        if (nineAccts.length > 0) signals.push({
                          label: `${nineAccts.length} account${nineAccts.length > 1 ? "s" : ""} with '9' payment code`,
                          detail: `Collection-status contacts: ${nineAccts.map(a => a.creditor || a.debtBuyer || "Unknown").join(", ")}. Each '9' = FDCPA + TCPA contact event.`,
                          color: "#ef4444",
                        });
                        if (colAccts.length > 0) signals.push({
                          label: `${colAccts.length} collection account${colAccts.length > 1 ? "s" : ""}`,
                          detail: `Total: $${colAccts.reduce((s,a)=>s+(a.balance||a.amount||0),0).toLocaleString()} past due. Primary FDCPA + TCPA targets.`,
                          color: "#ef4444",
                        });
                        if (!signals.length) return null;
                        return (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                              FCRA Signals
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {signals.map((s, i) => (
                                <div key={i} style={{ padding: "8px 10px", borderRadius: 6, background: `rgba(245,158,11,0.07)`, border: `1px solid ${s.color}40` }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</div>
                                  <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 2, lineHeight: 1.4 }}>{s.detail}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Employment + Address */}
                      {(selectedClient.employmentHistory?.length > 0 || selectedClient.addressHistory?.length > 0) && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          {selectedClient.employmentHistory?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Employment</div>
                              {selectedClient.employmentHistory.map((e, i) => (
                                <div key={i} style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>{e.employer || e}{e.city ? `, ${e.city}` : ""}{e.state ? ` ${e.state}` : ""}</div>
                              ))}
                            </div>
                          )}
                          {selectedClient.addressHistory?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Address History</div>
                              {selectedClient.addressHistory.map((a, i) => (
                                <div key={i} style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>{a.city ? `${a.city}, ` : ""}{a.state}{a.start ? ` (${a.start.slice(0,4)})` : ""}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Diagnostic — shows what's in the record so we can confirm data was saved */}
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ fontSize: 9, color: "var(--text-7)", cursor: "pointer", letterSpacing: "0.05em" }}>
                          Record fields (diagnostic)
                        </summary>
                        <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-5)", fontFamily: "monospace", padding: "8px 10px", background: "var(--bg-surface)", borderRadius: 6, lineHeight: 1.8 }}>
                          <div>accounts: {selectedClient.creditAccounts?.length ?? 0}</div>
                          <div>collections: {selectedClient.collectionsHistory?.length ?? 0}</div>
                          <div>bankruptcies: {selectedClient.bankruptcies?.length ?? 0}</div>
                          <div>taxLiens: {selectedClient.taxLiens?.length ?? 0}</div>
                          <div>inquiries: {selectedClient.creditInquiries?.length ?? 0}</div>
                          <div>employment: {selectedClient.employmentHistory?.length ?? 0}</div>
                          <div>addresses: {selectedClient.addressHistory?.length ?? 0}</div>
                          <div>creditScore: {selectedClient.creditScore ?? "null"}</div>
                          <div>ssnLast4: {selectedClient.ssnLast4 ?? "null"}</div>
                          <div>pdfUrl: {selectedClient.creditReportPdfUrl ? "yes" : "no"}</div>
                          <div>clientId: {selectedClient.id}</div>
                        </div>
                      </details>
                    </div>
                  )}

                  {/* MATCHED CASES TAB — always rendered so auto-run fires even when on another tab */}
                  <div style={{ display: clientTab === "cases" ? "block" : "none" }}>
                    <MatchedCasesPanel client={selectedClient} onMatchDone={setClientMatchData} />
                    <InlineLeadMatch client={selectedClient} />
                  </div>

                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── IMPORT VIEW ── */}
      {view === "import" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Import Client Data</div>
          <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 20 }}>
            Import client lists from acquired firms. Supports CSV exports from Clio, MyCase, PracticePanther, Filevine, or any spreadsheet.
            All client data is stored securely in your database and used only for matching.
          </div>
          <ImportWizard
            onImported={count => { setImportCount(x => x + count); }}
            onGoToClient={async (clientId, pdfUrl) => {
              setView("database");
              for (let attempt = 0; attempt < 3; attempt++) {
                await new Promise(r => setTimeout(r, attempt === 0 ? 400 : 1000));
                const d = await fetch("/api/clients").then(r => r.json()).catch(() => ({}));
                const all = d.clients || [];
                setClients(all);
                setFirms(d.firms || []);
                const found = all.find(c => c.id === clientId);
                if (found) {
                  // Inject pdfUrl from ingest response — KV cache may not have it yet
                  if (pdfUrl && !found.creditReportPdfUrl) found.creditReportPdfUrl = pdfUrl;
                  setSelectedClient({ ...found });
                  break;
                }
              }
            }}
          />
        </Card>
      )}

      {/* ── MATCH VIEW ── */}
      {view === "match" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16 }}>
          {/* Left panel */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Run Client Match</div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 16 }}>
              Select a case lead, then Claude will score every client in your database against its plaintiff requirements.
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Filter by Firm (optional)</div>
              <select value={matchFirmFilter} onChange={e => setMatchFirmFilter(e.target.value)}
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                <option value="">All Firms ({clients.length} clients)</option>
                {firms.map(f => {
                  const n = clients.filter(c => c.sourceFirm === f).length;
                  return <option key={f} value={f}>{f} ({n})</option>;
                })}
              </select>
            </div>

            {matchLead ? (
              <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(94,234,212,0.08)", borderRadius: 8, border: "1px solid rgba(94,234,212,0.25)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Selected Lead</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>{matchLead.analysis?.headline || matchLead.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                  {matchLead.analysis?.caseType} · Score {matchLead.analysis?.score}
                </div>
                <button onClick={() => { setMatchLead(null); setMatchView("pick"); }}
                  style={{ marginTop: 8, fontSize: 10, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>
                  Change lead ×
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Select a Lead</div>
                <LeadPicker onPick={lead => { setMatchLead(lead); setMatchView("ready"); }} />
              </div>
            )}

            {matchLead && matchView !== "running" && (
              <Btn onClick={runMatch} disabled={matchLoading}>
                {matchLoading ? "Matching…" : `Match ${matchFirmFilter ? clients.filter(c => c.sourceFirm === matchFirmFilter).length : clients.length} Clients →`}
              </Btn>
            )}

            {matchView === "running" && (
              <div style={{ padding: "20px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 6 }}>Analyzing clients with AI…</div>
                <div style={{ fontSize: 11, color: "var(--text-6)" }}>This may take 30–60 seconds for large databases</div>
              </div>
            )}
          </Card>

          {/* Right panel — results */}
          <Card>
            {!matchResults ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⚖️</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Select a case lead to start matching</div>
                <div style={{ fontSize: 12, color: "var(--text-5)" }}>
                  Claude will screen every client in your database against the plaintiff requirements for the selected case
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>Match Results</div>
                    <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                      <span style={{ color: "#22c55e", fontWeight: 700 }}>{matchResults.qualifying}</span> qualifying out of{" "}
                      <span style={{ fontWeight: 600 }}>{matchResults.total}</span> clients scanned
                    </div>
                  </div>
                  <button onClick={() => { setMatchResults(null); setMatchLead(null); setMatchView("pick"); }}
                    style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>
                    New search
                  </button>
                </div>

                <div style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 14, fontSize: 11, color: "var(--text-4)" }}>
                  Case: <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{matchResults.leadTitle}</span>
                </div>

                {/* Score distribution */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "Strong (75+)", count: matchResults.matches.filter(m => m.score >= 75).length, color: "#22c55e" },
                    { label: "Good (50–74)", count: matchResults.matches.filter(m => m.score >= 50 && m.score < 75).length, color: "#f59e0b" },
                    { label: "Weak (25–49)", count: matchResults.matches.filter(m => m.score >= 25 && m.score < 50).length, color: "#fb923c" },
                    { label: "No Match (<25)", count: matchResults.matches.filter(m => m.score < 25).length, color: "#ef4444" },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ textAlign: "center", padding: "8px 6px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                      <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ maxHeight: 500, overflowY: "auto" }}>
                  {matchResults.matches.map((m, i) => (
                    <MatchResult key={m.id || i} match={m} rank={i + 1} />
                  ))}
                  {matchResults.matches.length === 0 && (
                    <div style={{ textAlign: "center", padding: "32px 0", fontSize: 12, color: "var(--text-6)" }}>
                      No clients matched this case's plaintiff requirements.
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── BANKRUPTCY SYNC VIEW ── */}
      {view === "bankruptcy" && (
        <PacerSyncPanel
          clients={clients}
          onNavigateToClient={(clientId) => {
            const found = clients.find(c => c.id === clientId);
            if (found) { setSelectedClient(found); setView("database"); }
          }}
        />
      )}
    </div>
  );
}
