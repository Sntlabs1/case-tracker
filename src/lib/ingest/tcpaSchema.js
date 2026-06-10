// Canonical schema for TCPA / FDCPA / FCRA case records.
//
// These records are machine-populated (CourtListener, FCC, class-action-site
// scrapes) and stored in Vercel KV. They are intentionally lean and structured —
// unlike the hand-curated narrative cases in src/data/knowledgeBase.js.
//
// KV layout:
//   tcpa:case:${id}                       full record JSON
//   tcpa:cases_by_filing_date             sorted set, score = filingDate epoch
//   tcpa:cases_by_settlement_date         sorted set, score = settlement.finalApprovalDate epoch
//   tcpa:cases_by_status:${status}        sorted set per status
//   tcpa:cases_by_state:${ST}             inverted index per state
//   tcpa:cases_by_defendant:${cId}        inverted index per canonical defendant
//   tcpa:cache:full                       paginated cache, 5-min TTL
//
// CASE_STATUS values:
//   active        — filed, no settlement yet
//   settled       — settlement reached, claim window not yet open
//   claim_open    — claim window currently accepting filings
//   claim_closed  — claim window closed; no new filings accepted
//   dismissed     — case dismissed without recovery

export const CASE_TYPES = [
  "TCPA", "FDCPA", "FCRA", "TCPA+FDCPA",
  // New claim types — see src/lib/recoveryEstimate.js for per-violation amounts
  "CROA",           // 15 U.S.C. § 1679 — Credit Repair Organizations Act
  "CIPA",           // CA Penal Code 631/632 — session-replay / wiretap
  "FL_FTSA",        // FL Stat. § 501.059 — FL Telephone Solicitation Act
  "UDAAP",          // Dodd-Frank § 1031+1036 + state UDAP
  "FCRA_FURNISHER", // 15 U.S.C. § 1681s-2(b) — furnisher dispute liability
  "ECOA",           // 15 U.S.C. § 1691 — adverse-action notice failures
  "ROSENTHAL",      // CA Civil Code § 1788 — CA FDCPA parallel
  "FCCPA",          // FL Stat. § 559.55 — FL FDCPA parallel
  "GLBA",           // 15 U.S.C. § 6801 — data breach / inadequate safeguards
];

export const CASE_STATUSES = [
  "active",
  "settled",
  "claim_open",
  "claim_closed",
  "dismissed",
];

// Posture applies to active cases only — how far along in litigation.
// Inferred from filing date + last docket activity where explicit data absent.
export const CASE_POSTURES = [
  "new_filing",        // filed < 6 months ago, no significant docket activity
  "discovery",         // active discovery, motions to compel, depositions
  "class_cert_pending",// motion for class certification pending or briefed
  "pre_trial",         // class certified or summary judgment briefing
  "trial",             // actively at trial
  "post_trial",        // verdict in, appeals/post-trial motions pending
  "settlement_pending",// settlement agreement reached, awaiting court approval
  "mdl_pending",       // JPML transfer order pending or entered
  "appeal",            // on appeal (circuit court or SCOTUS)
  "unknown",
];

export const JURISDICTIONS = ["federal", "state"];

export const NOS_CODES = {
  "890": "Other Statutory Actions (TCPA / Consumer Protection)",
  "480": "Consumer Credit (FDCPA / FCRA)",
};

export const SOURCES = [
  "CourtListener",
  "TopClassActions",
  "ClassAction.org",
  "FCC",
  "stateAG",
  "manual",
  "tcpaworld",
  "unicourt",
  "trellis",
  "westlaw",
];

// Named plaintiffs derived from case captions are stored on each record AND
// indexed at tcpa:cases_by_plaintiff:${normalizedName}. This lets the UI
// surface "repeat-player plaintiffs" — names that appear across multiple
// filings, often class-action serial named plaintiffs.

// Infer case posture from filing date + last docket date when not explicitly set.
function inferPosture(input) {
  const status = input.status || "";
  if (status === "claim_open")   return "claim_open";
  if (status === "claim_closed") return "claim_closed";
  if (status === "settled")      return "settled";
  if (status === "dismissed")    return "dismissed";
  // Active case — estimate from age
  const filed = input.filingDate ? new Date(input.filingDate) : null;
  if (!filed || isNaN(filed)) return "unknown";
  const ageMonths = (Date.now() - filed.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (ageMonths < 6)  return "new_filing";
  if (ageMonths < 18) return "discovery";
  if (ageMonths < 36) return "class_cert_pending";
  return "pre_trial";
}

// Build a fresh, validated record from a partial input. Throws on missing required fields.
export function buildCase(input) {
  const required = ["caption", "caseType", "court", "filingDate", "status"];
  for (const k of required) {
    if (input[k] === undefined || input[k] === null || input[k] === "") {
      throw new Error(`tcpaSchema.buildCase: missing required field '${k}'`);
    }
  }
  if (!CASE_TYPES.includes(input.caseType)) {
    throw new Error(`tcpaSchema.buildCase: invalid caseType '${input.caseType}'`);
  }
  if (!CASE_STATUSES.includes(input.status)) {
    throw new Error(`tcpaSchema.buildCase: invalid status '${input.status}'`);
  }
  const id = input.id || generateCaseId(input);
  const now = new Date().toISOString();
  return {
    id,
    caption:           input.caption,
    caseType:          input.caseType,
    defendants:        input.defendants || [],
    plaintiffs:        Array.isArray(input.plaintiffs) ? input.plaintiffs.filter(Boolean) : [],
    court: {
      name:         input.court.name || "",
      jurisdiction: input.court.jurisdiction || "federal",
      state:        (input.court.state || "").toUpperCase().slice(0, 2),
      district:     input.court.district || "",
      docket:       input.court.docket || "",
      citation:     input.court.citation || "",
    },
    natureOfSuit:      input.natureOfSuit || null,
    filingDate:        normalizeDate(input.filingDate),
    lastDocketDate:    normalizeDate(input.lastDocketDate || input.filingDate),
    classPeriod: {
      start: normalizeDate(input.classPeriod?.start),
      end:   normalizeDate(input.classPeriod?.end),
    },
    // Auto-promote status based on claim window dates so cases don't sit
    // as "settled" forever when we actually know the window is open or closed.
    status: (() => {
      const closes = normalizeDate(input.settlement?.claimWindowCloses);
      const opens  = normalizeDate(input.settlement?.claimWindowOpens);
      const now2   = new Date().toISOString().slice(0, 10);
      if (closes && closes < now2) return "claim_closed";
      if (closes && closes >= now2) return "claim_open";
      if (opens  && opens  <= now2) return "claim_open";
      return input.status;
    })(),
    casePosture:       CASE_POSTURES.includes(input.casePosture) ? input.casePosture : inferPosture(input),
    settlement: {
      totalFund:           input.settlement?.totalFund || null,
      perClaimantRange:    input.settlement?.perClaimantRange || null,
      claimWindowOpens:    normalizeDate(input.settlement?.claimWindowOpens),
      claimWindowCloses:   normalizeDate(input.settlement?.claimWindowCloses),
      claimPortalUrl:      input.settlement?.claimPortalUrl || null,
      classNoticeUrl:      input.settlement?.classNoticeUrl || null,
      finalApprovalDate:   normalizeDate(input.settlement?.finalApprovalDate),
      fairnessHearingDate: normalizeDate(input.settlement?.fairnessHearingDate),
      claimRequirements:   input.settlement?.claimRequirements || "",
      adminName:           input.settlement?.adminName || "",
      adminPhone:          input.settlement?.adminPhone || "",
      adminEmail:          input.settlement?.adminEmail || "",
      adminWebsite:        input.settlement?.adminWebsite || "",
    },
    classDefinition:   input.classDefinition || "",
    conductDescription:input.conductDescription || "",
    geographicScope:   input.geographicScope || "nationwide",
    eligibleStates:    Array.isArray(input.eligibleStates)
                          ? input.eligibleStates.map(s => s.toUpperCase().slice(0, 2))
                          : [],
    attorneys: {
      plaintiff: input.attorneys?.plaintiff || [],
      defense:   input.attorneys?.defense || [],
    },
    citations:         input.citations || [],
    source:            SOURCES.includes(input.source) ? input.source : "manual",
    sourceUrl:         input.sourceUrl || "",
    lastVerifiedAt:    input.lastVerifiedAt || now,
    ingestedAt:        input.ingestedAt || now,
  };
}

export function generateCaseId(input) {
  const slug = (input.caption || "case")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `tcpa_${slug}_${ts}${rand}`;
}

function normalizeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  // Already YYYY-MM-DD
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// ── KV key helpers ──────────────────────────────────────────────────────────
export const KEYS = {
  case:               (id) => `tcpa:case:${id}`,
  byFilingDate:       () => "tcpa:cases_by_filing_date",
  bySettlementDate:   () => "tcpa:cases_by_settlement_date",
  byStatus:           (s) => `tcpa:cases_by_status:${s}`,
  byState:            (st) => `tcpa:cases_by_state:${st}`,
  byDefendant:        (cId) => `tcpa:cases_by_defendant:${cId}`,
  byPlaintiff:        (norm) => `tcpa:cases_by_plaintiff:${norm}`,
  plaintiffIndex:     () => "tcpa:plaintiffs_index",
  cacheFull:          () => "tcpa:cache:full",
  searchPage:         (n)  => `tcpa:search_index:page:${n}`,
  searchMeta:         ()   => "tcpa:search_index:meta",
};

// Compact summary for the client-side search index (~150 bytes/case).
// Short keys keep total payload under KV 1MB/page limit for 7k+ cases.
export function caseSummary(c) {
  return {
    i:  c.id,
    ca: c.caption,
    s:  c.status,
    t:  c.caseType,
    p:  c.casePosture  || null,
    f:  c.filingDate,
    d:  (c.defendants || []).map(d => d.displayName).filter(Boolean),
    st: c.court?.state || null,
    cw: c.settlement?.claimWindowCloses || null,
    pc: c.settlement?.perClaimantRange  || null,
    tf: c.settlement?.totalFund         || null,
    sr: c.source || null,
  };
}

export function epochOrZero(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
