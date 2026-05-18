// Canonical credit-report shape.
//
// Every ingest path (credit.com JSON API, CSV bulk export, raw PDF) normalizes
// to THIS shape. From here, src/lib/creditReportToClient.js maps it onto the
// existing client + collectionsHistory model AND the new creditAccounts /
// bankruptcies / inquiries arrays the matcher reads.
//
// Why a separate schema (not just inlined on the client record)?
//   - A credit report is a SNAPSHOT — we may receive multiple reports per
//     plaintiff over time. Storing each one preserves history.
//   - Different bureaus and aggregators use different field names. One
//     canonical shape lets us write the matcher once.
//   - PDF extraction is lossy. Storing the raw, normalized shape lets us
//     audit later if a match dispute surfaces.
//
// All dates are ISO YYYY-MM-DD. Missing/unknown fields are null, not omitted.

// ── Reference enums ────────────────────────────────────────────────────────

export const ACCOUNT_TYPES = [
  "revolving",      // credit card, line of credit
  "installment",    // auto loan, personal loan, student loan
  "mortgage",       // first or second mortgage, HELOC
  "open",           // utility, charge card with no preset limit
  "collection",     // account placed with a debt collector
  "other",
];

export const ACCOUNT_STATUSES = [
  "open_current",       // open, paying as agreed
  "open_past_due",      // open, behind on payments
  "closed_paid",        // closed in good standing
  "closed_charged_off", // closed at a loss
  "in_collection",      // sent to a debt collector
  "in_dispute",         // consumer disputed
  "bankruptcy",         // included in bankruptcy
  "unknown",
];

export const RESPONSIBILITY = [
  "individual",
  "joint",
  "co_signer",
  "authorized_user",
  "co_applicant",
  "deceased",
  "terminated",
  "unknown",
];

export const PUBLIC_RECORD_TYPES = [
  "bankruptcy_ch7",
  "bankruptcy_ch11",
  "bankruptcy_ch13",
  "civil_judgment",
  "tax_lien_paid",
  "tax_lien_unpaid",
  "other",
];

export const BUREAUS = ["TU", "EX", "EQ", "LN"];

// ── Canonical shape ────────────────────────────────────────────────────────
//
// CreditReport {
//   reportDate: ISO date          when the report was pulled
//   reportNumber: string|null
//   bureau: "TU" | "EX" | "EQ" | "joint" | "credit_com" | other
//   sourceFormat: "json" | "csv" | "pdf" | "manual"
//   sourceFilename: string|null
//
//   consumer: {
//     firstName, lastName, middleName,
//     ssnLast4: "9820",            (last 4 only — never store full SSN)
//     dob: ISO date,
//     emails: string[],
//     phoneNumbers: string[],      (normalized to +1XXXXXXXXXX)
//     currentAddress: { street, city, state, zip, since: ISO },
//     addressHistory: [ { street, city, state, zip, from, to, bureau } ],
//     aliases: [ { firstName, lastName, type } ],
//     employmentHistory: [ { employer, position, start, end, bureau } ],
//   },
//
//   accounts: [               // ALL tradelines: credit cards, loans, mortgages, collections
//     {
//       id,                   stable hash of (creditor + accountNumber)
//       creditor: string,
//       creditorCanonicalId,  resolved at ingest via defendantResolver
//       originalCreditor,     for collections: the company that originated the debt
//       originalCreditorCanonicalId,
//       accountNumber,        masked (XXX...4645)
//       type: ACCOUNT_TYPES,
//       loanType: "Credit Card" | "Automobile" | "Student Loan" | "Mortgage" | "Secured" | ...,
//       status: ACCOUNT_STATUSES,
//       responsibility: RESPONSIBILITY,
//       dateOpened, dateLastActivity, dateLastReported, dateClosed, datePaid,
//       balance, highCredit, creditLimit, monthlyPayment, pastDue,
//       paymentHistory: "CCCCCCC1CCCC",   12 or 24 char string (C=current, 1=30d, 9=collection, etc.)
//       latePayments: { d30, d60, d90 },
//       remarks: string[],     e.g. ["ACCOUNT IN DISPUTE", "ACCOUNT CLOSED BY CONSUMER"]
//       inDispute: boolean,
//       isCollection: boolean,
//       inBankruptcy: boolean, derived: payment history includes bankruptcy code
//       amountPlacedForCollection,  collections-specific
//       datePlacedForCollection,
//       creditorAddress: { street, city, state, zip, phone },
//       bureauSources: ["TU","EX","EQ"],
//     }
//   ],
//
//   publicRecords: [
//     {
//       id, type: PUBLIC_RECORD_TYPES, docket, court, plaintiff, attorney,
//       responsibility, dateFiled, dateDischarged, dateClosed, datePaid,
//       assets, liabilities, originalBalance, currentBalance, bureauSources,
//     }
//   ],
//
//   collections: [...]        Same shape as `accounts` filtered to type=collection.
//                             Maintained separately for fast lookups; the writer
//                             keeps both in sync.
//
//   inquiries: [
//     { id, creditor, creditorCanonicalId, date, type: "hard"|"soft", bureau }
//   ],
//
//   alerts: [
//     { type: "ssn_mismatch"|"fraud_alert"|"identity_theft"|"address_mismatch"|"other",
//       message, bureau, severity: "high"|"medium"|"low" }
//   ],
//
//   summary: {
//     numAccounts, numCollections, numTradesPastDue,
//     totalBalances, totalPastDue, numPublicRecords, numBankruptcies,
//     numHardInquiriesLast2y,
//   },
// }
//
// ── Build/validate ─────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

function hashStable(...parts) {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 14);
}

function normalizeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  // Permissive fallback: "MM/DD/YYYY", "MM/YYYY", "Month YYYY"
  const t = Date.parse(d);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  // "MM/YYYY" → "YYYY-MM-01"
  const m = String(d).match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
  // "YYYY-MM" → "YYYY-MM-01"
  const m2 = String(d).match(/^(\d{4})-(\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-01`;
  return null;
}

function normPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function detectIsCollection(a) {
  if (a.type === "collection") return true;
  if (a.isCollection) return true;
  const s = String(a.status || "").toLowerCase();
  if (s.includes("collection") || s.includes("charged off") || s === "in_collection") return true;
  const remarks = (a.remarks || []).join(" ").toLowerCase();
  if (remarks.includes("placed for collection")) return true;
  return false;
}

function detectInBankruptcy(a) {
  if (a.inBankruptcy === true) return true;
  const remarks = (a.remarks || []).join(" ").toLowerCase();
  if (remarks.includes("bankruptcy")) return true;
  // Pay history may contain 'B' or similar bankruptcy markers in some formats
  if (/B/.test(a.paymentHistory || "")) return true;
  return false;
}

// Build an account row, filling defaults + computing derived flags.
export function buildAccount(input) {
  const creditor = (input.creditor || "").trim();
  const accountNumber = String(input.accountNumber || "").trim();
  const dateOpened = normalizeDate(input.dateOpened);
  const id = input.id || `acct_${hashStable(creditor, accountNumber, dateOpened)}`;

  const out = {
    id,
    creditor,
    creditorCanonicalId: input.creditorCanonicalId || null,
    originalCreditor: input.originalCreditor || null,
    originalCreditorCanonicalId: input.originalCreditorCanonicalId || null,
    accountNumber,
    type: ACCOUNT_TYPES.includes(input.type) ? input.type : "other",
    loanType: input.loanType || null,
    status: ACCOUNT_STATUSES.includes(input.status) ? input.status : "unknown",
    responsibility: RESPONSIBILITY.includes(input.responsibility) ? input.responsibility : "unknown",
    dateOpened,
    dateLastActivity: normalizeDate(input.dateLastActivity),
    dateLastReported: normalizeDate(input.dateLastReported),
    dateClosed: normalizeDate(input.dateClosed),
    datePaid: normalizeDate(input.datePaid),
    balance: numOr(input.balance, null),
    highCredit: numOr(input.highCredit, null),
    creditLimit: numOr(input.creditLimit, null),
    monthlyPayment: numOr(input.monthlyPayment, null),
    pastDue: numOr(input.pastDue, null),
    paymentHistory: input.paymentHistory || "",
    latePayments: {
      d30: numOr(input.latePayments?.d30 ?? input.latePayments?.["30"], 0),
      d60: numOr(input.latePayments?.d60 ?? input.latePayments?.["60"], 0),
      d90: numOr(input.latePayments?.d90 ?? input.latePayments?.["90"], 0),
    },
    remarks: Array.isArray(input.remarks) ? input.remarks : (input.remarks ? [input.remarks] : []),
    inDispute: false,
    isCollection: false,
    inBankruptcy: false,
    amountPlacedForCollection: numOr(input.amountPlacedForCollection, null),
    datePlacedForCollection: normalizeDate(input.datePlacedForCollection),
    creditorAddress: input.creditorAddress || null,
    bureauSources: Array.isArray(input.bureauSources)
      ? input.bureauSources.filter((b) => BUREAUS.includes(b))
      : [],
  };
  out.inDispute = /dispute/i.test(out.remarks.join(" "));
  out.isCollection = detectIsCollection(out);
  out.inBankruptcy = detectInBankruptcy(out);
  return out;
}

function numOr(v, fallback) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? fallback : n;
}

export function buildPublicRecord(input) {
  const id = input.id || `pr_${hashStable(input.type, input.docket, input.dateFiled)}`;
  return {
    id,
    type: PUBLIC_RECORD_TYPES.includes(input.type) ? input.type : "other",
    docket: input.docket || null,
    court: input.court || null,
    plaintiff: input.plaintiff || null,
    attorney: input.attorney || null,
    responsibility: RESPONSIBILITY.includes(input.responsibility) ? input.responsibility : "unknown",
    dateFiled: normalizeDate(input.dateFiled),
    dateDischarged: normalizeDate(input.dateDischarged),
    dateClosed: normalizeDate(input.dateClosed),
    datePaid: normalizeDate(input.datePaid),
    assets: numOr(input.assets, null),
    liabilities: numOr(input.liabilities, null),
    originalBalance: numOr(input.originalBalance, null),
    currentBalance: numOr(input.currentBalance, null),
    bureauSources: Array.isArray(input.bureauSources)
      ? input.bureauSources.filter((b) => BUREAUS.includes(b))
      : [],
  };
}

export function buildInquiry(input) {
  const id = input.id || `inq_${hashStable(input.creditor, normalizeDate(input.date))}`;
  return {
    id,
    creditor: input.creditor || "",
    creditorCanonicalId: input.creditorCanonicalId || null,
    date: normalizeDate(input.date),
    type: ["hard", "soft"].includes(input.type) ? input.type : "hard",
    bureau: BUREAUS.includes(input.bureau) ? input.bureau : null,
  };
}

export function buildAlert(input) {
  const validTypes = ["ssn_mismatch","fraud_alert","identity_theft","address_mismatch","high_risk","other"];
  return {
    type: validTypes.includes(input.type) ? input.type : "other",
    message: input.message || "",
    bureau: BUREAUS.includes(input.bureau) ? input.bureau : null,
    severity: ["high","medium","low"].includes(input.severity) ? input.severity : "medium",
  };
}

// Top-level builder. Computes summary stats. Throws on missing required fields.
export function buildCreditReport(input) {
  if (!input?.consumer?.firstName && !input?.consumer?.lastName) {
    throw new Error("creditReport: consumer.firstName or lastName required");
  }
  const accounts = (input.accounts || []).map(buildAccount);
  const publicRecords = (input.publicRecords || []).map(buildPublicRecord);
  const inquiries = (input.inquiries || []).map(buildInquiry);
  const alerts = (input.alerts || []).map(buildAlert);

  const consumer = input.consumer || {};
  const phoneNumbers = (consumer.phoneNumbers || []).map(normPhone).filter(Boolean);
  const addressHistory = (consumer.addressHistory || []).map((a) => ({
    street: a.street || "",
    city:   a.city   || "",
    state:  (a.state || "").toUpperCase().slice(0, 2),
    zip:    a.zip    || "",
    from:   normalizeDate(a.from),
    to:     normalizeDate(a.to),
    bureau: BUREAUS.includes(a.bureau) ? a.bureau : null,
  }));

  // Summary stats — used by the matcher + the report UI
  const collections = accounts.filter((a) => a.isCollection);
  const bankruptcies = publicRecords.filter((p) => /^bankruptcy_/.test(p.type));
  const summary = {
    numAccounts: accounts.length,
    numCollections: collections.length,
    numTradesPastDue: accounts.filter((a) => (a.pastDue || 0) > 0).length,
    totalBalances: accounts.reduce((s, a) => s + (a.balance || 0), 0),
    totalPastDue: accounts.reduce((s, a) => s + (a.pastDue || 0), 0),
    numPublicRecords: publicRecords.length,
    numBankruptcies: bankruptcies.length,
    numHardInquiriesLast2y: inquiries
      .filter((i) => i.type === "hard")
      .filter((i) => {
        if (!i.date) return false;
        const days = (Date.now() - Date.parse(i.date)) / (1000 * 60 * 60 * 24);
        return days >= 0 && days <= 730;
      })
      .length,
  };

  return {
    reportDate: normalizeDate(input.reportDate) || new Date().toISOString().slice(0, 10),
    reportNumber: input.reportNumber || null,
    bureau: input.bureau || "credit_com",
    sourceFormat: ["json","csv","pdf","manual"].includes(input.sourceFormat) ? input.sourceFormat : "json",
    sourceFilename: input.sourceFilename || null,
    consumer: {
      firstName:  consumer.firstName  || "",
      lastName:   consumer.lastName   || "",
      middleName: consumer.middleName || null,
      ssnLast4:   consumer.ssnLast4   || null,
      dob:        normalizeDate(consumer.dob),
      emails:     Array.isArray(consumer.emails) ? consumer.emails.filter(Boolean) : (consumer.email ? [consumer.email] : []),
      phoneNumbers,
      currentAddress: consumer.currentAddress || (addressHistory[0] || null),
      addressHistory,
      aliases: consumer.aliases || [],
      employmentHistory: consumer.employmentHistory || [],
    },
    accounts,
    publicRecords,
    collections,
    inquiries,
    alerts,
    summary,
    ingestedAt: new Date().toISOString(),
  };
}
