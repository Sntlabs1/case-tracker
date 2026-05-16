import { useState, useEffect, useMemo } from "react";
import { Card, Btn } from "../components/UI.jsx";

function StatPill({ label, value, color = "#C8442F" }) {
  return (
    <div style={{ padding: "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function CaseCountBadge({ count }) {
  const color = count >= 100 ? "#C8442F" : count >= 25 ? "#f59e0b" : count >= 5 ? "#3b82f6" : "#6b7280";
  return (
    <span style={{
      fontSize: 10, padding: "1px 7px", borderRadius: 4,
      background: `${color}20`, color, border: `1px solid ${color}40`, fontWeight: 700,
      minWidth: 28, textAlign: "center", display: "inline-block",
    }}>
      {count}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DefendantRow({ d, onSelect, selected }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onSelect}
      style={{
        display: "flex", gap: 12, alignItems: "center", padding: "8px 12px",
        borderRadius: 6, cursor: "pointer", transition: "all 0.13s",
        background: selected ? "rgba(200,68,47,0.08)" : hov ? "var(--bg-surface)" : "transparent",
        border: `1px solid ${selected ? "rgba(200,68,47,0.3)" : hov ? "var(--border-hov)" : "var(--border)"}`,
        marginBottom: 3,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.displayName}
          </span>
          <CaseCountBadge count={d.caseCount} />
          {d.aliasCount > 1 && (
            <span style={{ fontSize: 9, color: "var(--text-6)" }}>+{d.aliasCount - 1} alias{d.aliasCount > 2 ? "es" : ""}</span>
          )}
        </div>
        {d.industry || d.hqState ? (
          <div style={{ fontSize: 10, color: "var(--text-6)" }}>
            {d.industry || "—"}{d.hqState ? ` · ${d.hqState}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DefendantDetail({ canonicalId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/defendants?id=${encodeURIComponent(canonicalId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [canonicalId]);

  if (loading) return <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-5)", fontSize: 12 }}>Loading defendant…</div>;
  if (error) return <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#ef4444" }}>{error}</div>;
  if (!data) return null;

  const d = data.defendant;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>
            {d.displayName}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <CaseCountBadge count={data.caseTotal} />
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>{data.caseTotal} TCPA / FDCPA / FCRA case{data.caseTotal === 1 ? "" : "s"}</span>
            {d.industry && <span style={{ fontSize: 10, color: "var(--text-6)" }}>· {d.industry}</span>}
            {d.hqState && <span style={{ fontSize: 10, color: "var(--text-6)" }}>· HQ {d.hqState}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>

      {d.aliases.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Known aliases ({d.aliases.length})</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {d.aliases.map((a, i) => (
              <span key={i} style={{ fontSize: 10, padding: "2px 8px", background: "var(--bg-surface2)", borderRadius: 4, color: "var(--text-3)", border: "1px solid var(--border)" }}>
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>
            Cases ({data.caseTotal})
          </div>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {data.cases.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-6)", padding: "12px", textAlign: "center" }}>No cases</div>
            ) : data.cases.map(c => (
              <div key={c.id} style={{ padding: "8px 10px", background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 5, marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
                  {c.caption}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-6)" }}>
                  {c.caseType} · {c.court || "—"}{c.state ? ` (${c.state})` : ""} · Filed {fmtDate(c.filingDate)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>
                  Status: {c.status}{c.claimWindowCloses ? ` · Claim closes ${fmtDate(c.claimWindowCloses)}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>
            Our clients exposed to this defendant ({data.linkedClients.length}{data.linkedClientCapped ? "+" : ""})
          </div>
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {data.linkedClients.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-6)", padding: "12px", textAlign: "center" }}>
                No clients with this defendant in their creditor history yet
              </div>
            ) : data.linkedClients.map(c => (
              <div key={c.id} style={{ padding: "8px 10px", background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 5, marginBottom: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>{c.name || "(no name)"}</span>
                  {c.state && <span style={{ fontSize: 9, color: "var(--text-6)" }}>{c.state}</span>}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-6)" }}>
                  {c.email || c.phone || "—"} · {c.collectionsCount} creditor entries
                </div>
                <a href={`/api/client-report?clientId=${encodeURIComponent(c.id)}&format=html`}
                   target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 10, color: "#3b82f6", textDecoration: "none", marginTop: 3, display: "inline-block" }}>
                  Open report ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Defendants() {
  const [defendants, setDefendants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minCases, setMinCases] = useState(0);
  const [selected, setSelected] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/defendants?limit=2000");
      const d = await r.json();
      setDefendants(Array.isArray(d.defendants) ? d.defendants : []);
    } catch {
      setDefendants([]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let arr = defendants;
    if (minCases > 0) arr = arr.filter(d => d.caseCount >= minCases);
    if (search.trim()) {
      const needle = search.toLowerCase();
      arr = arr.filter(d =>
        (d.displayName || "").toLowerCase().includes(needle) ||
        (d.aliases || []).some(a => (a || "").toLowerCase().includes(needle))
      );
    }
    return arr;
  }, [defendants, search, minCases]);

  const totalDefendants = defendants.length;
  const totalCases = defendants.reduce((acc, d) => acc + d.caseCount, 0);
  const repeatDefendants = defendants.filter(d => d.caseCount >= 5).length;
  const topDefendant = defendants[0]; // already sorted by case count desc

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Defendants tracked"         value={totalDefendants}                color="#C8442F" />
        <StatPill label="Repeat (≥ 5 cases)"          value={repeatDefendants}               color="#f59e0b" />
        <StatPill label="Top defendant cases"         value={topDefendant?.caseCount || "—"} color="#3b82f6" />
        <StatPill label="Case links indexed"          value={totalCases}                     color="#22c55e" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 2fr) 3fr", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search defendant / creditor (e.g. Capital One)…"
              style={{ flex: 1, minWidth: 160, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
            />
            <select value={minCases} onChange={e => setMinCases(parseInt(e.target.value))}
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
              <option value="0">All</option>
              <option value="2">≥ 2 cases</option>
              <option value="5">≥ 5 cases</option>
              <option value="10">≥ 10 cases</option>
              <option value="25">≥ 25 cases</option>
              <option value="100">≥ 100 cases (repeat offenders)</option>
            </select>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 8 }}>
            Showing {filtered.length} of {totalDefendants} defendants — sorted by case count
          </div>

          {loading ? (
            <div style={{ fontSize: 12, color: "var(--text-5)", textAlign: "center", padding: "32px 0" }}>Loading catalog…</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-6)", padding: "40px 12px", textAlign: "center" }}>
              {totalDefendants === 0 ? "No defendants ingested yet. Run /api/tcpa-ingest to populate." : "No matches."}
            </div>
          ) : (
            <div style={{ maxHeight: 720, overflowY: "auto" }}>
              {filtered.map(d => (
                <DefendantRow
                  key={d.canonicalId}
                  d={d}
                  selected={selected === d.canonicalId}
                  onSelect={() => setSelected(d.canonicalId)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          {!selected ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-6)", fontSize: 12 }}>
              Click a defendant to see all cases naming them and every client in our database who has them in their creditor history.
            </div>
          ) : (
            <DefendantDetail canonicalId={selected} onClose={() => setSelected(null)} />
          )}
        </Card>
      </div>
    </div>
  );
}
