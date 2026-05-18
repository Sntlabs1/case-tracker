// Credit.com JSON importer — accepts a full credit-report payload in the
// canonical shape (or any of the looser/legacy variants below) and returns a
// client record ready for api/clients.js to persist.
//
// Input variants this importer recognizes:
//
//   1. CANONICAL: { reportDate, consumer:{...}, accounts:[...], publicRecords:[...], inquiries:[...] }
//      → fast path, just validates and converts
//
//   2. CREDIT.COM API-LIKE: nested per-bureau (TransUnion, Experian, Equifax)
//      → flattens by deduping accounts across bureaus by (creditor + accountNumber + dateOpened)
//
//   3. LEGACY FLAT: { firstName, lastName, phone, email, state, collections:[...] }
//      → wraps as a minimal credit report so the same downstream path works
//
// Dispatch is automatic based on shape detection. Failure falls back to the
// legacy flat shape so older credit-com payloads keep ingesting.

import { buildCreditReport } from "../../src/lib/creditReportSchema.js";
import { creditReportToClient } from "../../src/lib/creditReportToClient.js";

// ── Shape detection ────────────────────────────────────────────────────────

function looksLikeCanonical(c) {
  return c && typeof c === "object"
    && (c.consumer || c.accounts || c.publicRecords);
}

function looksLikePerBureauNested(c) {
  if (!c || typeof c !== "object") return false;
  const hasTu = c.transunion || c.tu || c.TU || c.TransUnion;
  const hasEx = c.experian   || c.ex || c.EX || c.Experian;
  const hasEq = c.equifax    || c.eq || c.EQ || c.Equifax;
  return !!(hasTu || hasEx || hasEq);
}

// ── Per-bureau aggregator: takes a payload with one or more bureau buckets
// and unifies into the canonical shape.
//
// Bureau bucket expected fields (loose):
//   { personal: {...}, tradelines: [...], publicRecords: [...], inquiries: [...] }

function dedupAccounts(accountLists) {
  const seen = new Map(); // key → merged account
  for (const list of accountLists) {
    for (const a of (list || [])) {
      const key = `${(a.creditor || "").toLowerCase().trim()}|${a.accountNumber || ""}|${a.dateOpened || ""}`;
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { ...a, bureauSources: [...(a.bureauSources || [])] });
      } else {
        // Merge: most-recent wins per field, bureauSources union
        seen.set(key, {
          ...prev,
          ...Object.fromEntries(Object.entries(a).filter(([_, v]) => v !== null && v !== undefined && v !== "")),
          bureauSources: [...new Set([...(prev.bureauSources || []), ...(a.bureauSources || [])])],
        });
      }
    }
  }
  return [...seen.values()];
}

function buildFromPerBureau(input) {
  const buckets = ["TransUnion","Experian","Equifax","tu","ex","eq","TU","EX","EQ","transunion","experian","equifax"];
  const collected = { personal: null, tradelines: [], publicRecords: [], inquiries: [], alerts: [] };
  for (const k of buckets) {
    const b = input[k];
    if (!b) continue;
    if (!collected.personal && b.personal) collected.personal = b.personal;
    if (Array.isArray(b.tradelines))  collected.tradelines.push(b.tradelines);
    if (Array.isArray(b.accounts))    collected.tradelines.push(b.accounts);
    if (Array.isArray(b.publicRecords)) collected.publicRecords.push(...b.publicRecords);
    if (Array.isArray(b.inquiries))     collected.inquiries.push(...b.inquiries);
    if (Array.isArray(b.alerts))        collected.alerts.push(...b.alerts);
  }
  const p = collected.personal || {};
  return {
    reportDate: input.reportDate,
    reportNumber: input.reportNumber,
    bureau: "joint",
    sourceFormat: "json",
    consumer: {
      firstName:  p.firstName || p.first_name || (p.name || "").split(/\s+/)[0],
      lastName:   p.lastName  || p.last_name  || (p.name || "").split(/\s+/).slice(-1)[0],
      ssnLast4:   p.ssnLast4  || p.ssn_last4  || (p.ssn || "").slice(-4),
      dob:        p.dob || p.dateOfBirth,
      emails:     p.emails || (p.email ? [p.email] : []),
      phoneNumbers: p.phoneNumbers || (p.phone ? [p.phone] : []),
      currentAddress: p.currentAddress || p.address,
      addressHistory: p.addressHistory || [],
      aliases: p.aliases || [],
      employmentHistory: p.employmentHistory || p.employment || [],
    },
    accounts: dedupAccounts(collected.tradelines),
    publicRecords: collected.publicRecords,
    inquiries: collected.inquiries,
    alerts: collected.alerts,
  };
}

// ── Legacy flat shape (current credit-com importer compatibility) ─────────

function buildFromLegacyFlat(c) {
  const collectionsAsAccounts = (c.collections || c.collectionsHistory || []).map((e) => ({
    creditor:             e.creditor || e.original_creditor || "",
    originalCreditor:     e.debtBuyer || e.collector || null,
    accountNumber:        "",
    type:                 "collection",
    loanType:             null,
    status:               "in_collection",
    responsibility:       "individual",
    dateOpened:           e.dateRange?.start || e.start_date || null,
    dateLastActivity:     e.dateRange?.end   || e.end_date   || null,
    balance:              e.amount,
    remarks:              ["Placed for collection"],
    amountPlacedForCollection: e.amount,
    datePlacedForCollection:   e.dateRange?.start,
    paymentHistory:       e.contactDates?.length
      ? "9".repeat(Math.min(12, e.contactDates.length))
      : "",
  }));
  return {
    reportDate: c.reportDate || new Date().toISOString().slice(0, 10),
    bureau: "credit_com",
    sourceFormat: "json",
    consumer: {
      firstName:  c.firstName  || c.first_name  || "",
      lastName:   c.lastName   || c.last_name   || "",
      ssnLast4:   (c.ssn || "").slice(-4) || null,
      dob:        c.dob || c.date_of_birth,
      emails:     c.email ? [c.email] : [],
      phoneNumbers: c.phones || c.phoneNumbers || (c.phone ? [c.phone] : []),
      currentAddress: c.address || null,
      addressHistory: c.addressHistory || [],
    },
    accounts: collectionsAsAccounts,
    publicRecords: [],
    inquiries: [],
    alerts: [],
  };
}

// ── Main entry ────────────────────────────────────────────────────────────

export default function normalize(c) {
  let canonical;
  try {
    if (looksLikePerBureauNested(c)) {
      canonical = buildFromPerBureau(c);
    } else if (looksLikeCanonical(c)) {
      canonical = c;
    } else {
      canonical = buildFromLegacyFlat(c);
    }
    const report = buildCreditReport(canonical);
    // Convert into the client-shape api/clients.js stores.
    const client = creditReportToClient(report, {
      partnerId: "credit_com",
      ingestSource: "credit.com",
      sourceFirm: c.sourceFirm || "Credit.com",
    });
    return client;
  } catch (e) {
    // Fall back to legacy flat shape so older payloads still ingest even if
    // the rich schema fails validation.
    try {
      const canonical = buildFromLegacyFlat(c);
      const report = buildCreditReport(canonical);
      return creditReportToClient(report, {
        partnerId: "credit_com",
        ingestSource: "credit.com",
      });
    } catch {
      // Last resort: return the raw input + a tag so api/clients.js can at least
      // run validation. Defendant resolution will skip.
      return {
        ...c,
        partnerId: "credit_com",
        ingestSource: "credit.com",
        ingestError: e.message,
      };
    }
  }
}
