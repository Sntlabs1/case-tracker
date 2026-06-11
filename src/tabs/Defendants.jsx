import { useState, useEffect, useMemo } from "react";
import { Card, Btn } from "../components/UI.jsx";
import { BUYER_TO_CREDITORS, BUYER_ALIASES, CREDITOR_TO_BUYERS, getTypicalCreditors } from "../lib/matching/debtCollectorMap.js";

function StatPill({ label, value, color = "#C8442F" }) {
  return (
    <div style={{ padding: "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function CaseCountBadge({ count }) {
  const color = count >= 100 ? "#C8442F" : count >= 25 ? "#f59e0b" : count >= 5 ? "#2D7D95" : "#6b7280";
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
                   style={{ fontSize: 10, color: "#2D7D95", textDecoration: "none", marginTop: 3, display: "inline-block" }}>
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

// ── Collector profiles (enriched from debtCollectorMap + manual metadata) ──
// Each entry describes one known collection company we could have a suit against.
const COLLECTOR_PROFILES = [
  // ── The Big 4 Bank Debt Buyers ────────────────────────────────────────────
  {
    key: "midland credit management",
    displayName: "Midland Credit Management / Midland Funding",
    parent: "Encore Capital Group (NASDAQ: ECPG)",
    family: "bank-buyer",
    familyLabel: "Bank Debt Buyer",
    tcpaRisk: "critical",
    aliases: ["Midland Funding LLC", "Midland Credit Management Inc.", "MCM", "Encore Capital Group"],
    description: "Largest debt buyer in the US. Purchases charged-off credit card and loan accounts from major banks in bulk. Known repeat TCPA defendant — automated dialing of consumers on purchased accounts without consent.",
    notableCases: ["Lacy v. Midland Funding (TCPA $17.9M)", "Campbell v. Midland Credit (FDCPA class)", "Midland Funding v. Johnson (SCOTUS 2017)"],
  },
  {
    key: "portfolio recovery associates",
    displayName: "Portfolio Recovery Associates",
    parent: "PRA Group (NASDAQ: PRAA)",
    family: "bank-buyer",
    familyLabel: "Bank Debt Buyer",
    tcpaRisk: "critical",
    aliases: ["PRA Group", "Portfolio Recovery Associates LLC", "Asset Acceptance LLC"],
    description: "Second largest US debt buyer. Purchases accounts from Citi, BofA, Capital One, Discover, GE Capital. Asset Acceptance (acquired 2013) expands their legacy portfolio. Multiple TCPA class actions for predictive-dialer calls.",
    notableCases: ["PRA Group TCPA settlements (multiple states)", "Asset Acceptance FDCPA class action $18M"],
  },
  {
    key: "lvnv funding",
    displayName: "LVNV Funding",
    parent: "Sherman Financial Group / Resurgent Capital Services",
    family: "bank-buyer",
    familyLabel: "Bank Debt Buyer",
    tcpaRisk: "critical",
    aliases: ["LVNV Funding LLC", "Resurgent Capital Services LP", "Alegis Group", "Tributech"],
    description: "Sherman Financial's debt-buying arm. Acquires charged-off accounts from Citi, Capital One, BofA, Household Bank. Resurgent Capital Services handles collections in-house after purchase. Known TCPA defendant for automated calls.",
    notableCases: ["LVNV Funding TCPA class actions (multi-district)", "Resurgent FDCPA enforcement actions"],
  },
  {
    key: "cavalry portfolio services",
    displayName: "Cavalry Portfolio Services",
    parent: "Cavalry Investments (private equity-backed)",
    family: "bank-buyer",
    familyLabel: "Bank Debt Buyer",
    tcpaRisk: "high",
    aliases: ["Cavalry Portfolio Services LLC", "Cavalry SPV I LLC", "Cavalry SPV I", "Cavalry Investments"],
    description: "Purchases charged-off bank and credit card debt from Citi, Chase, BofA, Capital One, GE Capital, Household Finance. Files suit aggressively on purchased accounts. TCPA exposure from automated dialing campaigns.",
    notableCases: ["Cavalry SPV I TCPA class actions"],
  },
  // ── Store Card Buyers ─────────────────────────────────────────────────────
  {
    key: "jefferson capital systems",
    displayName: "Jefferson Capital Systems",
    parent: "CompuCredit Holdings / Atlanticus Holdings",
    family: "store-card-buyer",
    familyLabel: "Store Card Buyer",
    tcpaRisk: "high",
    aliases: ["Jefferson Capital Systems LLC", "Jefferson Capital"],
    description: "Primary buyer of Synchrony and Comenity charged-off store card portfolios. Also acquires Sprint/T-Mobile telecom debt. Covers Amazon, PayPal Credit, Lowe's, Gap, JCPenney, Victoria's Secret, Lane Bryant, Express, Torrid, and 80+ other retail card issuers.",
    notableCases: ["Jefferson Capital TCPA class actions (multiple)"],
  },
  {
    key: "crown asset management",
    displayName: "Crown Asset Management",
    parent: "Crown Asset Management LLC (private)",
    family: "store-card-buyer",
    familyLabel: "Store Card Buyer",
    tcpaRisk: "medium",
    aliases: ["Crown Asset Management LLC", "CAM IX"],
    description: "Purchases Synchrony and Comenity store card portfolios. Frequently the buyer for Gap, Old Navy, Banana Republic, Sam's Club, and other Synchrony-issued retail cards after charge-off.",
    notableCases: [],
  },
  // ── Telecom Collectors ────────────────────────────────────────────────────
  {
    key: "enhanced recovery company",
    displayName: "Enhanced Recovery Company (ERC)",
    parent: "ERC (private, Jacksonville FL)",
    family: "telecom-collector",
    familyLabel: "Telecom Collector",
    tcpaRisk: "critical",
    aliases: ["Enhanced Recovery Company LLC", "ERC", "Enhanced Recovery", "Enhanced Resource Centers"],
    description: "Primary 3rd-party collector for AT&T, Verizon, T-Mobile, Comcast, Charter/Spectrum, Cox, DirecTV, and Dish Network. One of the largest TCPA defendants by volume — uses predictive dialers across all telecom clients. TCPA class actions spanning multiple carriers.",
    notableCases: ["ERC TCPA settlements AT&T accounts", "ERC v. Verizon TCPA class (multiple)"],
  },
  {
    key: "ic system",
    displayName: "IC System",
    parent: "IC System Inc. (private, St. Paul MN)",
    family: "telecom-collector",
    familyLabel: "Telecom / Medical Collector",
    tcpaRisk: "high",
    aliases: ["IC System Inc.", "I C System"],
    description: "Collects for AT&T, Verizon, medical practices, hospitals, dental offices, and utilities. TCPA exposure across all verticals from automated calling of consumers who gave numbers to the original creditor, not the collector.",
    notableCases: ["IC System TCPA class actions (multiple states)"],
  },
  {
    key: "convergent outsourcing",
    displayName: "Convergent Outsourcing",
    parent: "Convergent Outsourcing Inc. (private, Renton WA)",
    family: "telecom-collector",
    familyLabel: "Multi-sector Collector",
    tcpaRisk: "high",
    aliases: ["Convergent Outsourcing Inc.", "Convergent"],
    description: "Collects for AT&T, Sprint, T-Mobile, Citibank, Capital One, and Samsung. Hybrid model: both 3rd-party collections and purchased debt. TCPA suits filed for predictive-dialer calls on telecom and bank accounts.",
    notableCases: ["Convergent Outsourcing TCPA class actions"],
  },
  {
    key: "nco group",
    displayName: "NCO Group / Alorica",
    parent: "Alorica (acquired NCO Group 2014)",
    family: "telecom-collector",
    familyLabel: "Multi-sector Collector",
    tcpaRisk: "high",
    aliases: ["NCO Group Inc.", "NCO Financial Systems", "Alorica"],
    description: "Large 3rd-party collector operating across telecom, healthcare, financial services. Acquired by Alorica in 2014. TCPA exposure from automated calling on behalf of multiple creditors.",
    notableCases: ["NCO Group TCPA class action settlements"],
  },
  // ── Other Notable Collectors ──────────────────────────────────────────────
  {
    key: "unifin",
    displayName: "Unifin",
    parent: "Unifin Inc. (private)",
    family: "bank-collector",
    familyLabel: "Bank Collector",
    tcpaRisk: "medium",
    aliases: ["Unifin Inc.", "Unifin Receivables"],
    description: "3rd-party collector for Capital One, Citibank, and other major banks. Uses automated calling systems on bank-referred accounts. TCPA exposure for calls without prior express consent.",
    notableCases: ["Unifin TCPA class actions"],
  },
  {
    key: "ars national services",
    displayName: "ARS National Services",
    parent: "ARS National Services Inc. (private, Escondido CA)",
    family: "bank-collector",
    familyLabel: "Bank Collector",
    tcpaRisk: "medium",
    aliases: ["ARS National Services Inc.", "ARS", "Account Resolution Services"],
    description: "Collects for Bank of America, Citibank, Ford Motor Credit, and other large creditors. Known for aggressive autodialer campaigns resulting in TCPA class actions.",
    notableCases: ["ARS National TCPA class actions"],
  },
  {
    key: "alltran financial",
    displayName: "Alltran Financial",
    parent: "Alltran Financial LP (formerly United Recovery Systems)",
    family: "bank-collector",
    familyLabel: "Bank Collector",
    tcpaRisk: "medium",
    aliases: ["Alltran Financial LP", "United Recovery Systems", "URS"],
    description: "Rebranded from United Recovery Systems in 2017. Collects for Bank of America, Wells Fargo, and other large creditors. TCPA exposure for predictive-dialer and pre-recorded message campaigns.",
    notableCases: [],
  },
  {
    key: "firstsource advantage",
    displayName: "Firstsource Advantage",
    parent: "Firstsource Solutions (NSE: FSL)",
    family: "bank-collector",
    familyLabel: "Bank / Student Loan Collector",
    tcpaRisk: "medium",
    aliases: ["Firstsource Advantage LLC", "Firstsource Solutions"],
    description: "Collects for Citibank, Bank of America, auto lenders, student loan servicers (Navient, Sallie Mae), and mortgage servicers. TCPA exposure across multiple verticals.",
    notableCases: [],
  },
  {
    key: "cbe group",
    displayName: "CBE Group",
    parent: "CBE Group Inc. (private, Waterloo IA)",
    family: "medical-collector",
    familyLabel: "Medical / Utility Collector",
    tcpaRisk: "medium",
    aliases: ["CBE Group Inc."],
    description: "Specializes in medical, utility, and financial debt collection. Payday/high-rate lender exposure via CashNetUSA and similar clients. TCPA suits for automated calls on medical and consumer debt.",
    notableCases: [],
  },
  {
    key: "amsher collection services",
    displayName: "AMSHER Collection Services",
    parent: "AMSHER Collection Services Inc. (private, Birmingham AL)",
    family: "medical-collector",
    familyLabel: "Medical Collector",
    tcpaRisk: "medium",
    aliases: ["AMSHER Collection Services Inc.", "AMSHER"],
    description: "Primary collector for hospitals, physician groups, and medical practices. TCPA exposure for automated collection calls to patients who provided cell numbers to healthcare providers, not to the collector.",
    notableCases: [],
  },
];

// Risk color coding
const RISK_COLOR = {
  critical: "#C8442F",
  high:     "#f59e0b",
  medium:   "#2D7D95",
  low:      "#6b7280",
};

const FAMILY_LABELS = {
  "bank-buyer":        "Bank Debt Buyers",
  "store-card-buyer":  "Store Card Buyers",
  "telecom-collector": "Telecom Collectors",
  "bank-collector":    "Bank Collectors",
  "medical-collector": "Medical / Utility Collectors",
};

// ── Collector Intelligence component ────────────────────────────────────────
function CollectorIntelligence({ defendants }) {
  const [selectedFamily, setSelectedFamily] = useState("all");
  const [selectedCollector, setSelectedCollector] = useState(null);
  const [searchClients, setSearchClients] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(false);

  // Match each collector profile to the defendants list from KV
  const enriched = useMemo(() => {
    const defMap = {};
    for (const d of defendants) {
      const norm = (d.displayName || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      defMap[norm] = d;
      for (const alias of (d.aliases || [])) {
        const an = alias.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        defMap[an] = d;
      }
    }

    return COLLECTOR_PROFILES.map(p => {
      // Try to find a matching defendant in KV by name
      const normKey = p.key.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const kvDef = defMap[normKey] || defMap[p.displayName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()];

      // Source creditors from our map
      const sourceCreditors = getTypicalCreditors(p.key);

      return {
        ...p,
        caseCount: kvDef?.caseCount || 0,
        canonicalId: kvDef?.canonicalId || null,
        sourceCreditors,
      };
    });
  }, [defendants]);

  const families = useMemo(() => {
    const all = [...new Set(COLLECTOR_PROFILES.map(p => p.family))];
    return all;
  }, []);

  const filtered = useMemo(() => {
    if (selectedFamily === "all") return enriched;
    return enriched.filter(p => p.family === selectedFamily);
  }, [enriched, selectedFamily]);

  // Fetch clients exposed to a collector via source creditor names
  async function findExposedClients(profile) {
    setClientsLoading(true);
    setSearchClients({ profile, clients: null });
    try {
      const creditorQ = profile.sourceCreditors.slice(0, 10).join(",");
      const r = await fetch(`/api/clients?q=${encodeURIComponent(creditorQ)}&limit=200`);
      const d = await r.json();
      setSearchClients({ profile, clients: d.clients || [] });
    } catch {
      setSearchClients({ profile, clients: [] });
    }
    setClientsLoading(false);
  }

  const totalCritical = enriched.filter(p => p.tcpaRisk === "critical").length;
  const totalWithCases = enriched.filter(p => p.caseCount > 0).length;

  return (
    <div>
      {/* Summary header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatPill label="Collection companies mapped" value={COLLECTOR_PROFILES.length} color="#C8442F" />
        <StatPill label="Critical TCPA risk"          value={totalCritical}             color="#C8442F" />
        <StatPill label="With cases in database"      value={totalWithCases}            color="#f59e0b" />
        <StatPill label="Source creditors covered"    value={Object.keys(BUYER_TO_CREDITORS).reduce((s, k) => s + (BUYER_TO_CREDITORS[k]?.length || 0), 0)} color="#22c55e" />
      </div>

      {/* Explainer */}
      <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(200,68,47,0.06)", border: "1px solid rgba(200,68,47,0.2)", fontSize: 12, color: "var(--text-3)", marginBottom: 20, lineHeight: 1.7 }}>
        <strong style={{ color: "var(--text-1)" }}>How to use this:</strong> A credit report shows the original creditor (e.g. "Chase"). The TCPA lawsuit defendant is who called the consumer — usually the debt buyer who purchased the account (e.g. "Midland Funding"). This panel maps every known collector to their source creditors, so you can identify which collectors to name as defendants based on what appears in a client's credit report.
      </div>

      {/* Live DB annotation — cross-references reference profiles against live defendants */}
      <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 16, padding: "8px 14px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {defendants.length > 0
          ? `Showing reference profiles. ${totalWithCases} of these defendants are active in your database.`
          : "Live database unavailable — showing all reference profiles."}
      </div>

      {/* Family filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all", "All Collectors"], ...families.map(f => [f, FAMILY_LABELS[f] || f])].map(([key, label]) => (
          <button key={key} onClick={() => setSelectedFamily(key)}
            style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: selectedFamily === key ? "var(--accent)" : "var(--bg-surface)",
              color: selectedFamily === key ? "#fff" : "var(--text-4)",
              border: `1px solid ${selectedFamily === key ? "var(--accent)" : "var(--border)"}` }}>
            {label}
            {key !== "all" && (
              <span style={{ marginLeft: 6, opacity: 0.75 }}>
                {enriched.filter(p => p.family === key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Collector cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(480px, 1fr))", gap: 14 }}>
        {filtered.map(profile => (
          <CollectorCard
            key={profile.key}
            profile={profile}
            selected={selectedCollector === profile.key}
            onSelect={() => setSelectedCollector(selectedCollector === profile.key ? null : profile.key)}
            onFindClients={() => findExposedClients(profile)}
          />
        ))}
      </div>

      {/* Exposed clients slide-out */}
      {searchClients && (
        <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 420, background: "var(--bg-card)", borderLeft: "1px solid var(--border)", padding: "20px 16px", zIndex: 200, overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 2 }}>Clients exposed to</div>
              <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{searchClients.profile.displayName}</div>
            </div>
            <button onClick={() => setSearchClients(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-5)", fontSize: 16 }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 12, lineHeight: 1.6 }}>
            Clients with accounts from: <strong style={{ color: "var(--text-3)" }}>{searchClients.profile.sourceCreditors.slice(0, 8).join(", ")}{searchClients.profile.sourceCreditors.length > 8 ? "…" : ""}</strong>
          </div>
          {clientsLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0", fontSize: 12, color: "var(--text-5)" }}>Searching clients…</div>
          ) : !searchClients.clients ? null : searchClients.clients.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 12px", fontSize: 12, color: "var(--text-5)" }}>
              No clients with these creditors in the database yet. Upload credit reports from credit.com to populate.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>{searchClients.clients.length} clients found</div>
              {searchClients.clients.map(c => (
                <div key={c.id} style={{ padding: "10px 12px", background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>
                    {c.firstName} {c.lastName}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-5)" }}>
                    {c.state || "—"} · {c.email || c.phone || "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 2 }}>
                    {(c.creditAccounts?.length || 0) + (c.collectionsHistory?.length || 0)} tradelines on file
                  </div>
                  <a href={`/api/client-report?clientId=${encodeURIComponent(c.id)}&format=html`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "#2D7D95", textDecoration: "none", marginTop: 4, display: "inline-block" }}>
                    Open full report ↗
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollectorCard({ profile, selected, onSelect, onFindClients }) {
  const riskColor = RISK_COLOR[profile.tcpaRisk] || "#6b7280";
  const riskLabel = { critical: "Critical TCPA Risk", high: "High TCPA Risk", medium: "Medium TCPA Risk", low: "Low Risk" }[profile.tcpaRisk] || profile.tcpaRisk;

  return (
    <div onClick={onSelect} style={{
      borderRadius: 10, border: `2px solid ${selected ? riskColor : "var(--border)"}`,
      background: selected ? `${riskColor}08` : "var(--bg-card)",
      padding: "16px 18px", cursor: "pointer", transition: "all 0.15s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", marginBottom: 3, lineHeight: 1.3 }}>
            {profile.displayName}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-6)" }}>{profile.parent}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 10 }}>
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${riskColor}20`, color: riskColor, border: `1px solid ${riskColor}40`, fontWeight: 700, whiteSpace: "nowrap" }}>
            {riskLabel}
          </span>
          {profile.caseCount > 0 && (
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(45,125,149,0.1)", color: "#2D7D95", border: "1px solid rgba(45,125,149,0.3)", fontWeight: 700 }}>
              {profile.caseCount} case{profile.caseCount === 1 ? "" : "s"} in DB
            </span>
          )}
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "var(--bg-surface2)", color: "var(--text-5)", border: "1px solid var(--border)", fontWeight: 600 }}>
            {profile.familyLabel}
          </span>
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize: 11, color: "var(--text-4)", lineHeight: 1.6, marginBottom: 10 }}>
        {profile.description}
      </div>

      {/* Source creditors */}
      {profile.sourceCreditors.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
            Buys / collects from ({profile.sourceCreditors.length} creditors)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {profile.sourceCreditors.slice(0, 12).map(c => (
              <span key={c} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-3)", fontWeight: 500 }}>
                {c.replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            ))}
            {profile.sourceCreditors.length > 12 && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-5)" }}>
                +{profile.sourceCreditors.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Aliases */}
      {profile.aliases?.length > 0 && selected && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
            Legal entities / aliases
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {profile.aliases.map(a => (
              <span key={a} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(200,68,47,0.08)", border: "1px solid rgba(200,68,47,0.2)", color: "var(--accent)", fontWeight: 500 }}>
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notable cases */}
      {profile.notableCases?.length > 0 && selected && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "var(--text-6)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
            Notable cases
          </div>
          {profile.notableCases.map(c => (
            <div key={c} style={{ fontSize: 10, color: "var(--text-4)", marginBottom: 2 }}>· {c}</div>
          ))}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={onFindClients}
          style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: "var(--accent)", color: "#fff", border: "none" }}>
          Find exposed clients
        </button>
        {profile.canonicalId && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("viewDefendant", { detail: profile.canonicalId }))}
            style={{ padding: "7px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: "var(--bg-surface2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
            View cases ↗
          </button>
        )}
      </div>
    </div>
  );
}

export default function Defendants() {
  const [view, setView] = useState("collectors"); // "collectors" | "cases"
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
  const topDefendant = defendants[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Sub-tab toggle */}
      <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", alignSelf: "flex-start" }}>
        {[
          ["collectors", "Collector Intelligence"],
          ["cases",      "Case Defendants"],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} style={{
            padding: "8px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: view === key ? "var(--accent)" : "var(--bg-surface)",
            color: view === key ? "#fff" : "var(--text-4)",
            border: "none", borderRight: key === "collectors" ? "1px solid var(--border)" : "none",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Collector Intelligence view */}
      {view === "collectors" && (
        <CollectorIntelligence defendants={defendants} />
      )}

      {/* Case Defendants view (original) */}
      {view === "cases" && (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Defendants tracked"         value={totalDefendants}                color="#C8442F" />
        <StatPill label="Repeat (≥ 5 cases)"          value={repeatDefendants}               color="#f59e0b" />
        <StatPill label="Top defendant cases"         value={topDefendant?.caseCount || "—"} color="#2D7D95" />
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
      </>)}
    </div>
  );
}
