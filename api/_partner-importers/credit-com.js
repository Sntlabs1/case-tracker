// Credit.com partner importer — auto-dispatching entry.
//
// Two input shapes supported transparently:
//
//   1. Full credit-report JSON (canonical or per-bureau nested) — routes to
//      credit-com-json.js which produces the rich creditAccounts[] +
//      bankruptcies[] + civilJudgments[] + creditInquiries[] arrays.
//
//   2. Legacy flat shape with collections[] (or collectionsHistory[]) —
//      kept here for backward compat. Returns the simpler client shape.
//
// Auto-detect: if the input has `accounts`, `tradelines`, `publicRecords`,
// `consumer`, or a recognized per-bureau bucket (TransUnion / Experian /
// Equifax / TU / EX / EQ), we route through the rich importer.

import richImporter from "./credit-com-json.js";

function looksRich(c) {
  if (!c || typeof c !== "object") return false;
  if (Array.isArray(c.accounts) || Array.isArray(c.tradelines)) return true;
  if (c.consumer && typeof c.consumer === "object") return true;
  if (Array.isArray(c.publicRecords)) return true;
  const bureauKeys = ["TransUnion","Experian","Equifax","tu","ex","eq","TU","EX","EQ","transunion","experian","equifax"];
  return bureauKeys.some((k) => c[k] && typeof c[k] === "object");
}

function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export default function normalize(c) {
  // Rich credit-report payload → route to JSON importer
  if (looksRich(c)) {
    try {
      return richImporter(c);
    } catch {
      // fall through to flat
    }
  }
  return legacyFlatNormalize(c);
}

function legacyFlatNormalize(c) {
  const phones = []
    .concat(c.phone, c.phones, c.mobile, c.home_phone, c.cell)
    .filter(Boolean)
    .map(normalizePhone)
    .filter(Boolean);

  const collections = Array.isArray(c.collections || c.collectionsHistory)
    ? (c.collections || c.collectionsHistory).map((e) => ({
        creditor:             e.creditor || e.original_creditor || "",
        creditorCanonicalId:  e.creditorCanonicalId || null,
        debtBuyer:            e.debtBuyer || e.debt_buyer || e.collector || null,
        debtBuyerCanonicalId: e.debtBuyerCanonicalId || null,
        dateRange: {
          start: e.dateRange?.start || e.start_date || null,
          end:   e.dateRange?.end   || e.end_date   || null,
        },
        amount:         e.amount ?? null,
        status:         e.status || "active",
        contactMethods: e.contactMethods || e.contact_methods || [],
        contactDates:   e.contactDates   || e.contact_dates   || [],
        source: "credit.com",
      }))
    : [];

  const addresses = Array.isArray(c.addressHistory || c.addresses)
    ? (c.addressHistory || c.addresses).map((a) => ({
        state: (a.state || "").toUpperCase().slice(0, 2),
        city:  a.city  || "",
        zip:   a.zip   || a.postal_code || "",
        start: a.start || a.start_date  || null,
        end:   a.end   || a.end_date    || null,
      }))
    : [];

  return {
    ...c,
    phoneNumbers:       phones,
    phone:              c.phone || phones[0] || "",
    collectionsHistory: collections,
    addressHistory:     addresses,
    partnerId:          "credit_com",
    ingestSource:       "credit.com", // backward-compat
    contactRights: {
      creditor:  true,
      source:    "credit.com partnership",
      scopeNote: c.scopeNote || "Credit.com has consent to contact for partnership-relevant matters.",
    },
    tcpaOptOut: c.tcpaOptOut === true,
  };
}
