import React, { useState, useEffect } from "react";
import { Card, Btn } from "../components/UI.jsx";

const CASE_LABELS = {
  TCPA:         "TCPA",
  FDCPA:        "FDCPA",
  FCRA:         "FCRA",
  RESPA:        "RESPA",
  StudentLoan:  "Student Loan",
  AutoLending:  "Auto Lending",
  DataBreach:   "Data Breach",
  UDAP_Payday:  "Payday/UDAP",
};

const CASE_COLORS = {
  TCPA:         "#2D7D95",
  FDCPA:        "#8b5cf6",
  FCRA:         "#f59e0b",
  RESPA:        "#22c55e",
  StudentLoan:  "#06b6d4",
  AutoLending:  "#f97316",
  DataBreach:   "#ef4444",
  UDAP_Payday:  "#ec4899",
};

const STRENGTH_COLOR = { high: "#22c55e", medium: "#f59e0b", low: "#ef4444" };

// Live claim-path badge (from KV case:claim_paths via /api/portfolio-cases).
// claim_window = an open settlement is accepting claims / paying now;
// joinable_litigation = open dockets naming this defendant; none = nothing
// live today — the match must not be pitched as a claimable case.
function ClaimPathBadge({ claimPath }) {
  if (!claimPath || claimPath.status === "unknown") return null;
  const CFG = {
    claim_window:        { color: "#22c55e", label: "Active claim window" },
    joinable_litigation: { color: "#2D7D95", label: `Joinable litigation${claimPath.openLitigation ? ` (${claimPath.openLitigation})` : ""}` },
    monitor_only:        { color: "#f59e0b", label: "Settlement pending" },
    none:                { color: "#6b7280", label: "No live claim path" },
  };
  const cfg = CFG[claimPath.status];
  if (!cfg) return null;
  const dl = (claimPath.liveSettlements || []).map(s => s.deadline).filter(Boolean).sort()[0];
  return (
    <span
      title={(claimPath.liveSettlements || []).map(s => s.name).join(" · ") || cfg.label}
      style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}40`, fontWeight: 700, whiteSpace: "nowrap" }}
    >
      {cfg.label}{dl ? ` — by ${dl}` : ""}
    </span>
  );
}

function fmt$(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtN(n) {
  return (n || 0).toLocaleString();
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtYYYYMM(s) {
  if (!s) return "—";
  const str = String(s).trim();
  // Raw LEX MMYY ("0117" = Jan 2017) that escaped API normalization.
  const mmyy = /^(\d{2})(\d{2})$/.exec(str);
  if (mmyy) {
    const m = parseInt(mmyy[1], 10);
    const yy = parseInt(mmyy[2], 10);
    if (m >= 1 && m <= 12) return `${MONTHS_SHORT[m - 1]} ${yy <= 26 ? 2000 + yy : 1900 + yy}`;
  }
  const parts = str.split(/[-/]/);
  if (parts.length < 2) return str;
  const m = parseInt(parts[1], 10);
  return `${MONTHS_SHORT[m - 1] || parts[1]} ${parts[0]}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `***-***-${digits.slice(-4)}`;
  }
  return "***-***-****";
}

function maskEmail(email) {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0) return "****@unknown.com";
  return `****${email.slice(at)}`;
}

function signalBasis(caseType, defendant) {
  const d = defendant || "unknown party";
  switch (caseType) {
    case "FDCPA":       return `Collection activity by ${d} — potential Fair Debt Collection violations`;
    case "FCRA":        return `Credit reporting issues involving ${d} — potential inaccurate/stale data`;
    case "TCPA":        return `Call/text contact by ${d} — potential autodialer violations`;
    case "RESPA":       return `Mortgage servicing by ${d} — potential escrow/transfer violations`;
    case "StudentLoan": return `Student loan servicing by ${d} — potential payment misapplication`;
    case "AutoLending": return `Auto financing by ${d} — potential predatory lending terms`;
    case "DataBreach":  return `Data exposed in ${d} breach — potential notification/security failures`;
    case "UDAP_Payday": return `Payday/short-term lending by ${d} — potential UDAP violations`;
    default:            return `Activity by ${d}`;
  }
}

const CASE_TYPE_INFO = {
  FDCPA: {
    statute: "Fair Debt Collection Practices Act — 15 U.S.C. § 1692",
    summary: "Prohibits abusive, deceptive, and unfair debt collection practices by third-party collectors. Covers harassment, false representations, unfair practices, and failure to validate debts.",
    solFederal: "1 year from violation date",
    solState: "Many states extend to 2–6 years under state UDAP analogs (CA, IL, NY, TX)",
    solWarning: "Federal 1-year SOL may be expired if tradeline predates June 2025. Evaluate state UDAP claims.",
    administrator: "CFPB (enforcement); private right of action in federal or state court; class actions certified under FDCPA § 1692k(a)(2)(B)",
    openedNote: "Claim accrues at each collection contact or violation. Ongoing collection activity resets the clock.",
    damages: "$1,000 statutory per plaintiff + actual damages + attorney fees. Class: up to $500,000 or 1% of net worth.",
    keyEvidence: ["Collection calls, letters, or texts from defendant", "Dunning notices without proper validation language", "Attempts to collect a debt that was disputed or discharged", "Harassment, threats, or misrepresentation of debt amount"],
    activeCases: [
      { name: "Midland Credit Management class actions", status: "Multiple active — various districts", admin: "Various plaintiff firms (Kazerouni Law, Greenwald Davidson)" },
      { name: "Portfolio Recovery Associates CFPB Consent Order", status: "2015 order; ongoing monitoring", admin: "CFPB" },
      { name: "Encore Capital / Midland Funding", status: "Recurring class actions re: time-barred debt", admin: "Consumer protection plaintiffs' bar" },
    ],
    watchOut: "Verify defendant is a third-party collector (not original creditor). Original creditors are not covered by FDCPA — need state analog.",
  },
  FCRA: {
    statute: "Fair Credit Reporting Act — 15 U.S.C. § 1681",
    summary: "Governs accuracy, fairness, and privacy of consumer credit information. Requires CRAs and furnishers to investigate disputes, correct inaccuracies, and limit permissible purposes for pulling reports.",
    solFederal: "2 years from discovery; 5 years from violation (whichever is earlier)",
    solState: "State analogs vary; CA CCRAA has 2-year SOL; NY FCRA analog extends coverage",
    solWarning: "Ongoing inaccurate reporting (re-aging, duplicate tradelines) continuously violates FCRA — SOL resets each month the error persists.",
    administrator: "CFPB and FTC (enforcement); private right of action — willful violations allow statutory + punitive; negligent allows actual only",
    openedNote: "Claim accrues at each credit report pull or each month an inaccuracy is reported. Ongoing harm is the primary viable theory for aged data.",
    damages: "$100–$1,000 statutory per willful violation + actual + punitive + attorney fees. Negligent: actual damages only.",
    keyEvidence: ["Credit report showing inaccurate tradeline (wrong balance, status, dates)", "Proof of prior dispute submission to CRA", "CRA or furnisher response to dispute (or failure to respond)", "Multiple bureau inconsistencies for the same account"],
    activeCases: [
      { name: "Experian class actions — data accuracy", status: "Multiple active — N.D. Cal.", admin: "Lemberg Law, Consumer Law Center" },
      { name: "Equifax 2017 Data Breach Settlement", status: "Claims period closed; monitoring only", admin: "Settlement administrator: JND Legal Administration" },
      { name: "TransUnion v. Ramirez (SCOTUS 2021)", status: "Decided — standing requires concrete harm; affects class certification", admin: "Precedential — review class definition carefully" },
    ],
    watchOut: "TransUnion v. Ramirez (2021) limits standing to plaintiffs whose reports were actually sent to third parties. Confirm downstream use of report.",
  },
  TCPA: {
    statute: "Telephone Consumer Protection Act — 47 U.S.C. § 227",
    summary: "Restricts telemarketing calls, auto-dialed calls, prerecorded messages, and texts to cell phones. Requires prior express written consent for marketing; prior express consent for informational calls.",
    solFederal: "4 years (federal question SOL under 28 U.S.C. § 1658)",
    solState: "N/A — federal claim only, but state UDAP analogs may extend",
    solWarning: "4-year SOL is more favorable. Calls through mid-2022 remain viable. Confirm call dates.",
    administrator: "FCC (rulemaking); private right of action; state AGs; no federal enforcement agency with standing to sue",
    openedNote: "Each call or text is a separate violation. High-volume calling campaigns can yield hundreds of violations per plaintiff.",
    damages: "$500 per call (negligent); $1,500 per call (willful). No actual damage required. Class actions with millions of calls can reach 9-figure exposure.",
    keyEvidence: ["Phone records showing calls from defendant", "Robocall or prerecorded message content", "Absence of prior written consent in defendant's records", "Proof cell phone number was used (not landline)", "ATDS (auto-dialer) documentation or expert analysis"],
    activeCases: [
      { name: "Facebook TCPA Class Action", status: "Settled $650M (2021)", admin: "Claims closed; precedential" },
      { name: "Barr v. American Association of Political Consultants", status: "SCOTUS 2020 — partial severability ruling; government-debt exception severed", admin: "Ongoing relitigation in lower courts" },
      { name: "Ongoing debt-collector TCPA class actions", status: "Active — frequent filings in S.D. Fla., N.D. Cal., N.D. Ill.", admin: "Greenwald Davidson, Kaufman PA, Mahon & Associates" },
    ],
    watchOut: "Facebook Inc. v. Duguid (SCOTUS 2021) narrowed ATDS definition — confirm defendant used true auto-dialer or prerecorded message, not manual dialing.",
  },
  RESPA: {
    statute: "Real Estate Settlement Procedures Act — 12 U.S.C. § 2601 + Reg X",
    summary: "Governs mortgage servicing: requires timely escrow account management, borrower notifications on transfer, loss mitigation procedures, and prohibits kickbacks in settlement services.",
    solFederal: "1 year for kickback claims; 3 years for other violations from date of occurrence",
    solState: "State mortgage servicing laws (CA HomeOwner Bill of Rights, NY RPAPL) may extend",
    solWarning: "3-year SOL for servicing violations applies. If servicing errors are ongoing (incorrect escrow, misapplied payments), each statement is a new violation.",
    administrator: "CFPB (primary enforcement); state regulators; private right of action for actual damages + up to $2,000 per pattern/practice + attorney fees",
    openedNote: "Servicer-to-servicer transfer triggers notice requirements. Loss mitigation violations (failure to offer modification) accrue at each application denial.",
    damages: "Actual damages + up to $2,000 statutory (pattern/practice) + attorney fees. Class: up to $1,000/member or $500,000 total.",
    keyEvidence: ["Mortgage statements showing incorrect escrow or payment application", "Transfer notice or lack thereof", "Loss mitigation application and denial letters", "Qualified Written Request (QWR) and servicer response (or non-response within 30/45 days)"],
    activeCases: [
      { name: "Ocwen Financial CFPB Consent Order", status: "2017 + 2021 orders; $2B+ in relief", admin: "CFPB; claims administrator varies by state" },
      { name: "Nationstar (now Mr. Cooper) class actions", status: "Multiple active re: escrow and loss mitigation", admin: "Various plaintiffs' firms" },
      { name: "PHH Mortgage RESPA class action", status: "Settled 2023; claims process completed", admin: "Closed" },
    ],
    watchOut: "RESPA § 8 (kickback) claims require identifying the specific settlement service provider relationship. Servicing violations under § 6 are more common and do not require kickback proof.",
  },
  StudentLoan: {
    statute: "Higher Education Act + state consumer protection laws; CFPB supervision authority",
    summary: "Servicer misconduct includes misapplied payments, improper denial of income-driven repayment (IDR) or PSLF, steering to forbearance over repayment programs, and reporting discharged loans.",
    solFederal: "Varies: 6 years for HEA claims; no SOL for bankruptcy discharge contempt; state UDAP 2–7 years",
    solState: "CA UCL: 4 years; IL UDAP: 5 years; NY GBL: 6 years; TX DTPA: 2 years",
    solWarning: "Bankruptcy discharge violations have no SOL. IDR/PSLF denials may have ongoing harm theory. State UDAP claims viable if servicing continued into 2020–2022.",
    administrator: "CFPB (supervision); state AGs (multistate coalitions common); FSA (federal); private right of action under state UDAP",
    openedNote: "Navient AG settlement signed January 2022. FedLoan (PHEAA) exited federal servicing in December 2021. Mohela, AIDVANTAGE (Maximus) assumed portfolios.",
    damages: "Loan cancellation (primary remedy in AG actions); actual damages; restitution; state UDAP statutory damages ($1,000–$25,000/violation in some states).",
    keyEvidence: ["Loan payment history showing misapplication or forbearance steering", "IDR application denials or lack of notification", "PSLF rejection letters", "Servicer transfer notices", "Credit reports showing loans reported as active post-discharge"],
    activeCases: [
      { name: "Navient 39-State AG Settlement", status: "Finalized Jan 2022 — $1.85B; cancellation for subprime borrowers. CHECK ELIGIBILITY.", admin: "State AGs; borrower eligibility auto-applied" },
      { name: "Sweet v. Cardona (borrower defense)", status: "Class settlement 2023; ED processing claims", admin: "U.S. Dept. of Education; claims in process" },
      { name: "PSLF Limited Waiver", status: "Waiver period ended Oct 2022; Temporary Expanded PSLF ongoing", admin: "FSA / MOHELA" },
    ],
    watchOut: "Cross-reference against Navient eligibility list (subprime private loans originated 2002–2014, attended for-profit schools). This is the highest-value active settlement for this case type.",
  },
  AutoLending: {
    statute: "Truth in Lending Act (TILA) — 15 U.S.C. § 1601; state UDAP; UCC Art. 9 (repossession)",
    summary: "Covers predatory auto lending including undisclosed dealer markups, yo-yo financing, illegal repossession practices, add-on product fraud, and inaccurate disclosure of APR/finance charges.",
    solFederal: "1 year TILA; 4 years UCC; 4–7 years state UDAP",
    solState: "CA CLRA: 3 years; IL UDAP: 5 years; TX DTPA: 2 years; state-specific vary significantly",
    solWarning: "1-year TILA SOL likely expired. Focus on state UDAP (4–7 year SOLs) and ongoing repossession/deficiency claims.",
    administrator: "CFPB (supervision of large auto lenders); FTC (enforcement against dealers); state AGs; private right of action",
    openedNote: "Santander $550M multistate AG settlement signed 2020. Ally Financial discrimination settlements ongoing. GM Financial CFPB investigation active.",
    damages: "TILA: actual + statutory (2x finance charge, $200–$2,000 cap). State UDAP: actual + punitive + attorney fees. UCC deficiency claims: full deficiency waiver possible.",
    keyEvidence: ["Loan agreement showing APR, finance charges, total of payments", "Dealer add-on products (GAP, extended warranty) without disclosure", "Deficiency notice after repossession", "Credit report showing repossession and deficiency balance"],
    activeCases: [
      { name: "Santander Consumer USA — Multistate AG", status: "Settled 2020 — $550M; CHECK ELIGIBILITY for loan forgiveness", admin: "State AGs; borrower relief auto-applied for subprime loans" },
      { name: "Ally Financial discrimination settlements", status: "Ongoing CFPB/DOJ enforcement re: dealer markup racial discrimination", admin: "CFPB" },
      { name: "GM Financial indirect lending investigation", status: "CFPB investigation ongoing (2024)", admin: "CFPB" },
    ],
    watchOut: "Distinguish between direct lender (bank/finance company) and dealer. TILA applies to lender. Dealer misconduct may require state UDAP or FTC Act theories.",
  },
  DataBreach: {
    statute: "State data breach notification laws (all 50 states); CAN-SPAM; FTC Act § 5; sector-specific (HIPAA, GLBA)",
    summary: "Unauthorized access to personal data triggers notification obligations and potential liability for harm. Claims arise under state negligence, consumer protection, and breach notification laws.",
    solFederal: "No federal private right of action for most breaches (except HIPAA/GLBA contexts). State law governs.",
    solState: "Negligence: 2–3 years from discovery. Consumer protection: 2–7 years. Varies by state and breach date.",
    solWarning: "AT&T 2024 breach (73M records): SOL begins 2024; viable through 2026–2027. Change Healthcare 2024: same. Earlier breaches (2019) may be near expiry.",
    administrator: "State AGs (enforcement); FTC (systemic violations); class action plaintiffs' bar; no federal private cause of action",
    openedNote: "AT&T paid $13M FCC fine (2024) for unauthorized data sharing. Change Healthcare (UHG subsidiary) breach Feb 2024 affected 100M+ medical records.",
    damages: "Limited individual recovery ($50–$500 typical class settlement); aggregate class value significant. Credit monitoring, identity theft insurance, out-of-pocket losses.",
    keyEvidence: ["Breach notification letter from defendant", "Identity theft or fraud incidents post-breach", "Records showing PII was in defendant's systems", "Out-of-pocket costs for credit monitoring or fraud remediation"],
    activeCases: [
      { name: "AT&T Data Breach Class Action (2024)", status: "Active — multiple consolidated actions, N.D. Tex.", admin: "Keller Rohrback; class not yet certified" },
      { name: "Change Healthcare / UHG Breach (2024)", status: "Active — MDL being formed", admin: "Multiple firms; JCCP likely" },
      { name: "T-Mobile Data Breach Settlement (2023)", status: "Settled $350M; claims closed Jan 2023", admin: "Closed" },
    ],
    watchOut: "Data breach claims require showing concrete harm (identity theft, misuse of data) — standing issues after TransUnion v. Ramirez. Confirm client had verifiable data in defendant's systems.",
  },
  UDAP_Payday: {
    statute: "State Unfair/Deceptive Acts and Practices (UDAP) laws; FTC Act § 5; CFPB Payday Lending Rule (12 C.F.R. Part 1041)",
    summary: "Covers payday lenders, title lenders, and other short-term high-cost credit providers. Violations include undisclosed fees, rollovers, unauthorized ACH debits, and lending to borrowers unable to repay.",
    solFederal: "No direct federal private right of action under FTC Act. CFPB can bring enforcement actions.",
    solState: "CA UCL: 4 years; IL UDAP: 5 years; NY GBL 349: 3 years; OH CSPA: 2 years. State interest rate caps may void entire loan.",
    solWarning: "State UDAP SOLs of 4–7 years make this viable if lending occurred 2019–2022. CFPB Payday Rule effective 2024 — new violations ongoing.",
    administrator: "CFPB (primary rulemaking and enforcement); state AGs; state banking regulators; private right of action under state UDAP",
    openedNote: "CFPB reinstated ability-to-repay requirements in 2024 after Texas federal court vacated earlier rule. State-level enforcement varies — CA, NY, NJ, IL most active.",
    damages: "Loan voiding (state rate cap violations); restitution of fees paid; state UDAP statutory damages ($200–$25,000/violation depending on state). Class viable.",
    keyEvidence: ["Loan agreement showing APR (often 300–600%+)", "ACH debit records showing unauthorized charges", "Evidence of rollovers without ability-to-repay assessment", "Proof of lending in state with rate cap below loan APR"],
    activeCases: [
      { name: "CashCall / Western Sky CFPB action", status: "Settled 2024 — $300M+ in loan forgiveness", admin: "CFPB; auto-applied to qualifying borrowers" },
      { name: "ACE Cash Express multistate enforcement", status: "Settled 2019; closed", admin: "State AGs (TX, CA, others)" },
      { name: "Ongoing state AG payday enforcement", status: "Active — CA, NY, IL, NJ, PA", admin: "State AGs; private class actions in same jurisdictions" },
    ],
    watchOut: "Tribal lender sovereign immunity claims — many payday lenders use tribal affiliations to evade state law. Check for genuine tribal nexus vs. rent-a-tribe schemes.",
  },
};

function solStatus(caseType, ingestedAt) {
  const dataDate = ingestedAt ? new Date(ingestedAt) : new Date("2019-10-01");
  const now = new Date();
  const monthsAgo = Math.round((now - dataDate) / (1000 * 60 * 60 * 24 * 30));
  const solMonths = { FDCPA: 12, FCRA: 24, TCPA: 48, RESPA: 36, StudentLoan: 72, AutoLending: 12, DataBreach: 30, UDAP_Payday: 60 };
  const sol = solMonths[caseType] || 24;
  if (monthsAgo > sol) return { status: "warning", label: `Federal SOL likely expired (data ~${monthsAgo}mo old; SOL ${sol}mo) — evaluate state analogs` };
  if (monthsAgo > sol * 0.75) return { status: "caution", label: `Approaching SOL (data ~${monthsAgo}mo old; ${sol - monthsAgo}mo remaining on federal clock)` };
  return { status: "ok", label: `Within SOL window (~${monthsAgo}mo old; federal SOL ${sol}mo)` };
}

// v2 records carry a per-signal solStatus computed from actual tradeline
// dates at ingest — always prefer it over the ingestedAt heuristic above.
const SOL_META = {
  live:              { color: "#22c55e", status: "ok",      short: "LIVE",          label: "Live — within the federal SOL window" },
  live_state_udap:   { color: "#22c55e", status: "ok",      short: "LIVE (state)",  label: "Live under the state UDAP window (federal SOL may have run)" },
  discharge_ongoing: { color: "#22c55e", status: "ok",      short: "ONGOING §524",  label: "Ongoing §524 discharge violation — no SOL while still reporting" },
  undated:           { color: "#f59e0b", status: "caution", short: "UNDATED",       label: "No tradeline date on file — verify dates at intake" },
  time_barred:       { color: "#ef4444", status: "warning", short: "TIME-BARRED",   label: "Federal SOL expired based on last-reported date" },
};

function signalSol(sig, caseType, ingestedAt) {
  const meta = sig && typeof sig === "object" ? SOL_META[sig.solStatus] : null;
  if (meta) {
    const when = sig.lastReported ? ` (last reported ${fmtYYYYMM(sig.lastReported)})` : "";
    return { status: meta.status, color: meta.color, short: meta.short, label: meta.label + when };
  }
  const legacy = solStatus(caseType, ingestedAt);
  return {
    ...legacy,
    short: null,
    color: legacy.status === "ok" ? "#22c55e" : legacy.status === "caution" ? "#f59e0b" : "#ef4444",
  };
}

// Per-claimant statutory floor/ceiling by case type — mirrors PER_VIOLATION
// in src/lib/intelligence/recoveryEstimate.js (TCPA 47 USC §227(b)(3), FDCPA
// 15 USC §1692k, FCRA 15 USC §1681n) and the per-case mids this tab already
// uses for the non-statutory types.
const CASE_TOTAL_RANGE = {
  TCPA:        [500, 1500],
  FDCPA:       [500, 1000],
  FCRA:        [100, 1000],
  AutoLending: [1000, 1000],
  StudentLoan: [2000, 2000],
  RESPA:       [1500, 1500],
  DataBreach:  [150, 150],
  UDAP_Payday: [500, 500],
};

function fmtDollarsCompact(n) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// Total-claim potential for one case row: eligible people in the file x the
// per-claimant statutory range. A ceiling, not an expected recovery.
function caseTotalEstimate(c) {
  const eligible = c.consumers ?? c.consumersInDb;
  const range = CASE_TOTAL_RANGE[c.caseType];
  if (!eligible || !range) return null;
  const [lo, hi] = range;
  return lo === hi
    ? fmtDollarsCompact(eligible * lo)
    : `${fmtDollarsCompact(eligible * lo)}–${fmtDollarsCompact(eligible * hi)}`;
}

// Report-style defendant table for the Cases view. Pure restyle of the old
// card grid — same fields, same click-through, just rendered as ranked rows
// with status pills, a right-aligned ceiling column, and speed-to-file dots.
function CaseTable({ rows, countLabel, countSub, onOpen }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-5)", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Defendant / case type</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Claim basis</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Status</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>
                {countLabel}
                {countSub && <div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-5)" }}>{countSub}</div>}
              </th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Est. per claimant</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>
                Est. total claim
                <div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-5)" }}>eligible × statutory</div>
              </th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700 }}>Speed to file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const cColor = CASE_COLORS[c.caseType] || "#6b7280";
              const sol = solStatus(c.caseType, null);
              const solColor = sol.status === "ok" ? "#22c55e" : sol.status === "caution" ? "#f59e0b" : "#ef4444";
              const speed = c.classSettlement || (c.openCases || 0) >= 25 ? 3 : (c.openCases || 0) > 0 ? 2 : 1;
              const clickable = !c.bureau;
              const ex = (c.examples || [])[0];
              const pill = { fontSize: 10, padding: "3px 10px", borderRadius: 10, fontWeight: 700, whiteSpace: "nowrap" };
              return (
                <tr
                  key={c.id}
                  onClick={() => clickable && onOpen(c)}
                  style={{ borderBottom: "1px solid var(--border)", cursor: clickable ? "pointer" : "default" }}
                  onMouseEnter={e => { if (clickable) e.currentTarget.style.background = "var(--bg-surface)"; }}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "12px 14px", verticalAlign: "top", minWidth: 170 }}>
                    <div style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                    <div style={{ color: "var(--text-5)", fontSize: 10, marginTop: 3 }}>
                      {[c.category || c.entityType, (c.consumers ?? c.consumersInDb) ? `${fmtN(c.consumers ?? c.consumersInDb)} consumers in file` : null]
                        .filter(Boolean).join(" · ") || " "}
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top", color: "var(--text-3)", maxWidth: 260, lineHeight: 1.45 }}>
                    <span style={{ color: cColor, fontWeight: 600 }}>{CASE_LABELS[c.caseType] || c.caseType}</span>
                    {ex && (
                      <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 250 }}>
                        {ex.number || ex.docket} — {ex.title}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {(c.openCases || 0) > 0 && (
                        <span style={{ ...pill, background: "#22c55e18", color: "#22c55e", border: "1px solid #22c55e40" }}>
                          {fmtN(c.openCases)} open
                        </span>
                      )}
                      {c.classSettlement && (
                        <span style={{ ...pill, background: "#8b5cf618", color: "#8b5cf6", border: "1px solid #8b5cf640" }}>
                          Class settlement
                        </span>
                      )}
                      {(c.candidates || 0) > 0 && (
                        <span style={{ ...pill, background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b40" }}>
                          {fmtN(c.candidates)} class candidates
                        </span>
                      )}
                      <ClaimPathBadge claimPath={c.claimPath} />
                      {c.bureau ? (
                        <span style={{ ...pill, background: `${cColor}18`, color: cColor, border: `1px solid ${cColor}40` }}>
                          Applies to entire base
                        </span>
                      ) : (
                        <span style={{ ...pill, background: `${solColor}14`, color: solColor, border: `1px solid ${solColor}33` }}>
                          {sol.status === "ok" ? "SOL Open" : sol.status === "caution" ? "SOL Closing" : "SOL Risk"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top", textAlign: "right", color: "var(--text-1)", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {fmtN(c.caseCount)}
                    {c.newCases ? <div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-5)", marginTop: 2 }}>{fmtN(c.newCases)} filed 2024–26</div> : null}
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top", textAlign: "right", color: "#22c55e", maxWidth: 180, lineHeight: 1.4 }}>
                    {c.info?.damages?.split(".")[0] || "—"}
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top", textAlign: "right", color: "var(--text-1)", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {caseTotalEstimate(c) || "—"}
                    {(c.consumers ?? c.consumersInDb) ? (
                      <div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-5)", marginTop: 2 }}>
                        {fmtN(c.consumers ?? c.consumersInDb)} eligible
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "12px 14px", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                    {[1, 2, 3].map(i => (
                      <span key={i} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginLeft: 4, background: i <= speed ? "#e11d48" : "var(--border)" }} />
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StatBox({ label, value, sub, color = "var(--accent)" }) {
  return (
    <div style={{ background: "var(--bg-card)", border: `1px solid ${color}30`, borderRadius: 10, padding: "18px 22px", minWidth: 180 }}>
      <div style={{ fontSize: 11, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function CaseTypeBar({ label, count, total, color, recovery }) {
  const width = total ? Math.max(2, (count / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>{label}</span>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-5)" }}>{fmtN(count)} people</span>
          <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>{fmt$(recovery)}</span>
        </div>
      </div>
      <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

// Find the claimant's matched signal that corresponds to the case they were
// opened from. Prefer an exact case-type + defendant match; fall back to
// case-type only, then defendant only.
function focusSignalFor(profile, focusCase) {
  if (!focusCase || !Array.isArray(profile?.cases)) return null;
  const dq = (focusCase.defendantQ || "").toLowerCase();
  const wantCt = focusCase.caseType;
  const byDef = focusCase.matchByDefendantOnly;
  const sigs = profile.cases.map(s =>
    typeof s === "object" ? s : { caseType: s, defendant: "" }
  );
  let hit = dq && sigs.find(s => (byDef || s.caseType === wantCt) && (s.defendant || "").toLowerCase().includes(dq));
  if (!hit) hit = sigs.find(s => s.caseType === wantCt);
  if (!hit && dq) hit = sigs.find(s => (s.defendant || "").toLowerCase().includes(dq));
  return hit || null;
}

// Tradelines in the credit file tied to this case's defendant — the on-file
// evidence that triggered the match.
function matchingTradelines(profile, focusCase) {
  const dq = (focusCase?.defendantQ || "").toLowerCase();
  const tl = profile?.creditReport?.tl;
  if (!dq || !Array.isArray(tl)) return [];
  return tl.filter(t => (t.c || "").toLowerCase().includes(dq) || (t.orig || "").toLowerCase().includes(dq));
}

// Scoped eligibility report — the first thing shown when a claimant is opened
// from inside a case. Composed entirely from existing match data (no API call).
function EligibilityReport({ profile, focusCase }) {
  if (!focusCase) return null;

  const ct = focusCase.caseType;
  const info = CASE_TYPE_INFO[ct] || focusCase.info || null;
  const sig = focusSignalFor(profile, focusCase);
  const strength = sig?.strength || "low";
  const defendant = sig?.defendant || focusCase.defendant || focusCase.name || "this defendant";
  const cColor = CASE_COLORS[ct] || "#6b7280";

  const sol = signalSol(sig, ct, profile.ingestedAt);
  const solColor = sol.color;

  const verdict = sol.status === "warning"
    ? { label: "Screen carefully — SOL risk", color: "#f59e0b" }
    : strength === "high"   ? { label: "Strong candidate", color: "#22c55e" }
    : strength === "medium" ? { label: "Worth screening", color: "#f59e0b" }
    :                         { label: "Weak signal", color: "#ef4444" };

  const tls = matchingTradelines(profile, focusCase);
  const pr = profile?.creditReport?.pr || [];
  const postDischarge = pr.some(p => p.disch && tls.some(t => t.od > p.disch));

  const rec = sig || {};
  const hasRec = rec.estimatedRecoveryLow != null || rec.estimatedRecoveryMid != null || rec.estimatedRecoveryHigh != null;

  const Section = ({ title, color, children }) => (
    <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: color || "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ background: "var(--bg-card)", border: `1px solid ${cColor}55`, borderLeft: `3px solid ${cColor}`, borderRadius: 10, padding: "18px 20px", marginBottom: 22 }}>
      {/* Verdict header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: cColor, textTransform: "uppercase", letterSpacing: 1 }}>Eligibility Report</span>
        <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 3, background: `${verdict.color}22`, color: verdict.color, border: `1px solid ${verdict.color}44`, fontWeight: 700 }}>
          {verdict.label}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)", marginBottom: 4, lineHeight: 1.35 }}>
        Why {profile.name || "this person"} fits {CASE_LABELS[ct] || ct} vs {defendant}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}>
        {signalBasis(ct, defendant)}{strength ? ` — ${strength}-strength match.` : "."}
      </div>

      {/* Evidence on file */}
      <Section title="Evidence on file">
        {tls.length > 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.6 }}>
            {tls.length} tradeline{tls.length > 1 ? "s" : ""} in the credit file tied to {defendant}:
            <div style={{ marginTop: 6 }}>
              {tls.slice(0, 4).map((t, i) => (
                <div key={i} style={{ fontSize: 11.5, color: "var(--text-2)", paddingLeft: 10, position: "relative", marginBottom: 3 }}>
                  <span style={{ position: "absolute", left: 0, color: "var(--text-5)" }}>-</span>
                  {t.c || t.orig || "Account"}
                  {t.st ? ` — ${t.st}` : ""}
                  {t.bal != null ? ` · $${t.bal.toLocaleString()}` : ""}
                  {t.od ? ` · opened ${fmtYYYYMM(t.od)}` : ""}
                  {t.disp ? " · DISPUTED" : ""}
                </div>
              ))}
            </div>
            {postDischarge && (
              <div style={{ fontSize: 11.5, color: "#f59e0b", marginTop: 6 }}>
                Post-discharge collection activity detected — high-value FDCPA signal.
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
            Matched on case-type signal{sig?.defendant ? ` involving ${sig.defendant}` : ""}. Detailed tradeline evidence available on the Credit Data tab.
          </div>
        )}
      </Section>

      {/* SOL */}
      <Section title="Filing window / SOL">
        <div style={{ fontSize: 11.5, color: solColor, fontWeight: 600, marginBottom: info ? 4 : 0 }}>{sol.label}</div>
        {info && <div style={{ fontSize: 11, color: "var(--text-3)" }}>Federal: {info.solFederal}</div>}
        {info?.solWarning && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>{info.solWarning}</div>}
      </Section>

      {/* Recovery */}
      {(hasRec || info?.damages) && (
        <Section title="Estimated recovery">
          {hasRec ? (
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              Low {fmt$(rec.estimatedRecoveryLow)} / <span style={{ color: "#22c55e", fontWeight: 700 }}>Mid {fmt$(rec.estimatedRecoveryMid)}</span> / High {fmt$(rec.estimatedRecoveryHigh)}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "#22c55e" }}>{info.damages}</div>
          )}
        </Section>
      )}

      {/* Next steps */}
      {info?.keyEvidence && info.keyEvidence.length > 0 && (
        <Section title="Confirm before intake">
          {info.keyEvidence.slice(0, 3).map((ev, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "var(--text-2)", paddingLeft: 10, position: "relative", marginBottom: 3 }}>
              <span style={{ position: "absolute", left: 0, color: "var(--text-5)" }}>-</span>
              {ev}
            </div>
          ))}
        </Section>
      )}

      {info?.watchOut && (
        <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid #ef444433", borderRadius: 6, padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#ef4444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Watch out</div>
          <div style={{ fontSize: 11, color: "#fca5a5" }}>{info.watchOut}</div>
        </div>
      )}
    </div>
  );
}

function ClientProfileModal({ profileId, profile, focusCase, loading, error, onClose }) {
  const [modalTab, setModalTab] = useState("cases"); // "cases" | "credit"
  const [outreachState, setOutreachState] = useState("idle"); // idle | adding | added | error

  // Reset to the Cases view whenever a different profile is opened
  React.useEffect(() => { setModalTab("cases"); }, [profileId]);

  if (!profileId) return null;

  function addToOutreach() {
    setOutreachState("adding");
    fetch("/api/outreach-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: profileId }),
    })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(() => setOutreachState("added"))
      .catch(() => setOutreachState("error"));
  }

  const scoreColor = profile
    ? profile.score >= 75 ? "#22c55e" : profile.score >= 50 ? "#f59e0b" : "#ef4444"
    : "var(--text-4)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-page)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 760,
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            color: "var(--text-4)",
            cursor: "pointer",
            fontSize: 20,
            lineHeight: 1,
            zIndex: 1,
          }}
        >
          X
        </button>

        {loading && (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-4)" }}>
            Loading...
          </div>
        )}

        {error && (
          <div style={{ padding: 40, color: "#ef4444" }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && profile && (
          <div style={{ padding: 28 }}>

            {/* Header */}
            <div style={{ marginBottom: 24, paddingRight: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)" }}>
                  {profile.name || "Unknown"}
                </span>
                {profile.state && (
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 3, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-dim)", fontWeight: 600 }}>
                    {profile.state}
                  </span>
                )}
                <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 3, background: `${scoreColor}22`, color: scoreColor, border: `1px solid ${scoreColor}44`, fontWeight: 700 }}>
                  Score {profile.score}
                </span>
                {profile.intakeReady && (
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 3, background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44", fontWeight: 600 }}>
                    Intake Ready
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                {profile.dataVintage?.newestReported && (() => {
                  // Prefer the oldest account-opened date for the start of the
                  // range; last-reported dates collapse to a single month on
                  // actively-updated files (every account re-reports monthly).
                  const opens = (profile.creditReport?.tl || []).map(t => t.od).filter(Boolean).sort();
                  const start = opens[0] || profile.dataVintage.oldestReported;
                  const end = profile.dataVintage.newestReported;
                  return start && start < end ? (
                    <span>Credit history: {fmtYYYYMM(start)} – {fmtYYYYMM(end)} (last reported)</span>
                  ) : (
                    <span>All accounts last reported {fmtYYYYMM(end)}</span>
                  );
                })()}
                {profile.bankruptcyFiled && (
                  <span> · Bankruptcy filed {fmtYYYYMM(profile.bankruptcyFiled)}</span>
                )}
                {profile.ingestedAt && (
                  <span>{profile.dataVintage?.newestReported || profile.bankruptcyFiled ? " · " : ""}Matched {new Date(profile.ingestedAt).toLocaleDateString()}</span>
                )}
              </div>
            </div>

            {/* Scoped eligibility report — shown first when opened from a case */}
            <EligibilityReport profile={profile} focusCase={focusCase} />

            {/* Identity */}
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Identity
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 13 }}>
                <div>
                  <span style={{ color: "var(--text-5)" }}>Name: </span>
                  <span style={{ color: "var(--text-1)" }}>{profile.name || "—"}</span>
                </div>
                <div>
                  <span style={{ color: "var(--text-5)" }}>State: </span>
                  <span style={{ color: "var(--text-1)" }}>{profile.state || "—"}</span>
                </div>
                <div>
                  <span style={{ color: "var(--text-5)" }}>Phone: </span>
                  {profile.phone
                    ? <a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{profile.phone}</a>
                    : <span style={{ color: "var(--text-1)" }}>—</span>}
                </div>
                <div>
                  <span style={{ color: "var(--text-5)" }}>Email: </span>
                  {profile.email
                    ? <a href={`mailto:${profile.email}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{profile.email}</a>
                    : <span style={{ color: "var(--text-1)" }}>—</span>}
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: "var(--text-5)" }}>Source: </span>
                  <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 3, background: "#2D7D9522", color: "#2D7D95", border: "1px solid #2D7D9544" }}>
                    Credit.com Dataset
                  </span>
                </div>
              </div>
            </div>

            {/* View toggle: Potential Cases vs Credit Data */}
            <div style={{ display: "flex", background: "var(--bg-surface)", borderRadius: 8, padding: 4, gap: 4, marginBottom: 20 }}>
              {[
                ["cases", "Potential Cases", (profile.cases || []).length],
                ["credit", "Credit Data", profile.creditReport?.tl?.length || 0],
              ].map(([mode, label, count]) => (
                <button
                  key={mode}
                  onClick={() => setModalTab(mode)}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "8px 12px",
                    borderRadius: 5,
                    border: "none",
                    cursor: "pointer",
                    background: modalTab === mode ? "#2D7D95" : "transparent",
                    color: modalTab === mode ? "#fff" : "var(--text-4)",
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span style={{ marginLeft: 7, fontSize: 11, opacity: 0.8 }}>{count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Case Compatibility */}
            {modalTab === "cases" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Case Compatibility
              </div>
              {(!profile.cases || profile.cases.length === 0) && (
                <div style={{ color: "var(--text-5)", fontSize: 13 }}>No case signals found.</div>
              )}
              {(profile.cases || []).map((sig, i) => {
                const ct = sig.caseType || sig;
                const defendant = sig.defendant || "—";
                const strength = sig.strength || "low";
                const sColor = STRENGTH_COLOR[strength] || "#6b7280";
                const info = CASE_TYPE_INFO[ct];
                const sol = signalSol(sig, ct, profile.ingestedAt);
                const solColor = sol.color;
                return (
                  <div
                    key={i}
                    style={{
                      background: "var(--bg-card)",
                      border: `1px solid ${(CASE_COLORS[ct] || "var(--border)")}33`,
                      borderRadius: 8,
                      padding: "16px 18px",
                      marginBottom: 14,
                    }}
                  >
                    {/* Case header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <span style={{ fontWeight: 800, color: CASE_COLORS[ct] || "#e5e7eb", fontSize: 14 }}>
                        {CASE_LABELS[ct] || ct}
                      </span>
                      <span style={{ color: "var(--text-2)", fontSize: 13, fontWeight: 600 }}>{defendant}</span>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: `${sColor}22`, color: sColor, border: `1px solid ${sColor}44`, fontWeight: 700 }}>
                        {strength} signal
                      </span>
                      {sol.short && (
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: `${solColor}22`, color: solColor, border: `1px solid ${solColor}44`, fontWeight: 700 }}>
                          {sol.short}
                        </span>
                      )}
                      {sig.lastReported && (
                        <span style={{ fontSize: 10.5, color: "var(--text-5)" }}>
                          last reported {fmtYYYYMM(sig.lastReported)}
                        </span>
                      )}
                    </div>

                    {/* Statute */}
                    {info && (
                      <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 8, fontFamily: "monospace" }}>
                        {info.statute}
                      </div>
                    )}

                    {/* Summary */}
                    {info && (
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.6 }}>
                        {info.summary}
                      </div>
                    )}

                    {/* Why compatible */}
                    <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Why Compatible</div>
                      <div style={{ fontSize: 12, color: "var(--text-1)" }}>{signalBasis(ct, defendant)}</div>
                      {info && <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>{info.openedNote}</div>}
                    </div>

                    {/* SOL status */}
                    <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Filing Deadlines / SOL</div>
                      <div style={{ fontSize: 11, color: solColor, fontWeight: 600, marginBottom: 4 }}>{sol.label}</div>
                      {sig.statuteRef && (
                        <div style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "monospace", marginBottom: 4 }}>{sig.statuteRef}</div>
                      )}
                      {info && <div style={{ fontSize: 11, color: "var(--text-2)" }}>Federal: {info.solFederal}</div>}
                      {info && <div style={{ fontSize: 11, color: "var(--text-4)" }}>State: {info.solState}</div>}
                      {info && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>{info.solWarning}</div>}
                    </div>

                    {/* Administrator + damages */}
                    {info && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Administrator / Forum</div>
                          <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>{info.administrator}</div>
                        </div>
                        <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Potential Damages</div>
                          <div style={{ fontSize: 11, color: "#22c55e", lineHeight: 1.5 }}>{info.damages}</div>
                        </div>
                      </div>
                    )}

                    {/* Active cases */}
                    {info && info.activeCases && info.activeCases.length > 0 && (
                      <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Active Cases / MDLs</div>
                        {info.activeCases.map((ac, j) => (
                          <div key={j} style={{ marginBottom: j < info.activeCases.length - 1 ? 10 : 0, paddingBottom: j < info.activeCases.length - 1 ? 10 : 0, borderBottom: j < info.activeCases.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600, marginBottom: 2 }}>{ac.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>Status: {ac.status}</div>
                            <div style={{ fontSize: 11, color: "var(--text-5)" }}>Admin: {ac.admin}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Key evidence */}
                    {info && info.keyEvidence && (
                      <div style={{ background: "var(--bg-surface2)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Key Evidence to Gather</div>
                        {info.keyEvidence.map((ev, j) => (
                          <div key={j} style={{ fontSize: 11, color: "var(--text-2)", paddingLeft: 10, marginBottom: 3, position: "relative" }}>
                            <span style={{ position: "absolute", left: 0, color: "var(--text-5)" }}>-</span>
                            {ev}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Watch out */}
                    {info && info.watchOut && (
                      <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid #ef444433", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: "#ef4444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Watch Out</div>
                        <div style={{ fontSize: 11, color: "#fca5a5" }}>{info.watchOut}</div>
                      </div>
                    )}

                    {/* Recovery */}
                    {(sig.estimatedRecoveryLow != null || sig.estimatedRecoveryMid != null || sig.estimatedRecoveryHigh != null) && (
                      <div style={{ fontSize: 12, color: "var(--text-5)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                        Recovery estimate for this claim:{" "}
                        <span style={{ color: "var(--text-2)" }}>Low {fmt$(sig.estimatedRecoveryLow)}</span>
                        {" / "}
                        <span style={{ color: "#22c55e", fontWeight: 600 }}>Mid {fmt$(sig.estimatedRecoveryMid)}</span>
                        {" / "}
                        <span style={{ color: "#2D7D95" }}>High {fmt$(sig.estimatedRecoveryHigh)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            {/* Recovery Summary */}
            {modalTab === "cases" && profile.recoveryEstimate && (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                  Recovery Summary
                </div>
                <div style={{ fontSize: 14, color: "var(--text-1)", marginBottom: 8 }}>
                  <span style={{ color: "var(--text-5)" }}>Total Recovery Estimate: </span>
                  <span style={{ color: "var(--text-2)" }}>Low {fmt$(profile.recoveryEstimate.low)}</span>
                  {" / "}
                  <span style={{ color: "#22c55e", fontWeight: 700 }}>Mid {fmt$(profile.recoveryEstimate.mid)}</span>
                  {" / "}
                  <span style={{ color: "#2D7D95" }}>High {fmt$(profile.recoveryEstimate.high)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                  Estimates based on class-action settlement averages. Not legal advice.
                </div>
              </div>
            )}

            {/* Credit Data tab */}
            {modalTab === "credit" && (
            <div style={{ marginBottom: 20 }}>
              {profile.creditReport && (
                <div>
                  <div style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.45)", borderLeft: "3px solid #f59e0b", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
                    <strong style={{ color: "#d97706" }}>Note —</strong> Data vintage ~2019. Balances and statuses are not current; use for case signal identification only.
                  </div>

                  {/* Tradelines */}
                  {profile.creditReport.tl && profile.creditReport.tl.length > 0 && (
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Tradelines ({profile.creditReport.tl.length})</div>
                      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                        <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ color: "var(--text-4)", background: "var(--bg-card)", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 }}>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Creditor</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Original</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Type</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Status</th>
                              <th style={{ textAlign: "right", padding: "8px 10px" }}>Balance</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Opened</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Bureau</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.creditReport.tl.map((tl, i) => {
                              const bureauLabels = { EQ: "Equifax", EX: "Experian", TU: "TransUnion", CCOM: "Credit.com" };
                              const isDisputed = tl.disp;
                              const rowBg = isDisputed
                                ? "rgba(245,158,11,0.10)"
                                : (i % 2 ? "var(--bg-card)" : "transparent");
                              return (
                                <tr key={`${tl.c}-${tl.od}-${i}`} style={{ borderTop: "1px solid var(--border)", background: rowBg }}>
                                  <td style={{ padding: "8px 10px", color: "var(--text-1)", fontWeight: 500, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tl.c || "—"}</td>
                                  <td style={{ padding: "8px 10px", color: "var(--text-4)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tl.orig || "—"}</td>
                                  <td style={{ padding: "8px 10px", color: "var(--text-3)" }}>{tl.type || "—"}</td>
                                  <td style={{ padding: "8px 10px", color: "var(--text-2)" }}>{tl.st || "—"}</td>
                                  <td style={{ textAlign: "right", padding: "8px 10px", color: tl.bal != null ? "var(--text-1)" : "var(--text-5)", fontVariantNumeric: "tabular-nums" }}>
                                    {tl.bal != null ? `$${(tl.bal).toLocaleString()}` : "—"}
                                  </td>
                                  <td style={{ padding: "8px 10px", color: "var(--text-4)", whiteSpace: "nowrap" }}>{fmtYYYYMM(tl.od)}</td>
                                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "var(--bg-surface)", color: "var(--text-4)", border: "1px solid var(--border)" }}>
                                      {bureauLabels[tl.bureau] || tl.bureau || "—"}
                                    </span>
                                    {isDisputed && <span style={{ fontSize: 10, marginLeft: 5, padding: "2px 7px", borderRadius: 3, background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}>Disputed</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Inquiries */}
                  {profile.creditReport.inq && profile.creditReport.inq.length > 0 && (
                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Hard Inquiries ({profile.creditReport.inq.length})</div>
                      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ color: "var(--text-4)", background: "var(--bg-card)", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 }}>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Lender</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Date</th>
                              <th style={{ textAlign: "left", padding: "8px 10px" }}>Bureau</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.creditReport.inq.map((inq, i) => (
                              <tr key={`${inq.lender}-${inq.date}-${i}`} style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--bg-card)" : "transparent" }}>
                                <td style={{ padding: "8px 10px", color: "var(--text-1)", fontWeight: 500 }}>{inq.lender || "—"}</td>
                                <td style={{ padding: "8px 10px", color: "var(--text-4)", whiteSpace: "nowrap" }}>{fmtYYYYMM(inq.date)}</td>
                                <td style={{ padding: "8px 10px", color: "var(--text-3)" }}>{{ EQ: "Equifax", EX: "Experian", TU: "TransUnion" }[inq.bureau] || inq.bureau || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Public Records */}
                  {profile.creditReport.pr && profile.creditReport.pr.length > 0 && (
                    <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid #ef444455", borderLeft: "3px solid #ef4444", borderRadius: 8, padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Public Records</div>
                      {profile.creditReport.pr.map((pr, i) => {
                        const hasDischarge = pr.disch;
                        return (
                          <div key={i} style={{ fontSize: 12.5, color: "var(--text-1)", marginBottom: 8, lineHeight: 1.5 }}>
                            {pr.type}{pr.chapter ? ` Ch.${pr.chapter}` : ""} — Filed {fmtYYYYMM(pr.filed) || "—"}{hasDischarge ? `, Discharged ${fmtYYYYMM(pr.disch)}` : ""}
                            {hasDischarge && profile.creditReport.tl && profile.creditReport.tl.some(tl => tl.od > pr.disch) && (
                              <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}>
                                Post-discharge collection activity detected — high-value FDCPA signal
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!profile.creditReport && (
                <div style={{ fontSize: 13, color: "var(--text-5)", padding: "32px 0", textAlign: "center" }}>
                  {profile.intakeReady
                    ? "Credit report data pending — will be available after next ingest run."
                    : "Credit report detail is available for Intake Ready profiles (score ≥ 50) only."}
                </div>
              )}
            </div>
            )}

            {/* Action */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {outreachState === "added" ? (
                <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 600 }}>Added to outreach queue.</span>
              ) : outreachState === "error" ? (
                <>
                  <span style={{ fontSize: 13, color: "#ef4444" }}>Failed to add — try again.</span>
                  <Btn onClick={addToOutreach} small>Retry</Btn>
                </>
              ) : (
                <Btn onClick={addToOutreach} small variant="success" style={{ opacity: outreachState === "adding" ? 0.6 : 1 }}>
                  {outreachState === "adding" ? "Adding..." : "Add to Outreach Queue"}
                </Btn>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function caseDefendantKeyword(caseName) {
  const stop = new Set(["the","a","an","and","or","of","in","for","vs","v.","class","action","settlement","mdl","ongoing","multiple","active","various","barr","sweet","pslf","limited","waiver","facebook","inc."]);
  const words = caseName.split(/[\s,/()+]+/);
  return words.find(w => w.length > 3 && !stop.has(w.toLowerCase()))?.toLowerCase() || "";
}

function isCaseOpen(status) {
  const s = status.toLowerCase();
  return !s.includes("closed") && !s.includes("completed") && !s.includes("ended oct") && !s.includes("claims period");
}

const ACTIVE_CASES = Object.entries(CASE_TYPE_INFO).flatMap(([ct, info]) =>
  (info.activeCases || [])
    .filter(ac => isCaseOpen(ac.status))
    .map(ac => ({
      id:         `${ct}-${ac.name.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 50)}`,
      caseType:   ct,
      name:       ac.name,
      status:     ac.status,
      admin:      ac.admin,
      defendantQ: caseDefendantKeyword(ac.name),
      info,
    }))
);

export default function CreditPortfolio() {
  const [data, setData]                 = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filter, setFilter]             = useState("all");
  const [viewMode, setViewMode]         = useState("people"); // "people" | "cases"

  // Pagination over the Highest-Priority Matched People table (50 per page).
  // Cursor-based: the API returns a nextCursor with each page, so every person
  // in the index is reachable. Page 0 ships with the initial payload; we keep
  // the cursor that fetches each page so Prev can re-fetch earlier pages.
  const PAGE_SIZE = 50;
  const [leadsPage, setLeadsPage]               = useState(0);
  const [pageLeads, setPageLeads]               = useState(null); // null = use data.topLeads (page 0)
  const [pageHasMore, setPageHasMore]           = useState(null); // null = use data.hasMore (page 0)
  const [pageLeadsLoading, setPageLeadsLoading] = useState(false);
  const [pageLeadsError, setPageLeadsError]     = useState(null);
  const pageAbortRef = React.useRef(null);
  const pageCursorsRef = React.useRef({}); // page index -> cursor string that fetches it

  const [profileId, setProfileId]       = useState(null);
  const [profile, setProfile]           = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [focusCase, setFocusCase]       = useState(null); // case the claimant was opened from

  const profileAbortRef = React.useRef(null);

  const [selectedCase, setSelectedCase]           = useState(null);
  const [caseClients, setCaseClients]             = useState([]);
  const [caseClientsLoading, setCaseClientsLoading] = useState(false);
  const [caseClientsError, setCaseClientsError]   = useState(null);
  const [caseClientsTotal, setCaseClientsTotal]   = useState(null);
  const [caseClientsHasMore, setCaseClientsHasMore] = useState(false);
  const [caseClientsPage, setCaseClientsPage]     = useState(0);
  const caseClientsAbortRef = React.useRef(null);
  const caseCursorsRef      = React.useRef({});   // page index -> cursor string
  const [caseTypeFilter, setCaseTypeFilter]       = useState("all");

  // Real PACER case catalog (defendant-grouped) from /api/portfolio-cases
  const [pacer, setPacer]                 = useState(null);
  const [pacerLoading, setPacerLoading]   = useState(true);
  const [pacerError, setPacerError]       = useState(null);

  useEffect(() => {
    fetch("/api/credit-portfolio")
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => {
        if (d.nextCursor) pageCursorsRef.current[1] = d.nextCursor;
        setData(d);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (pageAbortRef.current) pageAbortRef.current.abort();
    if (leadsPage === 0) { setPageLeads(null); setPageHasMore(null); setPageLeadsError(null); setPageLeadsLoading(false); return; }
    const cursor = pageCursorsRef.current[leadsPage];
    if (!cursor) { setLeadsPage(0); return; }
    const ac = new AbortController();
    pageAbortRef.current = ac;
    setPageLeadsLoading(true);
    setPageLeadsError(null);
    fetch(`/api/credit-portfolio?cursor=${encodeURIComponent(cursor)}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => {
        if (d.nextCursor) pageCursorsRef.current[leadsPage + 1] = d.nextCursor;
        setPageLeads(d.topLeads || []);
        setPageHasMore(!!d.hasMore);
        setPageLeadsLoading(false);
      })
      .catch(e => { if (e.name === "AbortError") return; setPageLeadsError(e.message); setPageLeadsLoading(false); });
  }, [leadsPage]);

  useEffect(() => {
    fetch("/api/portfolio-cases")
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => { setPacer(d); setPacerLoading(false); })
      .catch(e => { setPacerError(e.message); setPacerLoading(false); });
  }, []);

  function openProfile(id, caseCtx = null) {
    if (profileAbortRef.current) profileAbortRef.current.abort();
    const ac = new AbortController();
    profileAbortRef.current = ac;
    setFocusCase(caseCtx);
    setProfileId(id);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(true);
    fetch(`/api/credit-client?id=${encodeURIComponent(id)}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => { setProfile(d); setProfileLoading(false); })
      .catch(e => { if (e.name === "AbortError") return; setProfileError(e.message); setProfileLoading(false); });
  }

  // Fetch one page of a case's claimants. Cursor-based: the API returns the
  // complete population page by page; we keep each page's cursor so Prev can
  // re-fetch earlier pages.
  function fetchCaseClients(c, page) {
    if (caseClientsAbortRef.current) caseClientsAbortRef.current.abort();
    const ac = new AbortController();
    caseClientsAbortRef.current = ac;
    setCaseClientsLoading(true);
    setCaseClientsError(null);
    const params = new URLSearchParams();
    // For real PACER defendant clusters the defendant name is the join key to
    // people; don't constrain by case type (ingest may tag the same furnisher
    // as FDCPA or FCRA). The illustrative cases still filter by case type.
    if (c.matchByDefendantOnly && c.defendantQ) {
      params.set("defendant", c.defendantQ);
    } else {
      params.set("caseType", c.caseType);
      if (c.defendantQ) params.set("defendant", c.defendantQ);
    }
    const cur = caseCursorsRef.current[page];
    if (cur) params.set("cursor", cur);
    fetch(`/api/case-clients?${params}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => {
        if (d.nextCursor) caseCursorsRef.current[page + 1] = d.nextCursor;
        setCaseClients(d.clients || []);
        setCaseClientsTotal(d.total ?? null);
        setCaseClientsHasMore(!!d.hasMore);
        setCaseClientsPage(page);
        setCaseClientsLoading(false);
      })
      .catch(e => { if (e.name === "AbortError") return; setCaseClientsError(e.message); setCaseClientsLoading(false); });
  }

  function openCase(c) {
    setSelectedCase(c);
    setCaseClients([]);
    setCaseClientsTotal(null);
    setCaseClientsHasMore(false);
    setCaseClientsPage(0);
    caseCursorsRef.current = {};
    fetchCaseClients(c, 0);
  }

  if (loading) return (
    <div style={{ padding: 40, color: "var(--text-4)", textAlign: "center" }}>
      Loading credit portfolio data...
    </div>
  );

  if (error) return (
    <div style={{ padding: 40, color: "#ef4444" }}>Error: {error}</div>
  );

  if (!data || data.status === "not_ingested") return (
    <div style={{ padding: 40, maxWidth: 600 }}>
      <h2 style={{ color: "var(--text-1)", marginBottom: 12 }}>Credit Portfolio</h2>
      <p style={{ color: "var(--text-4)", marginBottom: 20 }}>
        The credit.com dataset has not been ingested yet. Run the ingest script to populate this tab.
      </p>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, fontFamily: "monospace", fontSize: 13, color: "#22c55e" }}>
        <div style={{ color: "var(--text-5)", marginBottom: 8 }}># Make sure env vars are available first:</div>
        <div>vercel env pull .env.local</div>
        <div style={{ marginTop: 8 }}>node tools/credit-ingest.js</div>
      </div>
      <p style={{ color: "var(--text-5)", fontSize: 12, marginTop: 12 }}>
        Processes 287K+ people from the credit.com Azure blob, matches them to TCPA, FDCPA, FCRA, RESPA, Student Loan, Auto, Data Breach, and Payday case types, then writes results to Vercel KV.
      </p>
    </div>
  );

  const { stats, topLeads = [] } = data;
  const pop = stats?.population || {};
  const { byCaseType = {}, bySolStatus = {}, matchRate = 0, actionableRate = 0,
          note: statsNote = "" } = stats || {};
  const processed   = pop.processed   || 0;
  const matched     = pop.matched     || 0;
  const actionable  = pop.actionable  || 0;
  const intakeReady = pop.intakeReady || 0;
  const excludedDnc = pop.dncExcluded || 0;

  const SOL_LABELS = {
    discharge_ongoing: "Discharge violation (no SOL)",
    live:              "Within federal SOL",
    live_state_udap:   "Live via state UDAP",
    time_barred:       "Time-barred (confirm current status)",
    undated:           "Undated source",
  };
  const SOL_COLORS = {
    discharge_ongoing: "#22c55e", live: "#2D7D95", live_state_udap: "#8b5cf6",
    time_barred: "#6b7280", undated: "#9ca3af",
  };

  const totalCaseMatches = Object.values(byCaseType).reduce((a, b) => a + b, 0);
  const currentLeads = pageLeads ?? topLeads;
  const filteredLeads = filter === "all"
    ? currentLeads
    : currentLeads.filter(l => l.cases?.includes(filter));

  const leadsTotal = data.leadsTotal ?? topLeads.length;
  const leadsPageCount = Math.max(1, Math.ceil(leadsTotal / PAGE_SIZE));
  const leadsHasMore = pageHasMore ?? data.hasMore ?? false;

  // Real PACER cases (defendant-grouped) for the Cases view. Each defendant is
  // a litigation cluster the credit DB is matched against.
  const pacerCases = (pacer?.defendants || []).map(d => ({
    id:              `pacer-${d.defendantQ.replace(/\s+/g, "-")}`,
    caseType:        d.caseType,
    name:            d.defendant,
    defendant:       d.defendant,
    defendantQ:      d.defendantQ,
    category:        d.category,
    caseCount:       d.caseCount,
    openCases:       d.openCases,
    newCases:        d.newCases,
    classSettlement: d.classSettlement,
    consumers:       d.consumers || null,
    claimPath:       d.claimPath || null,
    examples:        d.examples || [],
    matchByDefendantOnly: true,
    status:          `${(d.caseCount || 0).toLocaleString()} federal dockets — ${d.openCases || 0} open${d.newCases ? `, ${d.newCases} filed 2024–26` : ""}`,
    admin:           "Consumer plaintiffs' bar (FDCPA/FCRA/TCPA)",
    info:            CASE_TYPE_INFO[d.caseType],
  }));
  // National TCPA marketer index (reference catalog; top entries are banks that
  // also appear in credit reports and are matchable).
  const tcpaMarketerCases = (pacer?.tcpaMarketers || []).map(d => ({
    id:              `tcpa-${d.defendantQ.replace(/\s+/g, "-")}`,
    caseType:        "TCPA",
    name:            d.defendant,
    defendant:       d.defendant,
    defendantQ:      d.defendantQ,
    caseCount:       d.caseCount,
    openCases:       d.openCases,
    consumers:       d.consumers || null,
    claimPath:       d.claimPath || null,
    examples:        d.examples || [],
    matchByDefendantOnly: true,
    status:          `${(d.caseCount || 0).toLocaleString()} national TCPA dockets — ${d.openCases || 0} open`,
    admin:           "Consumer plaintiffs' bar (TCPA robocall/text)",
    info:            CASE_TYPE_INFO.TCPA,
  }));
  const tcpaMeta = pacer?.tcpaMarketerMeta || null;

  // National consumer-credit index (NOS 480/371/490, all Top-1000 entities +
  // bureaus). Defendants already shown as 41-cluster cards are skipped so each
  // entity appears once. Bureau cards apply to the entire base — no per-person
  // casepeople join exists for them, so they render without the people query.
  const clusterTokens = new Set(pacerCases.map(c => c.defendantQ));
  const nationalEntityCases = (pacer?.nationalEntities || [])
    .filter(d => !clusterTokens.has(d.defendantQ))
    .map(d => ({
      id:              `nat-${d.defendantQ.replace(/\s+/g, "-")}`,
      caseType:        "FCRA",
      name:            d.defendant,
      defendant:       d.defendant,
      defendantQ:      d.defendantQ,
      bureau:          d.bureau,
      entityType:      d.entityType,
      caseCount:       d.caseCount,
      openCases:       d.openCases,
      candidates:      d.candidates,
      consumersInDb:   d.consumersInDb,
      claimPath:       d.claimPath || null,
      examples:        d.examples || [],
      matchByDefendantOnly: true,
      status:          `${(d.caseCount || 0).toLocaleString()} national consumer-credit dockets — ${d.openCases || 0} open`,
      admin:           "Consumer plaintiffs' bar (FCRA/FDCPA/TILA)",
      info:            CASE_TYPE_INFO.FCRA,
    }));
  const nationalMeta = pacer?.nationalEntityMeta || null;

  const pacerCaseTypes = [...new Set(pacerCases.map(c => c.caseType))]
    .sort((a, b) => pacerCases.filter(c => c.caseType === b).length - pacerCases.filter(c => c.caseType === a).length);
  if (tcpaMarketerCases.length && !pacerCaseTypes.includes("TCPA")) pacerCaseTypes.push("TCPA");
  const visiblePacerCases = pacerCases.filter(c => caseTypeFilter === "all" || c.caseType === caseTypeFilter);
  const showTcpaMarketers = tcpaMarketerCases.length > 0 && (caseTypeFilter === "all" || caseTypeFilter === "TCPA");
  const showNationalEntities = nationalEntityCases.length > 0 && (caseTypeFilter === "all" || caseTypeFilter === "FCRA");

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1200 }}>

      {/* Client profile modal */}
      <ClientProfileModal
        profileId={profileId}
        profile={profile}
        focusCase={focusCase}
        loading={profileLoading}
        error={profileError}
        onClose={() => { setProfileId(null); setFocusCase(null); }}
      />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Credit.com Portfolio</h2>
          <div style={{ color: "var(--text-5)", fontSize: 13, marginTop: 4 }}>
~10.25M total people (1.4M CCOM + 8.85M LEX) &bull; {fmtN(processed)} processed &bull; {fmtN(matched)} matched &bull; generated {stats?.generatedAt || "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: "var(--bg-surface)", borderRadius: 6, padding: 3, gap: 2 }}>
            {[["people", "People"], ["cases", "Cases"]].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => { setViewMode(mode); setSelectedCase(null); }}
                style={{ fontSize: 12, padding: "5px 16px", borderRadius: 4, border: "none", cursor: "pointer", fontWeight: 600, background: viewMode === mode ? "#2D7D95" : "transparent", color: viewMode === mode ? "#fff" : "#9ca3af", transition: "all 0.15s" }}
              >
                {label}
              </button>
            ))}
          </div>
          <Btn onClick={() => window.open("data/credit-matches/ingest-results.json")} style={{ fontSize: 12 }}>
            Export JSON
          </Btn>
        </div>
      </div>

      {/* Cases view */}
      {viewMode === "cases" && !selectedCase && (
        <div>
          {/* Catalog summary */}
          {pacer?.totals && (
            <div style={{ fontSize: 13, color: "var(--text-4)", marginBottom: 16 }}>
              <span style={{ color: "var(--text-1)", fontWeight: 700 }}>{fmtN(pacer.totals.dockets)}</span> federal FDCPA/FCRA/TCPA dockets
              across <span style={{ color: "var(--text-1)", fontWeight: 700 }}>{pacer.defendantCount}</span> litigation-prone defendants
              &bull; <span style={{ color: "#22c55e", fontWeight: 600 }}>{fmtN(pacer.totals.open)} open</span>
              {pacer.totals.newCases ? <> &bull; {fmtN(pacer.totals.newCases)} filed 2024–26</> : null}
              <span style={{ color: "var(--text-5)" }}> — sourced from PACER. Click any defendant to see eligible people in the credit DB.</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              onClick={() => setCaseTypeFilter("all")}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: caseTypeFilter === "all" ? "#2D7D95" : "var(--bg-surface)", color: "var(--text-1)", cursor: "pointer" }}
            >
              All ({pacerCases.length + tcpaMarketerCases.length})
            </button>
            {pacerCaseTypes.map(ct => {
              const ctCount = ct === "TCPA"
                ? pacerCases.filter(c => c.caseType === "TCPA").length + tcpaMarketerCases.length
                : pacerCases.filter(c => c.caseType === ct).length;
              return (
              <button
                key={ct}
                onClick={() => setCaseTypeFilter(ct)}
                style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: `1px solid ${(CASE_COLORS[ct] || "var(--border)")}50`, background: caseTypeFilter === ct ? (CASE_COLORS[ct] || "var(--border)") : "var(--bg-surface)", color: "var(--text-1)", cursor: "pointer" }}
              >
                {CASE_LABELS[ct] || ct} ({ctCount})
              </button>
              );
            })}
          </div>

          {pacerLoading && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-4)" }}>Loading PACER case catalog...</div>
          )}
          {pacerError && (
            <div style={{ padding: 20, color: "#ef4444" }}>Error loading cases: {pacerError}</div>
          )}
          {!pacerLoading && !pacerError && pacerCases.length === 0 && (
            <div style={{ padding: 20, color: "var(--text-5)", fontSize: 13 }}>
              No PACER case evidence loaded yet. Run the match-derive sweep to populate the defendant catalog.
            </div>
          )}

          {visiblePacerCases.length > 0 && (
            <CaseTable
              rows={visiblePacerCases}
              countLabel="Federal dockets"
              countSub="PACER index"
              onOpen={openCase}
            />
          )}

          {/* National consumer-credit index (NOS 480/371/490, all entities) */}
          {showNationalEntities && (
            <div style={{ marginTop: 36 }}>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>
                  National Consumer-Credit Index — All Furnishers & Bureaus
                </div>
                <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 18, lineHeight: 1.6, maxWidth: 820 }}>
                  {nationalMeta ? <><span style={{ color: "var(--text-3)", fontWeight: 600 }}>{fmtN(nationalMeta.indexCases)}</span> federal consumer-credit dockets (NOS 480/371/490, 2015–2026), <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{fmtN(nationalMeta.matchedCases)}</span> matched to creditors in the file. </> : null}
                  Covers every Top-1000 furnisher plus the big-3 bureaus — the bureau cards apply to the <em>entire</em> base since every person has all three bureau files. Click a furnisher to see its people.
                </div>
                <CaseTable
                  rows={nationalEntityCases.slice(0, 60)}
                  countLabel="National dockets"
                  countSub="NOS 480/371/490"
                  onOpen={openCase}
                />
                {nationalEntityCases.length > 60 && (
                  <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 14 }}>
                    Showing top 60 of {fmtN(nationalEntityCases.length)} entities by docket volume.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* National TCPA marketer index (reference catalog) */}
          {showTcpaMarketers && (
            <div style={{ marginTop: 36 }}>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>
                  TCPA — National Robocall/Marketer Index
                </div>
                <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 18, lineHeight: 1.6, maxWidth: 820 }}>
                  {tcpaMeta ? <><span style={{ color: "var(--text-3)", fontWeight: 600 }}>{fmtN(tcpaMeta.sourceTotal)}</span> national TCPA dockets (NOS 485) grouped into <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{fmtN(tcpaMeta.defendantCount)}</span> multi-case defendants. </> : null}
                  Most are robocall/text marketers that don't appear in credit reports — but the highest-volume defendants are banks and lenders (Citibank, Capital One, Synchrony, Amex…) that <em>do</em> appear as furnishers, so they still match people. Click any defendant to check the credit DB.
                </div>
                <CaseTable
                  rows={tcpaMarketerCases.slice(0, 60)}
                  countLabel="National TCPA dockets"
                  countSub="NOS 485"
                  onOpen={openCase}
                />
                {tcpaMarketerCases.length > 60 && (
                  <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 14 }}>
                    Showing top 60 of {fmtN(tcpaMarketerCases.length)} multi-case TCPA defendants by docket volume.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Case detail — filtered client list */}
      {viewMode === "cases" && selectedCase && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <button
              onClick={() => setSelectedCase(null)}
              style={{ fontSize: 12, padding: "5px 14px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-4)", cursor: "pointer" }}
            >
              Back to Cases
            </button>
            <div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 3, background: `${CASE_COLORS[selectedCase.caseType] || "var(--border)"}22`, color: CASE_COLORS[selectedCase.caseType] || "#9ca3af", border: `1px solid ${CASE_COLORS[selectedCase.caseType] || "var(--border)"}44`, fontWeight: 700, marginRight: 8 }}>
                {CASE_LABELS[selectedCase.caseType] || selectedCase.caseType}
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)" }}>{selectedCase.name}</span>
            </div>
          </div>

          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 18px", marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, fontSize: 12 }}>
              <div><span style={{ color: "var(--text-5)" }}>Status: </span><span style={{ color: "var(--text-2)" }}>{selectedCase.status}</span></div>
              <div><span style={{ color: "var(--text-5)" }}>Administrator: </span><span style={{ color: "var(--text-2)" }}>{selectedCase.admin}</span></div>
              <div><span style={{ color: "var(--text-5)" }}>Damages: </span><span style={{ color: "#22c55e" }}>{selectedCase.info?.damages?.split(".")[0] || "—"}</span></div>
            </div>
            {selectedCase.info?.solWarning && (
              <div style={{ marginTop: 10, fontSize: 11, color: "#f59e0b" }}>{selectedCase.info.solWarning}</div>
            )}
            {selectedCase.info?.watchOut && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#fca5a5" }}>Watch out: {selectedCase.info.watchOut}</div>
            )}
          </div>

          {caseClientsLoading && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-4)" }}>Loading eligible people...</div>
          )}
          {caseClientsError && (
            <div style={{ padding: 20, color: "#ef4444" }}>Error: {caseClientsError}</div>
          )}
          {!caseClientsLoading && !caseClientsError && (
            <Card style={{ padding: 20 }}>
              <div style={{ fontSize: 13, color: "var(--text-4)", marginBottom: 14 }}>
                {caseClientsTotal != null
                  ? `${fmtN(caseClientsTotal)} total claimants — page ${fmtN(caseClientsPage + 1)} of ${fmtN(Math.max(1, Math.ceil(caseClientsTotal / 50)))}, ranked by priority score`
                  : `Page ${fmtN(caseClientsPage + 1)} — ranked by priority score`}
                {selectedCase.defendantQ ? ` — defendant keyword: "${selectedCase.defendantQ}"` : ` — all ${CASE_LABELS[selectedCase.caseType] || selectedCase.caseType} signals`}
              </div>
              {caseClients.length === 0 ? (
                <div style={{ color: "var(--text-5)", fontSize: 13 }}>
                  {caseClientsPage === 0
                    ? "No matches found in scanned records. Try browsing the People view and filtering by case type."
                    : "No matches on this page."}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "var(--text-5)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>State</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Match Basis</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>Score</th>
                      <th style={{ textAlign: "right", padding: "6px 8px" }}>Recovery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseClients.map(lead => {
                      const sigs = lead.signals || [];
                      const sig = sigs[0] || {};
                      const sColor = STRENGTH_COLOR[sig.strength] || "#6b7280";
                      const multiNote = sigs.length > 1 ? ` (+${sigs.length - 1} more signal${sigs.length > 2 ? "s" : ""})` : "";
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => openProfile(lead.id, selectedCase)}
                          style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                        >
                          <td style={{ padding: "8px 8px", color: "var(--text-1)", fontWeight: 600 }}>{lead.name || "—"}</td>
                          <td style={{ padding: "8px 8px", color: "var(--text-4)" }}>{lead.state || "—"}</td>
                          <td style={{ padding: "8px 8px", maxWidth: 380 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600 }}>{sig.defendant || "—"}</span>
                              <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 3, background: `${sColor}20`, color: sColor, border: `1px solid ${sColor}40`, whiteSpace: "nowrap" }}>
                                {sig.strength || "—"} signal
                              </span>
                              {multiNote && <span style={{ fontSize: 10, color: "var(--text-5)" }}>{multiNote}</span>}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-4)", lineHeight: 1.4 }}>
                              {signalBasis(sig.caseType || selectedCase.caseType, sig.defendant)}
                            </div>
                          </td>
                          <td style={{ textAlign: "right", padding: "8px 8px", fontWeight: 700, color: lead.score >= 75 ? "#22c55e" : lead.score >= 50 ? "#f59e0b" : "#ef4444" }}>
                            {lead.score}
                          </td>
                          <td style={{ textAlign: "right", padding: "8px 8px", color: "#22c55e", fontWeight: 600 }}>
                            {fmt$(lead.recovery?.mid)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* Pager */}
              {(caseClientsPage > 0 || caseClientsHasMore) && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <button
                    onClick={() => fetchCaseClients(selectedCase, caseClientsPage - 1)}
                    disabled={caseClientsPage === 0 || caseClientsLoading}
                    style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-surface)", color: caseClientsPage === 0 ? "var(--text-5)" : "var(--text-1)", cursor: caseClientsPage === 0 || caseClientsLoading ? "default" : "pointer", opacity: caseClientsPage === 0 || caseClientsLoading ? 0.5 : 1 }}
                  >
                    Prev
                  </button>
                  <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                    Page {fmtN(caseClientsPage + 1)}{caseClientsTotal != null ? ` of ${fmtN(Math.max(1, Math.ceil(caseClientsTotal / 50)))}` : ""}
                  </span>
                  <button
                    onClick={() => fetchCaseClients(selectedCase, caseClientsPage + 1)}
                    disabled={!caseClientsHasMore || caseClientsLoading}
                    style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-surface)", color: !caseClientsHasMore ? "var(--text-5)" : "var(--text-1)", cursor: !caseClientsHasMore || caseClientsLoading ? "default" : "pointer", opacity: !caseClientsHasMore || caseClientsLoading ? 0.5 : 1 }}
                  >
                    Next
                  </button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* People view (existing content) — only shown when in people mode */}
      {viewMode === "people" && (<>

      {/* Top stat boxes */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <StatBox
          label="Actionable Leads"
          value={fmtN(actionable)}
          sub="≥1 live or ongoing claim"
          color="#22c55e"
        />
        <StatBox
          label="Intake Ready"
          value={fmtN(intakeReady)}
          sub="actionable + reachable"
          color="#8b5cf6"
        />
        <StatBox
          label="People Matched"
          value={fmtN(matched)}
          sub={`${matchRate}% of ${fmtN(processed)} processed`}
          color="#f59e0b"
        />
        <StatBox
          label="Time-Barred Signals"
          value={fmtN(bySolStatus.time_barred || 0)}
          sub="revivable if still reporting/collecting"
          color="#6b7280"
        />
        <StatBox
          label="DNC Excluded"
          value={fmtN(excludedDnc)}
          sub="not contactable"
          color="var(--text-5)"
        />
      </div>

      {/* Two column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>

        {/* Case type breakdown */}
        <Card style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-1)" }}>
            Case Type Breakdown
          </div>
          {Object.entries(byCaseType)
            .sort((a, b) => b[1] - a[1])
            .map(([ct, count]) => {
              const r = { TCPA:300, FDCPA:500, FCRA:300, RESPA:1500, StudentLoan:2000, AutoLending:1000, DataBreach:150, UDAP_Payday:500 };
              return (
                <CaseTypeBar
                  key={ct}
                  label={CASE_LABELS[ct] || ct}
                  count={count}
                  total={matched}
                  color={CASE_COLORS[ct] || "#6b7280"}
                  recovery={count * (r[ct] || 200)}
                />
              );
            })}
        </Card>

        {/* SOL status breakdown */}
        <Card style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-1)" }}>
            Claim Status (statute of limitations)
          </div>
          {["discharge_ongoing", "live", "live_state_udap", "time_barred", "undated"]
            .filter(k => bySolStatus[k])
            .map(k => {
              const total = Object.values(bySolStatus).reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((bySolStatus[k] / total) * 100);
              return (
                <div key={k} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: SOL_COLORS[k] || "var(--text-2)", fontWeight: 600 }}>{SOL_LABELS[k] || k}</span>
                    <span style={{ color: "var(--text-4)" }}>{fmtN(bySolStatus[k])} ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: "var(--bg-surface)", borderRadius: 3 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: SOL_COLORS[k] || "#6b7280", borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          <div style={{ color: "var(--text-5)", fontSize: 11, marginTop: 8 }}>
            Counts are claim signals. Time-barred claims can revive if the company is still reporting or collecting — confirm via intake.
          </div>
        </Card>
      </div>

      {/* Case type breakdown table (signal counts — honest, no fabricated $) */}
      <Card style={{ padding: 20, marginBottom: 28 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text-1)" }}>
          Claim Signals by Case Type
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text-5)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Case Type</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Signals</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byCaseType).sort((a,b) => b[1]-a[1]).map(([ct, count]) => (
              <tr key={ct} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 8px", color: CASE_COLORS[ct] || "#e5e7eb", fontWeight: 600 }}>
                  {CASE_LABELS[ct] || ct}
                </td>
                <td style={{ textAlign: "right", padding: "8px 8px", color: "var(--text-2)" }}>{fmtN(count)}</td>
                <td style={{ textAlign: "right", padding: "8px 8px", color: "var(--text-4)" }}>
                  {Math.round((count / Math.max(totalCaseMatches, 1)) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
              <td style={{ padding: "8px 8px", color: "var(--text-1)" }}>TOTAL</td>
              <td style={{ textAlign: "right", padding: "8px 8px", color: "var(--text-1)" }}>{fmtN(totalCaseMatches)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div style={{ color: "var(--text-5)", fontSize: 11, marginTop: 10 }}>
          {statsNote || "Signal counts after SOL flagging. A person can carry multiple signals. Recovery is assessed per claim at intake, not extrapolated."}
        </div>
      </Card>

      {/* Top leads */}
      <Card style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
            Highest-Priority Matched People
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setFilter("all")}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid var(--border)", background: filter === "all" ? "#2D7D95" : "var(--bg-surface)", color: "var(--text-1)", cursor: "pointer" }}
            >
              All
            </button>
            {Object.keys(byCaseType).sort().map(ct => (
              <button
                key={ct}
                onClick={() => setFilter(ct)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: `1px solid ${(CASE_COLORS[ct] || "var(--border)")}50`, background: filter === ct ? (CASE_COLORS[ct] || "var(--border)") : "var(--bg-surface)", color: "var(--text-1)", cursor: "pointer" }}
              >
                {CASE_LABELS[ct] || ct}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--text-5)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>State</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Contact</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Case Types</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Score</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>Recovery Est.</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => openProfile(lead.id)}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "8px 8px", color: "var(--text-1)", fontWeight: 600 }}>{lead.name || "—"}</td>
                  <td style={{ padding: "8px 8px", color: "var(--text-4)" }}>{lead.state || "—"}</td>
                  <td style={{ padding: "8px 8px", color: "var(--text-5)" }}>
                    {lead.phone ? "Phone" : ""}
                    {lead.phone && lead.email ? " / " : ""}
                    {lead.email ? "Email" : ""}
                    {!lead.phone && !lead.email ? "—" : ""}
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(lead.cases || []).map(ct => (
                        <span key={ct} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: `${CASE_COLORS[ct] || "var(--border)"}25`, color: CASE_COLORS[ct] || "#9ca3af", border: `1px solid ${CASE_COLORS[ct] || "var(--border)"}40` }}>
                          {CASE_LABELS[ct] || ct}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", padding: "8px 8px" }}>
                    <span style={{ fontWeight: 700, color: lead.score >= 75 ? "#22c55e" : lead.score >= 50 ? "#f59e0b" : "#ef4444" }}>
                      {lead.score}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", padding: "8px 8px", color: "#22c55e", fontWeight: 600 }}>
                    {fmt$(lead.recovery?.mid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageLeadsLoading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-4)", fontSize: 12 }}>
              Loading page {leadsPage + 1}...
            </div>
          )}
          {pageLeadsError && (
            <div style={{ padding: 16, color: "#ef4444", fontSize: 12 }}>Error loading page: {pageLeadsError}</div>
          )}
          {!pageLeadsLoading && !pageLeadsError && filteredLeads.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-5)", fontSize: 12 }}>
              {filter === "all" ? "No people on this page." : `No ${CASE_LABELS[filter] || filter} matches on this page — the filter applies within the current page of ${PAGE_SIZE}.`}
            </div>
          )}
        </div>

        {/* Pager */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-5)" }}>
            {fmtN(leadsTotal)} matched people, ranked by score
            {filter !== "all" ? ` — filter applies within the current page` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setLeadsPage(p => Math.max(0, p - 1))}
              disabled={leadsPage === 0 || pageLeadsLoading}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-surface)", color: leadsPage === 0 ? "var(--text-5)" : "var(--text-1)", cursor: leadsPage === 0 || pageLeadsLoading ? "default" : "pointer", opacity: leadsPage === 0 || pageLeadsLoading ? 0.5 : 1 }}
            >
              Prev
            </button>
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>
              Page {fmtN(leadsPage + 1)} of {fmtN(leadsPageCount)}
            </span>
            <button
              onClick={() => setLeadsPage(p => p + 1)}
              disabled={!leadsHasMore || pageLeadsLoading}
              style={{ fontSize: 11, padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-surface)", color: !leadsHasMore ? "var(--text-5)" : "var(--text-1)", cursor: !leadsHasMore || pageLeadsLoading ? "default" : "pointer", opacity: !leadsHasMore || pageLeadsLoading ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
      </>)}

    </div>
  );
}
