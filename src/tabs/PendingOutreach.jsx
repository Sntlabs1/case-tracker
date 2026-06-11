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

function ScorePill({ score }) {
  const c = score >= 90 ? "#16a34a" : score >= 80 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#fb923c";
  return (
    <span style={{
      fontSize: 12, padding: "3px 10px", borderRadius: 12, fontWeight: 800,
      background: `${c}22`, color: c, border: `1px solid ${c}55`,
      minWidth: 38, textAlign: "center", display: "inline-block",
    }}>
      {Math.round(score)}
    </span>
  );
}

function PartnerBadge({ id }) {
  if (!id) return null;
  const label = id === "credit_com" ? "credit.com" : id;
  return (
    <span style={{
      fontSize: 9, padding: "1px 6px", borderRadius: 4,
      background: "rgba(100,120,220,0.12)", color: "#8090d0",
      border: "1px solid rgba(100,120,220,0.2)", fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function PairRow({ item, onDismiss, onAction, busy }) {
  const [hov, setHov] = useState(false);
  const c = item.client;
  const cs = item.case;
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center",
        padding: "12px 14px", borderRadius: 8,
        background: hov ? "var(--bg-surface)" : "var(--bg-surface2)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        marginBottom: 6,
      }}
    >
      <div style={{ textAlign: "center", minWidth: 50 }}>
        <ScorePill score={item.score} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
            {c.firstName} {c.lastName}
          </span>
          {c.state && <span style={{ fontSize: 10, color: "var(--text-6)" }}>{c.state}</span>}
          <PartnerBadge id={c.partnerId} />
          <span style={{ fontSize: 10, color: "var(--text-7)" }}>·</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{cs.caption}</span>
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(100,120,220,0.12)", color: "#8090d0", fontWeight: 600 }}>
            {cs.caseType}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-6)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {cs.defendants?.length > 0 && (
            <span>vs. {cs.defendants.slice(0, 2).join(", ")}{cs.defendants.length > 2 ? ` +${cs.defendants.length - 2}` : ""}</span>
          )}
          {cs.court && <span>· {cs.court}</span>}
          {cs.status && <span>· {cs.status}</span>}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {c.phone && <span>{c.phone}</span>}
          {c.email && <span>{c.email}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <a
          href={`/api/client-report?clientId=${encodeURIComponent(c.id)}&format=html`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, padding: "5px 10px", borderRadius: 5, background: "var(--bg-card)", color: "var(--text-3)", border: "1px solid var(--border)", textDecoration: "none", fontWeight: 600 }}
        >
          Report
        </a>
        <Btn small variant="primary" onClick={() => onAction(item)} style={{ padding: "5px 12px", fontSize: 11 }}>
          Act
        </Btn>
        <button
          onClick={() => onDismiss(item.pair)}
          disabled={busy}
          style={{
            fontSize: 10, padding: "5px 10px", borderRadius: 5,
            background: "transparent", color: "var(--text-6)",
            border: "1px solid var(--border)", cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ActionDrawer({ item, onClose, onDismissAndAct }) {
  const [letter, setLetter] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | streaming | done | error
  const [error, setError] = useState(null);

  async function draft() {
    setLetter("");
    setPhase("streaming");
    setError(null);
    try {
      const r = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: {
            firstName: item.client.firstName,
            lastName:  item.client.lastName,
            state:     item.client.state,
            email:     item.client.email,
            phone:     item.client.phone,
          },
          lead: {
            title: item.case.caption,
            analysis: {
              headline: item.case.caption,
              caseType: item.case.caseType,
            },
          },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              setLetter((t) => t + ev.delta.text);
            }
            if (ev.type === "message_stop") setPhase("done");
          } catch {}
        }
      }
      setPhase((p) => (p === "streaming" ? "done" : p));
    } catch (e) {
      setError(e.message);
      setPhase("error");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)", width: "100%", maxWidth: 720, maxHeight: "85vh", overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>
              Outreach: {item.client.firstName} {item.client.lastName}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-6)", marginTop: 3 }}>
              {item.case.caption} · score {Math.round(item.score)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {phase === "idle" && (
          <div style={{ padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 12 }}>
              Draft a personalized outreach letter that explains why this plaintiff may qualify for {item.case.caseType} relief in <em>{item.case.caption}</em>.
            </div>
            <Btn onClick={draft}>Draft letter →</Btn>
          </div>
        )}

        {phase === "streaming" && (
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 480, overflow: "auto" }}>
            {letter || "Generating…"}
          </div>
        )}

        {phase === "error" && (
          <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#ef4444" }}>
            {error}
            <button onClick={draft} style={{ marginLeft: 10, fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
          </div>
        )}

        {phase === "done" && (
          <div>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-surface2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 480, overflow: "auto", marginBottom: 14 }}>
              {letter}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(letter).catch(() => {});
                }}
                style={{ fontSize: 11, padding: "6px 12px", borderRadius: 5, background: "var(--bg-surface)", color: "var(--text-3)", border: "1px solid var(--border-md)", cursor: "pointer", fontWeight: 600 }}
              >
                Copy letter
              </button>
              <Btn variant="primary" onClick={() => onDismissAndAct(item.pair)}>
                Mark sent + close
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PendingOutreach() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterState, setFilterState] = useState("");
  const [filterPartner, setFilterPartner] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState({});
  const [drawer, setDrawer] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/outreach-pending?limit=200");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      setError(e.message);
      setItems([]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function dismiss(pair) {
    setBusy((b) => ({ ...b, [pair]: true }));
    try {
      await fetch(`/api/outreach-pending?pair=${encodeURIComponent(pair)}`, { method: "DELETE" });
      setItems((arr) => arr.filter((i) => i.pair !== pair));
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[pair]; return c; });
    }
  }

  function openAction(item) {
    setDrawer(item);
  }

  async function dismissAndClose(pair) {
    await dismiss(pair);
    setDrawer(null);
  }

  const filtered = useMemo(() => {
    let arr = items;
    if (filterState) arr = arr.filter((i) => i.client.state === filterState);
    if (filterPartner) arr = arr.filter((i) => i.client.partnerId === filterPartner);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((i) => {
        const hay = `${i.client.firstName || ""} ${i.client.lastName || ""} ${i.case.caption || ""} ${(i.case.defendants || []).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return arr;
  }, [items, filterState, filterPartner, search]);

  // ── Stats ──
  const total = items.length;
  const high = items.filter((i) => i.score >= 90).length;
  const partners = [...new Set(items.map((i) => i.client.partnerId).filter(Boolean))];
  const states = [...new Set(items.map((i) => i.client.state).filter(Boolean))].sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Pending pairs"       value={total}                color="#C8442F" />
        <StatPill label="Score ≥ 90 (strong)" value={high}                  color="#16a34a" />
        <StatPill label="Distinct partners"   value={partners.length || "—"} color="#2D7D95" />
        <StatPill label="States represented"  value={states.length || "—"}  color="#8b5cf6" />
      </div>

      <Card>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plaintiff or case…"
            style={{ flex: 1, minWidth: 200, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
          />
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)}
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
            <option value="">All partners</option>
            {partners.map((p) => <option key={p} value={p}>{p === "credit_com" ? "credit.com" : p}</option>)}
          </select>
          <button onClick={load} style={{ fontSize: 11, padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border-md)", background: "var(--bg-surface)", color: "var(--text-3)", cursor: "pointer", fontWeight: 600 }}>
            Refresh
          </button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
          {loading
            ? "Loading pending outreach…"
            : `Showing ${filtered.length} of ${total} pending (score ≥ 80, qualifies=true)`
          }
        </div>

        {error && (
          <div style={{ padding: "10px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#ef4444", marginBottom: 10 }}>
            {error}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-6)", padding: "40px 20px", textAlign: "center" }}>
            {total === 0
              ? "No pairs in the queue. As the match-recompute agent finds qualifying (client, case) pairs with score ≥ 80, they'll appear here."
              : "No pairs match these filters."
            }
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ maxHeight: 760, overflowY: "auto" }}>
            {filtered.map((item) => (
              <PairRow
                key={item.pair}
                item={item}
                busy={!!busy[item.pair]}
                onDismiss={dismiss}
                onAction={openAction}
              />
            ))}
          </div>
        )}
      </Card>

      {drawer && (
        <ActionDrawer item={drawer} onClose={() => setDrawer(null)} onDismissAndAct={dismissAndClose} />
      )}
    </div>
  );
}
