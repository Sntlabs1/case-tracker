// Map a canonical credit-report record onto the existing client schema +
// the new tradeline / public-record / inquiry arrays the matcher reads.
//
// The legacy client model has a single flat `collectionsHistory[]` — the only
// thing the matcher used to score against. Real credit reports are far richer:
// every tradeline (credit card, auto loan, mortgage, store card) is a
// potential TCPA defendant if that creditor autodialed marketing or debt-
// collection calls. So we now persist:
//
//   client.creditAccounts[]       — ALL tradelines (was missing)
//   client.collectionsHistory[]   — kept for backward compat (subset of above)
//   client.bankruptcies[]         — for automatic-stay / discharge claims
//   client.civilJudgments[]
//   client.creditInquiries[]      — for FCRA permissible-purpose claims
//   client.creditReportAlerts[]
//   client.creditReportSummary    — quick-glance stats for the UI
//   client.lastCreditReportAt     — when the latest report was ingested
//
// The matcher (src/lib/tcpaMatchRubric.js) will be updated separately to
// scan creditAccounts[] in addition to collectionsHistory[].

// Convert a tradeline account into a collectionsHistory-shaped entry.
// Kept compatible with the existing matcher so older code keeps working.
function accountToCollectionsEntry(a) {
  // Contact dates: approximate from latePayments + dateLastActivity.
  // Each late-payment marker corresponds to one collection contact, and the
  // last activity date is when we last know they were in contact.
  const contactDates = [];
  const totalLates = (a.latePayments?.d30 || 0) + (a.latePayments?.d60 || 0) + (a.latePayments?.d90 || 0);
  if (a.dateLastActivity) contactDates.push(a.dateLastActivity);
  // Synthesize prior contact dates from the payment history string.
  // C = current (no contact), 1/2/3/9 = late or collection (likely contact).
  if (a.paymentHistory && a.dateLastReported) {
    const lastReported = new Date(a.dateLastReported);
    const codes = a.paymentHistory.split("");
    codes.forEach((c, i) => {
      if (/[1-5]|9/.test(c)) {
        const d = new Date(lastReported);
        d.setMonth(d.getMonth() - i);
        contactDates.push(d.toISOString().slice(0, 10));
      }
    });
  }
  const dedupDates = [...new Set(contactDates)];

  const contactMethods = [];
  // Default assumption: phone (TCPA-relevant); collection accounts almost
  // always include call attempts. Real call-log data would override this.
  if (a.isCollection || (a.latePayments?.d30 || 0) > 0) contactMethods.push("call");
  if (a.remarks?.some((r) => /text|sms/i.test(r))) contactMethods.push("sms");

  return {
    creditor:             a.originalCreditor || a.creditor,
    creditorCanonicalId:  a.originalCreditorCanonicalId || a.creditorCanonicalId,
    debtBuyer:            a.isCollection ? a.creditor : null,
    debtBuyerCanonicalId: a.isCollection ? a.creditorCanonicalId : null,
    dateRange: {
      start: a.dateOpened || null,
      end:   a.dateClosed || a.dateLastActivity || a.dateLastReported || null,
    },
    amount: a.balance ?? a.highCredit ?? a.amountPlacedForCollection ?? null,
    status: a.isCollection ? "active" : (a.status || "active"),
    contactMethods,
    contactDates: dedupDates,
    accountId: a.id,
    accountType: a.type,
    inDispute: !!a.inDispute,
    inBankruptcy: !!a.inBankruptcy,
    source: "credit.com",
  };
}

// Public function: take a canonical credit report (from creditReportSchema)
// and a partial input client object; return a flat client-record shape that
// api/clients.js can persist directly.
export function creditReportToClient(report, baseClient = {}) {
  const c = report.consumer || {};
  const accounts = report.accounts || [];
  const publicRecords = report.publicRecords || [];
  const bankruptcies  = publicRecords.filter((p) => /^bankruptcy_/.test(p.type));
  const civilJudgments = publicRecords.filter((p) => p.type === "civil_judgment");
  const taxLiens      = publicRecords.filter((p) => /^tax_lien/.test(p.type));

  // Collections subset (for the legacy matcher path)
  const collectionsHistory = accounts
    .filter((a) => a.isCollection)
    .map(accountToCollectionsEntry);

  // Address history — the legacy matcher's residency-overlap signal reads
  // client.addressHistory[]; emit it from the credit report.
  const addressHistory = (c.addressHistory || []).map((a) => ({
    state: (a.state || "").toUpperCase().slice(0, 2),
    city:  a.city  || "",
    zip:   a.zip   || "",
    start: a.from  || null,
    end:   a.to    || null,
  }));

  // Currently the client record uses a single `state`; pick the most recent
  // one. Address history above carries the rest.
  const state = (c.currentAddress?.state ||
                 c.addressHistory?.[0]?.state ||
                 baseClient.state || "").toUpperCase().slice(0, 2);

  const out = {
    ...baseClient,

    // Identity — credit report wins when populated
    firstName: c.firstName || baseClient.firstName || "",
    lastName:  c.lastName  || baseClient.lastName  || "",
    email:     baseClient.email || c.emails?.[0]   || "",
    phone:     baseClient.phone || c.phoneNumbers?.[0] || "",
    phoneNumbers: [...new Set([
      ...(c.phoneNumbers || []),
      ...(baseClient.phoneNumbers || []),
    ])].filter(Boolean),
    state,
    city:    c.currentAddress?.city || baseClient.city || "",
    dob:     c.dob || baseClient.dob || null,
    ssnLast4: c.ssnLast4 || baseClient.ssnLast4 || null,
    creditScore: report.creditScore || baseClient.creditScore || null,
    addressHistory,
    employmentHistory: (c.employmentHistory || []).map(e => ({
      employer: e.employer || e.name || "",
      city:     e.city     || "",
      state:    (e.state   || "").toUpperCase().slice(0, 2),
      start:    e.start    || null,
      end:      e.end      || null,
    })).filter(e => e.employer),

    // Source tagging
    partnerId: baseClient.partnerId || "credit_com",
    ingestSource: "credit.com",
    contactRights: baseClient.contactRights || {
      creditor: true,
      source: "credit.com partnership",
      scopeNote: "Credit.com has consent to contact for partnership-relevant matters.",
    },

    // ── Legacy field for backward-compat matcher path ──────────────────────
    collectionsHistory,

    // ── Full credit-report data — the new matcher scans these ─────────────
    creditAccounts: accounts,
    bankruptcies,
    civilJudgments,
    taxLiens,
    creditInquiries: report.inquiries || [],
    creditReportAlerts: report.alerts || [],
    creditReportSummary: report.summary || null,
    lastCreditReportAt: report.ingestedAt || new Date().toISOString(),
    lastCreditReportNumber: report.reportNumber || null,
    lastCreditReportBureau: report.bureau || null,
  };

  return out;
}

// Unique defendant signatures present on a client's credit accounts.
// Returns a Set of normalized defendant names — used by the matcher's
// candidate-set path so a Capital One credit card on the report triggers
// matches against every Capital One case, not just collections.
export function defendantSignaturesFromClient(client) {
  const set = new Set();
  for (const a of (client.creditAccounts || [])) {
    if (a.creditorCanonicalId) set.add(a.creditorCanonicalId);
    if (a.originalCreditorCanonicalId) set.add(a.originalCreditorCanonicalId);
    if (a.creditor) set.add(`name:${a.creditor.toLowerCase().trim()}`);
    if (a.originalCreditor) set.add(`name:${a.originalCreditor.toLowerCase().trim()}`);
  }
  // Also include legacy collectionsHistory entries (some clients are still
  // shaped that way)
  for (const e of (client.collectionsHistory || [])) {
    if (e.creditorCanonicalId) set.add(e.creditorCanonicalId);
    if (e.debtBuyerCanonicalId) set.add(e.debtBuyerCanonicalId);
    if (e.creditor) set.add(`name:${e.creditor.toLowerCase().trim()}`);
    if (e.debtBuyer) set.add(`name:${e.debtBuyer.toLowerCase().trim()}`);
  }
  return set;
}
