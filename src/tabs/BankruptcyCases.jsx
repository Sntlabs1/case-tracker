import { useState, useEffect } from "react";
import { Card, Btn } from "../components/UI.jsx";

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

export default function BankruptcyCases() {
  const [cases,   setCases]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapter, setChapter] = useState("");
  const [status,  setStatus]  = useState("");
  const [search,  setSearch]  = useState("");

  // Sync controls
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState(null);
  const [authOk,   setAuthOk]   = useState(null); // null=unknown, true, false
  const [billing,  setBilling]  = useState(null);

  async function loadCases(p = 0) {
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

  async function loadStats() {
    const d = await fetch("/api/pacer-sync?stats=1").then(r => r.json()).catch(() => ({}));
    setBilling(d.billing || null);
    setAuthOk(true); // CourtListener is free — no credentials required
  }

  async function runSync() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch("/api/pacer-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "daily" }),
      });
      const d = await r.json();
      if (d.error) {
        setSyncMsg({ ok: false, text: d.error });
      } else {
        setSyncMsg({ ok: true, text: `Synced ${d.dateFrom} → ${d.dateTo} · ${d.processed.toLocaleString()} filings scanned · ${d.matched} client matches` });
        await loadCases(0);
        await loadStats();
      }
    } catch (e) { setSyncMsg({ ok: false, text: e.message }); }
    setSyncing(false);
  }

  useEffect(() => { loadCases(0); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCases(0); }, [chapter, status]); // eslint-disable-line react-hooks/exhaustive-deps

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
    textAlign: "left", padding: "8px 10px", fontSize: 9, color: "var(--text-6)",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* Header + sync controls */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
                Bankruptcy Cases
              </div>
              {total > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-5)", background: "var(--bg-surface2)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)" }}>
                  {total} matched cases
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-5)" }}>
              Federal bankruptcy case metadata from CourtListener (free). Matched against your client roster.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn small onClick={runSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync Last 3 Days"}
            </Btn>
            <button
              onClick={() => { loadCases(page); loadStats(); }}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-5)", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>
        </div>

        {syncMsg && (
          <div style={{
            marginTop: 10, fontSize: 11, padding: "8px 12px", borderRadius: 6,
            background: syncMsg.ok ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.08)",
            color:      syncMsg.ok ? "#22c55e" : "#ef4444",
            border: `1px solid ${syncMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.25)"}`,
          }}>
            {syncMsg.text}
          </div>
        )}

        {total === 0 && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-5)" }}>
            No cases yet. Go to <strong>Clients → Bankruptcy Sync</strong> to run the backfill.
          </div>
        )}
      </Card>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {["", "7", "11", "12", "13"].map(ch => (
          <button key={ch} onClick={() => setChapter(ch)} style={chipStyle(chapter === ch)}>
            {ch ? `Chapter ${ch}` : "All chapters"}
          </button>
        ))}
        <select
          value={status} onChange={e => setStatus(e.target.value)}
          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-3)", outline: "none" }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="discharged">Discharged</option>
          <option value="dismissed">Dismissed</option>
          <option value="converted">Converted</option>
        </select>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search debtor name or case #…"
          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-1)", outline: "none", minWidth: 220 }}
        />
        {(chapter || status || search) && (
          <button onClick={() => { setChapter(""); setStatus(""); setSearch(""); }}
            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-5)", cursor: "pointer" }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--text-5)" }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--text-6)" }}>
            {total === 0
              ? "No matched cases yet. Run a sync or use the backfill in Clients → Bankruptcy Sync."
              : "No cases match current filters."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-surface2)" }}>
                  <th style={thStyle}>Debtor Name</th>
                  <th style={thStyle}>Parties</th>
                  <th style={thStyle}>Case #</th>
                  <th style={thStyle}>Ch.</th>
                  <th style={thStyle}>Court</th>
                  <th style={thStyle}>Filed</th>
                  <th style={thStyle}>Closed</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Matched Client</th>
                  <th style={thStyle}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const primaryName = c.parties?.[0]?.name || c.debtorName || "—";
                  const allParties  = c.parties?.length
                    ? c.parties
                    : c.debtorName ? [{ role: "debtor", name: c.debtorName }] : [];
                  const extraCount  = allParties.length - 1;

                  return (
                    <tr key={c.id || i} style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "transparent" : "var(--bg-surface2)",
                    }}>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: "var(--text-1)" }}>
                        {primaryName}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11, color: "var(--text-4)" }}>
                        {allParties.map((p, pi) => (
                          <div key={pi} style={{ whiteSpace: "nowrap" }}>
                            {p.name}
                            <span style={{ fontSize: 9, color: "var(--text-7)", marginLeft: 4, fontStyle: "italic" }}>{p.role}</span>
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "monospace", fontSize: 11, color: "var(--text-4)", whiteSpace: "nowrap" }}>
                        {c.sourceUrl ? (
                          <a href={c.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
                            {c.caseNumber || "—"}
                          </a>
                        ) : (c.caseNumber || "—")}
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: "#8b5cf6" }}>
                        {c.chapter || "—"}
                      </td>
                      <td style={{ padding: "9px 10px", color: "var(--text-5)", whiteSpace: "nowrap" }}>
                        {c.court || "—"}
                      </td>
                      <td style={{ padding: "9px 10px", color: "var(--text-4)", whiteSpace: "nowrap" }}>
                        {fmtDate(c.dateFiled)}
                      </td>
                      <td style={{ padding: "9px 10px", color: "var(--text-5)", whiteSpace: "nowrap" }}>
                        {fmtDate(c.dispositionDate)}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <StatusBadge status={c.status || "active"} />
                      </td>
                      <td style={{ padding: "9px 10px", color: "var(--text-3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(c.clientIds || []).length > 0
                          ? `${(c.clientIds || []).length} client${c.clientIds.length > 1 ? "s" : ""}`
                          : "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: c.matchConfidence === "high" ? "#22c55e" : "#f59e0b" }}>
                          {c.matchConfidence === "high" ? "High" : "Low"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11, color: "var(--text-5)", marginRight: "auto" }}>
              {filtered.length} of {total} cases · page {page + 1}
            </span>
            <button onClick={() => loadCases(page - 1)} disabled={page === 0}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: page === 0 ? "var(--text-7)" : "var(--text-3)", cursor: page === 0 ? "default" : "pointer" }}>
              ← Previous
            </button>
            <button onClick={() => loadCases(page + 1)} disabled={cases.length < 50}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: cases.length < 50 ? "var(--text-7)" : "var(--text-3)", cursor: cases.length < 50 ? "default" : "pointer" }}>
              Next →
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
