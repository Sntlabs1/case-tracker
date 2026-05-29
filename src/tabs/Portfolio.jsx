import { useState, useEffect } from "react";
import { Card, Btn } from "../components/UI.jsx";

function StatPill({ label, value, color = "#C8442F", big = false }) {
  return (
    <div style={{ padding: big ? "20px 24px" : "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: big ? 36 : 26, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function fmtUSD(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Portfolio() {
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reBuilding, setReBuilding] = useState(false);

  useEffect(() => {
    fetch("/api/partners")
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d?.partners) ? d.partners : (Array.isArray(d) ? d : []);
        setPartners(arr);
        if (arr.length && !partnerId) setPartnerId(arr[0].id);
      })
      .catch(() => setPartners([]));
  }, []);

  async function loadReport({ fresh = false } = {}) {
    if (fresh) setReBuilding(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (partnerId) params.set("partner", partnerId);
      params.set("format", "json");
      if (fresh) params.set("fresh", "1");
      const r = await fetch(`/api/portfolio-report?${params.toString()}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setReport(d.report);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setReBuilding(false);
  }

  useEffect(() => {
    if (partnerId !== "") loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  const r = report;
  const htmlUrl = `/api/portfolio-report?partner=${encodeURIComponent(partnerId || "all")}&format=html`;
  const csvUrl  = `/api/portfolio-report?partner=${encodeURIComponent(partnerId || "all")}&format=csv`;
  const totals = r?.totals || {};
  const formatted = r?.totalsFormatted || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--text-5)", fontWeight: 600 }}>Partner:</label>
          <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 13, outline: "none", minWidth: 180 }}>
            <option value="">All clients</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>

          {partnerId === "" && (
            <Btn small onClick={() => loadReport()} disabled={loading}>
              {loading ? "Loading…" : "Load Report"}
            </Btn>
          )}

          <div style={{ flex: 1 }} />

          <a href={htmlUrl} target="_blank" rel="noopener noreferrer"
             style={{ fontSize: 12, padding: "7px 14px", borderRadius: 6, background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)", textDecoration: "none", fontWeight: 700 }}>
            Open printable report ↗
          </a>
          <a href={csvUrl} download
             style={{ fontSize: 12, padding: "7px 14px", borderRadius: 6, background: "var(--bg-surface)", color: "var(--text-3)", border: "1px solid var(--border-md)", textDecoration: "none", fontWeight: 700 }}>
            Download CSV
          </a>
          <Btn small variant="secondary" onClick={() => loadReport({ fresh: true })} disabled={reBuilding}>
            {reBuilding ? "Rebuilding…" : "Refresh"}
          </Btn>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 10 }}>
          Portfolio report aggregates per-client eligibility analysis across every plaintiff in the selected partner. Cached snapshot refreshes every 6 hours, or click Refresh to force a rebuild.
        </div>
      </Card>

      {loading && !report && (
        <Card><div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-5)", fontSize: 13 }}>Loading portfolio report…</div></Card>
      )}

      {error && (
        <Card><div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)", fontSize: 12, color: "#ef4444" }}>{error}</div></Card>
      )}

      {r && (
        <>
          {/* Hero — the headline number */}
          <Card style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.10) 0%, rgba(34,197,94,0.04) 100%)", border: "1px solid rgba(34,197,94,0.35)" }}>
            <div style={{ fontSize: 10, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 8 }}>
              Estimated total recoverable
            </div>
            <div style={{ fontSize: 48, fontWeight: 800, color: "#15803d", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
              {formatted.floor || "$0"} – {formatted.ceiling || "$0"}
            </div>
            <div style={{ fontSize: 13, color: "#16a34a", marginTop: 6, fontWeight: 600 }}>
              Midpoint: {formatted.midpoint || "$0"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 14 }}>
              Across <strong>{r.clientsWithRecovery?.toLocaleString() || 0}</strong> of {r.clientsAnalyzed?.toLocaleString() || 0} analyzed plaintiffs in <strong>{totals.matches?.toLocaleString() || 0}</strong> qualifying (plaintiff, case) matches.
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <StatPill label="Clients in scope"             value={(r.clientsTotal ?? 0).toLocaleString()}    color="#C8442F" />
            <StatPill label="Analyzed"                     value={(r.clientsAnalyzed ?? 0).toLocaleString()} color="#3b82f6" />
            <StatPill label="With qualifying matches"      value={(r.clientsWithRecovery ?? 0).toLocaleString()} color="#16a34a" />
            <StatPill label="Claim windows < 30d"          value={r.urgentClaims?.length ?? 0}                color="#ea580c" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 10 }}>Top defendants by exposure</div>
              <div style={{ maxHeight: 460, overflowY: "auto" }}>
                {r.topDefendants?.length ? r.topDefendants.slice(0, 15).map((d, i) => (
                  <div key={d.displayName + i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid var(--border)", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.displayName}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-6)" }}>
                        {d.clients} plaintiff{d.clients === 1 ? "" : "s"} · {d.matches} match{d.matches === 1 ? "" : "es"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>{fmtUSD(d.floor)} – {fmtUSD(d.ceiling)}</div>
                    </div>
                  </div>
                )) : <div style={{ fontSize: 11, color: "var(--text-6)", padding: 20, textAlign: "center" }}>No defendants matched yet</div>}
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 10 }}>Top cases by exposure</div>
              <div style={{ maxHeight: 460, overflowY: "auto" }}>
                {r.topCases?.length ? r.topCases.slice(0, 15).map((c) => (
                  <div key={c.caseId} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                      {c.caption}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>
                      {c.caseType} · {c.clients} plaintiff{c.clients === 1 ? "" : "s"} · {c.status}{c.claimWindowCloses ? ` · closes ${fmtDate(c.claimWindowCloses)}` : ""}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#15803d", marginTop: 3 }}>
                      {fmtUSD(c.floor)} – {fmtUSD(c.ceiling)}
                    </div>
                  </div>
                )) : <div style={{ fontSize: 11, color: "var(--text-6)", padding: 20, textAlign: "center" }}>No cases matched yet</div>}
              </div>
            </Card>
          </div>

          {r.urgentClaims?.length > 0 && (
            <Card style={{ border: "1px solid rgba(234,88,12,0.4)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ea580c", marginBottom: 10 }}>
                Urgent — claim windows closing within 30 days ({r.urgentClaims.length})
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {r.urgentClaims.slice(0, 30).map((u, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: "1px solid var(--border)", gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", minWidth: 50 }}>
                      {u.daysToClaim}d left
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.caption}</div>
                      <div style={{ fontSize: 10, color: "var(--text-6)" }}>closes {fmtDate(u.claimWindowCloses)}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d" }}>
                      {fmtUSD(u.estimate?.floor || 0)} – {fmtUSD(u.estimate?.ceiling || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>By status</div>
              {Object.entries(r.byStatus || {}).sort((a,b)=>b[1].ceiling-a[1].ceiling).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-2)" }}>{k} <span style={{ color: "var(--text-6)" }}>· {v.matches}</span></span>
                  <span style={{ color: "#15803d", fontWeight: 600 }}>{fmtUSD(v.floor)} – {fmtUSD(v.ceiling)}</span>
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>By case type</div>
              {Object.entries(r.byCaseType || {}).sort((a,b)=>b[1].ceiling-a[1].ceiling).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-2)" }}>{k} <span style={{ color: "var(--text-6)" }}>· {v.matches}</span></span>
                  <span style={{ color: "#15803d", fontWeight: 600 }}>{fmtUSD(v.floor)} – {fmtUSD(v.ceiling)}</span>
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>By recovery method</div>
              {Object.entries(r.byMethod || {}).sort((a,b)=>b[1].ceiling-a[1].ceiling).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-2)" }}>{k.replace(/_/g, " ")} <span style={{ color: "var(--text-6)" }}>· {v.matches}</span></span>
                  <span style={{ color: "#15803d", fontWeight: 600 }}>{fmtUSD(v.floor)} – {fmtUSD(v.ceiling)}</span>
                </div>
              ))}
            </Card>
          </div>

          <div style={{ fontSize: 10, color: "var(--text-7)", padding: "10px 14px", background: "rgba(245,158,11,0.06)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.18)", lineHeight: 1.5 }}>
            Recovery estimates apply TCPA / FDCPA / FCRA statutory minimums (47 USC § 227(b)(3) and equivalents) plus per-claimant settlement amounts where known. Floor uses lowest defensible per-violation amount; ceiling uses willful-violation maximums. Actual recovery depends on case-by-case proof, class membership verification, and settlement-administration outcomes. Not legal advice.
          </div>
        </>
      )}
    </div>
  );
}
