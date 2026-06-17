import React, { useEffect, useState } from "react";

// Systemic Violation Reports tab — lists the per-defendant aggregate FCRA reports
// (built by tools/build-systemic-report.py into public/svr/) and renders the
// selected one in an iframe. The reports are self-contained static HTML; the
// access cookie is sent automatically so the iframe loads same-origin.
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);

export default function ViolationReports() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // file currently shown

  useEffect(() => {
    fetch("/svr/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`index.json ${r.status}`))))
      .then((d) => {
        const list = d.reports || [];
        setReports(list);
        if (list.length) setActive(list[0].file);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return <div style={{ padding: 40, color: "#ef4444" }}>Could not load reports: {error}</div>;
  if (!reports)
    return <div style={{ padding: 40, color: "var(--text-4)" }}>Loading reports…</div>;

  const activeReport = reports.find((r) => r.file === active);

  return (
    <div style={{ padding: "8px 0 0" }}>
      <div style={{ padding: "0 4px 14px" }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--text-1)", fontSize: 20 }}>
          Systemic Violation Reports
        </h2>
        <div style={{ fontSize: 12, color: "var(--text-5)" }}>
          Aggregate FCRA § 1681i furnisher analysis — {reports.length} defendants. Click a
          defendant to view the full report. Aggregate-only, no PII.
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Sidebar list */}
        <div style={{ flex: "0 0 320px", maxHeight: "calc(100vh - 190px)", overflowY: "auto" }}>
          {reports.map((r) => {
            const sel = r.file === active;
            return (
              <button
                key={r.file}
                onClick={() => setActive(r.file)}
                style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  marginBottom: 8, padding: "10px 12px", borderRadius: 8,
                  border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                  background: sel ? "var(--accent)" : "var(--bg-card)",
                  color: sel ? "#fff" : "var(--text-1)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
                <div style={{ fontSize: 11, marginTop: 4, color: sel ? "rgba(255,255,255,0.85)" : "var(--text-5)" }}>
                  {fmt(r.consumers)} consumers · <b style={{ color: sel ? "#fff" : "#c0392b" }}>{r.disputedPct}%</b> disputed · {fmt(r.dockets)} dockets
                </div>
              </button>
            );
          })}
        </div>

        {/* Report viewer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-5)" }}>
              {activeReport ? `${activeReport.name} — ${fmt(activeReport.disputedOwing)} disputed & still owing` : ""}
            </div>
            {active && (
              <a href={`/svr/${active}`} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                Open full page ↗
              </a>
            )}
          </div>
          {active && (
            <iframe
              key={active}
              title={activeReport?.name || "report"}
              src={`/svr/${active}`}
              style={{ width: "100%", height: "calc(100vh - 230px)", border: "1px solid var(--border)", borderRadius: 8, background: "#faf8f3" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
