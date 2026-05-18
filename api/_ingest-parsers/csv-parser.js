// Credit report CSV parser.
//
// Handles three CSV shapes:
//
//   1. SIMPLE CLIENT ROSTER — one row per consumer with basic fields.
//      Columns: firstName, lastName, phone, email, state, dob, etc.
//      This is the existing ImportWizard path; this module is a superset.
//
//   2. TRADELINE EXPORT — one row per account, multiple rows per consumer.
//      Consumer is identified by SSN-last-4, phone, or (firstName+lastName).
//      Columns include creditor, accountNumber, balance, dateOpened, etc.
//      The parser groups rows by consumer key and assembles a credit report.
//
//   3. CREDIT.COM BULK EXPORT — credit.com-specific column names for their
//      collections/debt-buyer data feed. Auto-detected by header presence.
//
// Returns an array of canonical credit-report objects (buildCreditReport input).
// Each object represents one consumer.

// ── CSV tokeniser ───────────────────────────────────────────────────────────

function tokenise(line) {
  const result = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if ((c === "," || c === "\t" || c === ";") && !inQuote) {
      result.push(cur.trim()); cur = "";
    } else cur += c;
  }
  result.push(cur.trim());
  return result;
}

export function parseCSVRaw(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = tokenise(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""));
  const rows = lines.slice(1).map(l => {
    const vals = tokenise(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

// ── Format detection ────────────────────────────────────────────────────────

function detectCsvFormat(headers) {
  const h = new Set(headers);
  // Tradeline export: has creditor + account number or balance per row
  const tradelineCols = ["creditor","account_number","balance","date_opened","payment_history","loan_type"];
  const tradelineHits = tradelineCols.filter(c => h.has(c)).length;
  if (tradelineHits >= 3) return "tradeline_export";

  // credit.com bulk feed
  if (h.has("original_creditor") && (h.has("debt_buyer") || h.has("collector") || h.has("collection_agency"))) return "credit_com_collections";
  if (h.has("creditorname") || h.has("originalcreditor") || h.has("collectionagency")) return "credit_com_collections";

  return "simple_roster";
}

// ── Phone normaliser ────────────────────────────────────────────────────────

function normPhone(raw) {
  if (!raw) return "";
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

function normDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[2]}-${m1[1].padStart(2, "0")}-01`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  return null;
}

function numOr(v, fb = null) {
  if (v === null || v === undefined || v === "") return fb;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? fb : n;
}

// ── Simple roster parser ────────────────────────────────────────────────────
// One consumer per row. Produces minimal credit report objects (no tradelines).

const ROSTER_COL_MAP = {
  firstName:  ["firstname","first_name","fname","first"],
  lastName:   ["lastname","last_name","lname","last"],
  email:      ["email","email_address","emailaddress"],
  phone:      ["phone","phone_number","phonenumber","mobile","cell","telephone"],
  state:      ["state","st","province"],
  city:       ["city"],
  zip:        ["zip","zipcode","zip_code","postal","postal_code"],
  dob:        ["dob","date_of_birth","dateofbirth","birthdate","birth_date"],
  ssnLast4:   ["ssn_last4","ssn4","last4ssn","socialsecuritylast4"],
  creditor:   ["creditor","creditorname","creditor_name"],
  debtBuyer:  ["debt_buyer","debtbuyer","collector","collection_agency"],
};

function rosterToReport(row, headers) {
  const get = (candidates) => {
    for (const c of candidates) {
      if (row[c] !== undefined && row[c] !== "") return row[c];
    }
    return "";
  };

  const phone = normPhone(get(ROSTER_COL_MAP.phone));
  const phones = phone ? [phone] : [];

  // Build a minimal account from creditor fields if present
  const accounts = [];
  const creditor = get(ROSTER_COL_MAP.creditor);
  const debtBuyer = get(ROSTER_COL_MAP.debtBuyer);
  if (creditor || debtBuyer) {
    accounts.push({
      creditor: debtBuyer || creditor,
      originalCreditor: debtBuyer ? creditor : null,
      accountNumber: row.account_number || row.accountnumber || "",
      type: "collection",
      loanType: null,
      status: "in_collection",
      responsibility: "individual",
      dateOpened: normDate(row.date_opened || row.dateopened || row.start_date || null),
      dateLastActivity: normDate(row.date_last_activity || row.datelastactivity || row.end_date || null),
      balance: numOr(row.balance || row.amount),
      amountPlacedForCollection: numOr(row.original_amount || row.originalamount || row.amount),
      datePlacedForCollection: normDate(row.date_placed || row.dateplaced || row.date_opened || null),
      remarks: ["Placed for collection"],
      isCollection: true,
      paymentHistory: "",
      latePayments: { d30: 0, d60: 0, d90: 0 },
      bureauSources: [],
    });
  }

  const firstName = get(ROSTER_COL_MAP.firstName);
  const lastName  = get(ROSTER_COL_MAP.lastName);
  if (!firstName && !lastName) return null;

  return {
    reportDate: new Date().toISOString().slice(0, 10),
    bureau: "credit_com",
    sourceFormat: "csv",
    consumer: {
      firstName,
      lastName,
      middleName: null,
      ssnLast4: get(ROSTER_COL_MAP.ssnLast4) || null,
      dob: normDate(get(ROSTER_COL_MAP.dob)),
      emails: row.email ? [row.email] : (row.email_address ? [row.email_address] : []),
      phoneNumbers: phones,
      currentAddress: {
        street: row.address || row.street || "",
        city:   get(ROSTER_COL_MAP.city),
        state:  (get(ROSTER_COL_MAP.state) || "").toUpperCase().slice(0, 2),
        zip:    get(ROSTER_COL_MAP.zip),
      },
      addressHistory: [],
      aliases: [],
      employmentHistory: [],
    },
    accounts,
    publicRecords: [],
    inquiries: [],
    alerts: [],
  };
}

// ── Tradeline export parser ─────────────────────────────────────────────────
// Groups rows by consumer, assembles a full credit report per consumer.

function consumerKey(row) {
  const ssn  = (row.ssn_last4 || row.ssn4 || row.last4ssn || "").slice(-4).replace(/\D/g, "");
  const phone = normPhone(row.phone || row.mobile || "");
  const name  = `${(row.firstname || row.first_name || row.fname || "").toLowerCase()}|${(row.lastname || row.last_name || row.lname || "").toLowerCase()}`;
  // Prefer SSN or phone as keys; name is weak but acceptable as fallback.
  return ssn || phone || name;
}

function rowToAccount(row) {
  const paymentHistoryRaw = row.payment_history || row.paymenthistory || row.pay_history || "";
  // TU-style: remap 1→C, 2→1, 3→2, 4→3, 5→4, X→X
  const paymentHistory = paymentHistoryRaw.replace(/./g, (c) => {
    const m = { "1": "C", "2": "1", "3": "2", "4": "3", "5": "4", "X": "X", "C": "C", "9": "9", "8": "8", "-": "-" };
    return m[c.toUpperCase()] || c;
  });
  const lates = [...(paymentHistory || "")];
  const latePayments = {
    d30: lates.filter(c => c === "1").length,
    d60: lates.filter(c => c === "2").length,
    d90: lates.filter(c => c === "3").length,
  };

  const creditor   = row.creditor || row.creditorname || row.creditor_name || "";
  const origCred   = row.original_creditor || row.originalcreditor || row.debt_buyer || row.collector || null;
  const accountNum = row.account_number || row.accountnumber || row.acct_number || "";
  const type = detectAccountType(row);
  const status = detectAccountStatus(row);

  return {
    creditor: creditor || origCred || "",
    originalCreditor: (creditor && origCred && creditor !== origCred) ? origCred : null,
    accountNumber: accountNum,
    type,
    loanType: row.loan_type || row.loantype || row.account_type_detail || null,
    status,
    responsibility: normResponsibility(row.responsibility || row.liability || ""),
    dateOpened:           normDate(row.date_opened || row.dateopened),
    dateLastActivity:     normDate(row.date_last_activity || row.datelastactivity || row.last_activity),
    dateLastReported:     normDate(row.date_last_reported || row.datelastbureaudate || row.last_reported),
    dateClosed:           normDate(row.date_closed || row.dateclosed),
    balance:              numOr(row.balance || row.current_balance),
    highCredit:           numOr(row.high_credit || row.highcredit || row.high_balance),
    creditLimit:          numOr(row.credit_limit || row.creditlimit || row.cr_limit),
    monthlyPayment:       numOr(row.monthly_payment || row.monthlypayment || row.pmt),
    pastDue:              numOr(row.past_due || row.pastdue),
    paymentHistory,
    latePayments,
    remarks: parseRemarks(row.remarks || row.comment || row.remark || ""),
    isCollection: type === "collection" || status === "in_collection" || status === "closed_charged_off",
    amountPlacedForCollection: numOr(row.original_amount || row.originalamount || row.orig_amount),
    datePlacedForCollection:   normDate(row.date_placed || row.dateplaced),
    bureauSources: parseBureauSources(row.bureau || row.source || row.bureausources || ""),
  };
}

function detectAccountType(row) {
  const raw = (row.account_type || row.accounttype || row.type || row.loan_type || row.loantype || "").toLowerCase();
  if (/collect/.test(raw)) return "collection";
  if (/revolv|credit card|charge card/.test(raw)) return "revolving";
  if (/install|auto|car|student|personal|secure/.test(raw)) return "installment";
  if (/mortgage|home|heloc/.test(raw)) return "mortgage";
  if (/open|utility|charge/.test(raw)) return "open";
  const status = (row.status || "").toLowerCase();
  if (/collect|charge.off/.test(status)) return "collection";
  return "other";
}

function detectAccountStatus(row) {
  const raw = (row.status || row.pay_status || row.paystatus || "").toLowerCase();
  if (/collection/.test(raw)) return "in_collection";
  if (/charge.?off/.test(raw)) return "closed_charged_off";
  if (/closed.*(paid|good|agreed)/.test(raw) || raw === "closed_paid") return "closed_paid";
  if (/closed/.test(raw)) return "closed_paid";
  if (/dispute/.test(raw)) return "in_dispute";
  if (/bankrupt/.test(raw)) return "bankruptcy";
  if (/past.?due|late/.test(raw)) return "open_past_due";
  if (/current|agreed|open/.test(raw)) return "open_current";
  return "unknown";
}

function normResponsibility(raw) {
  const r = (raw || "").toLowerCase();
  if (/joint/.test(r)) return "joint";
  if (/co.?sign/.test(r)) return "co_signer";
  if (/authorized|user/.test(r)) return "authorized_user";
  if (/co.?applic/.test(r)) return "co_applicant";
  if (/individual|maker/.test(r)) return "individual";
  return "unknown";
}

function parseRemarks(raw) {
  if (!raw) return [];
  return raw.split(/[|;,]/).map(r => r.trim()).filter(Boolean);
}

function parseBureauSources(raw) {
  if (!raw) return [];
  const valid = new Set(["TU","EX","EQ","LN"]);
  const found = [];
  const s = String(raw).toUpperCase();
  for (const b of valid) {
    if (s.includes(b)) found.push(b);
  }
  return found;
}

function buildConsumerFromRows(rows) {
  const r0 = rows[0];
  const phone = normPhone(r0.phone || r0.mobile || r0.telephone || "");
  return {
    firstName:      r0.firstname || r0.first_name || r0.fname || "",
    lastName:       r0.lastname  || r0.last_name  || r0.lname || "",
    middleName:     r0.middlename || r0.middle_name || null,
    ssnLast4:       (r0.ssn_last4 || r0.ssn4 || "").replace(/\D/g, "").slice(-4) || null,
    dob:            normDate(r0.dob || r0.date_of_birth || r0.birthdate),
    emails:         r0.email ? [r0.email] : [],
    phoneNumbers:   phone ? [phone] : [],
    currentAddress: {
      street: r0.address || r0.street || "",
      city:   r0.city || "",
      state:  (r0.state || r0.st || "").toUpperCase().slice(0, 2),
      zip:    r0.zip || r0.zipcode || "",
    },
    addressHistory: [],
    aliases: [],
    employmentHistory: [],
  };
}

// ── Top-level parser ────────────────────────────────────────────────────────

export function parseCreditReportCsv(text) {
  const { headers, rows } = parseCSVRaw(text);
  if (!rows.length) return [];

  const format = detectCsvFormat(headers);

  if (format === "simple_roster" || format === "credit_com_collections") {
    return rows.map(row => rosterToReport(row, headers)).filter(Boolean);
  }

  // Tradeline export: group rows by consumer
  const groups = new Map();
  for (const row of rows) {
    const key = consumerKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const reports = [];
  for (const [, consumerRows] of groups) {
    const consumer = buildConsumerFromRows(consumerRows);
    if (!consumer.firstName && !consumer.lastName && !consumer.phoneNumbers.length) continue;
    const accounts = consumerRows.map(rowToAccount).filter(a => a.creditor);
    reports.push({
      reportDate: new Date().toISOString().slice(0, 10),
      bureau: "credit_com",
      sourceFormat: "csv",
      consumer,
      accounts,
      publicRecords: [],
      inquiries: [],
      alerts: [],
    });
  }
  return reports;
}
