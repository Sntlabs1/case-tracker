// Canonical defendant normalization — SINGLE SOURCE OF TRUTH.
//
// Replaces the three divergent defendantQuery()/normDef() implementations that
// previously lived in build-case-index.js, portfolio-cases.js,
// tcpa-marketers-build.mjs and match_derive.mjs. Those disagreed, so the
// per-defendant join silently failed (e.g. "Capital One" matched 142 people in
// a 5.7M-record DB because the catalog token "capital one bank usa n a" never
// equalled the tradeline spelling "CAPITAL ONE").
//
// canonicalToken(rawName) -> a stable lowercase token used BOTH as the
//   casepeople:<token> KV key suffix AND to match catalog defendant names
//   against the tradeline-derived cases[].defendant strings. Both sides MUST
//   call this same function so the tokens line up.
//
// The Python derivation (tools/defendant_token.py) mirrors this list verbatim —
// keep them in sync when adding aliases.

// Alias families: if a raw string (uppercased) CONTAINS the needle, it collapses
// to the canonical token. Order matters — longer / more specific needles first.
const ALIASES = [
  // ── Debt buyers / collectors (FDCPA) ──────────────────────────────────────
  ["MIDLAND FUNDING", "midland funding"],
  ["MIDLAND CREDIT", "midland credit management"],
  ["MCM", "midland credit management"],
  // bare "MIDLAND" intentionally omitted — collides with Midland States Bank /
  // Midland Mortgage / Midland National (unrelated legitimate entities)
  ["PORTFOLIO RECOV", "portfolio recovery associates"],
  ["LVNV", "lvnv funding"],
  ["RESURGENT", "resurgent capital"],
  ["ENCORE CAPITAL", "encore capital"],
  ["CAVALRY", "cavalry portfolio services"],
  ["ENHANCED RECOVERY", "enhanced recovery company"],
  ["ERC ", "enhanced recovery company"],
  ["TRANSWORLD", "transworld systems"],
  ["I.C. SYSTEM", "ic system"],
  ["IC SYSTEM", "ic system"],
  ["CONVERGENT", "convergent outsourcing"],
  ["JEFFERSON CAPITAL", "jefferson capital systems"],
  ["DIVERSIFIED CONSULT", "diversified consultants"],
  ["CREDIT COLLECTION SERV", "credit collection services"],
  ["NATIONAL CREDIT ADJUST", "national credit adjusters"],
  ["COMMONWEALTH FINANCIAL", "commonwealth financial systems"],
  ["WAKEFIELD", "wakefield associates"],
  ["MEDICAL DATA SYS", "medical data systems"],
  ["CAINE", "caine weiner"],
  ["AD ASTRA", "ad astra recovery services"],
  ["AMERICOLLECT", "americollect"],
  ["ACCOUNT RESOLUTION", "account resolution services"],
  ["UNITED REVENUE", "united revenue corp"],
  ["CONVERGYS", "convergent outsourcing"],
  ["RADIUS GLOBAL", "radius global solutions"],
  ["CBE GROUP", "cbe group"],
  ["AMSHER", "amsher collection"],
  ["NCO FINANCIAL", "nco financial"],
  ["HUNTER WARFIELD", "hunter warfield"],
  ["SHERMAN", "sherman financial"],
  ["CACH", "cach llc"],
  ["CCO ", "cco mortgage"],            // narrowed: only standalone "CCO " token, never inside "ACCOUNT"

  // ── Subprime auto lenders ─────────────────────────────────────────────────
  ["CREDIT ACCEPTANCE", "credit acceptance"],
  ["SANTANDER", "santander consumer usa"],
  ["WESTLAKE", "westlake financial"],
  ["EXETER", "exeter finance"],
  ["DRIVETIME", "drivetime"],
  ["CONSUMER PORTFOLIO SERV", "consumer portfolio services"],
  ["AMERICAN CREDIT ACCEPT", "american credit acceptance"],
  ["BYRIDER", "jd byrider"],
  ["TOYOTA", "toyota motor credit"],
  ["NISSAN", "nissan motor acceptance"],
  ["INFINITI FIN", "nissan motor acceptance"],
  ["AMERICAN HONDA", "american honda finance"],
  ["HONDA FIN", "american honda finance"],
  ["GM FINANCIAL", "gm financial"],
  ["AMERICREDIT", "gm financial"],
  ["CHRYSLER CAPITAL", "chrysler capital"],
  ["FORD MOTOR CREDIT", "ford motor credit"],
  ["FORD CRED", "ford motor credit"],
  ["FORD MTR", "ford motor credit"],
  ["FORDCREDIT", "ford motor credit"],
  ["HYUNDAI", "hyundai capital"],
  ["KIA MOTOR", "kia finance"],
  ["KIA FIN", "kia finance"],
  ["KIA AMERICA", "kia finance"],
  ["MERCEDES", "mercedes benz financial"],
  ["ALLY", "ally financial"],

  // ── Installment / payday / subprime cards (UDAP) ──────────────────────────
  ["ONEMAIN", "onemain financial"],
  ["ONE MAIN", "onemain financial"],
  ["MARINER", "mariner finance"],
  ["LENDMARK", "lendmark financial"],
  ["WORLD FINANCE", "world acceptance"],
  ["WORLD ACCEPTANCE", "world acceptance"],
  ["REGIONAL MANAGE", "regional management"],
  ["REPUBLIC FINANCE", "republic finance"],
  ["HEIGHTS FINANCE", "heights finance"],
  ["SPRINGLEAF", "onemain financial"],
  ["TITLEMAX", "titlemax"],
  ["LOANMAX", "titlemax"],
  ["ADVANCE AMERICA", "advance america"],
  ["SPEEDY CASH", "speedy cash"],
  ["ACE CASH", "ace cash express"],
  ["CHECK INTO CASH", "check into cash"],
  ["FIRST CASH", "first cash"],

  // ── Bank / card furnishers (join to TCPA/FCRA catalog) ────────────────────
  ["CAPITAL ONE", "capital one"],
  ["CAP ONE", "capital one"],
  ["COAF", "capital one"],             // Capital One Auto Finance
  ["KOHLS", "capital one"],            // Kohl's card issued by Capital One
  ["SYNCHRONY", "synchrony"],
  ["SYNCB", "synchrony"],
  ["COMENITY", "comenity"],
  ["CREDIT ONE", "credit one bank"],
  ["FIRST PREMIER", "first premier bank"],
  ["MERRICK", "merrick bank"],
  ["MISSION LANE", "mission lane"],
  ["MILESTONE", "milestone genesis"],
  ["GENESIS FS", "milestone genesis"],
  ["GENESIS FINANCIAL", "milestone genesis"],
  ["CONCORA", "milestone genesis"],
  ["FORTIVA", "fortiva"],
  ["BANK OF THE WEST", "bmo bank"],
  ["BMO", "bmo bank"],
  ["SARASOTA MEM", "sarasota memorial"],
  ["DISCOVER", "discover"],
  ["SYNOVUS", "synovus"],
  ["CITIBANK", "citibank"],
  ["CITI ", "citibank"],
  ["WELLS FARGO", "wells fargo"],
  ["BANK OF AMERICA", "bank of america"],
  ["JPMORGAN", "chase"],
  ["JP MORGAN", "chase"],
  ["CHASE", "chase"],
  ["AMERICAN EXPRESS", "american express"],
  ["AMEX", "american express"],

  // ── Student loan servicers ────────────────────────────────────────────────
  ["NAVIENT", "navient"],
  ["SALLIE MAE", "sallie mae"],
  ["GREAT LAKES", "great lakes"],
  ["FEDLOAN", "fedloan"],
  ["MOHELA", "mohela"],
  ["NELNET", "nelnet"],
  ["AIDVANTAGE", "aidvantage"],
  ["EDFINANCIAL", "edfinancial"],
  ["PHEAA", "pheaa"],

  // ── Mortgage servicers (RESPA) ────────────────────────────────────────────
  ["OCWEN", "ocwen"],
  ["PHH MORTGAGE", "phh mortgage"],
  ["NATIONSTAR", "mr cooper"],
  ["MR. COOPER", "mr cooper"],
  ["MR COOPER", "mr cooper"],
  ["DITECH", "ditech"],
  ["GREEN TREE", "ditech"],
  ["GREENTREE", "ditech"],
  ["CALIBER HOME", "caliber home loans"],
  ["SHELLPOINT", "shellpoint"],
  ["NEWREZ", "newrez"],
  ["SPECIALIZED LOAN", "specialized loan servicing"],
  ["CENLAR", "cenlar"],
  ["SELECT PORTFOLIO", "select portfolio servicing"],
  ["RUSHMORE", "rushmore"],
  ["ROUNDPOINT", "roundpoint"],
];

// Strip only true corporate suffixes/punctuation for the fallback token. Do NOT
// strip industry words (BANK, FINANCIAL, FUNDING) here — that would over-merge
// distinct entities; the ALIASES table above handles known families explicitly.
function normDef(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[.,'"]/g, " ")
    .replace(/&/g, " ")
    .replace(/\b(INC|LLC|CORP|CORPORATION|CO|LTD|LP|LLP|PLLC|PC|N\s*A|SVC|SVCS)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The canonical token: alias families first (handles quirky spellings of the
// big furnishers), then a mild suffix-stripped fallback for the long tail.
export function canonicalToken(name) {
  if (!name) return "";
  const up = String(name).toUpperCase();
  for (const [needle, token] of ALIASES) {
    if (up.includes(needle)) return token;
  }
  return normDef(name).toLowerCase();
}

// Convenience: does a raw defendant string resolve to the given catalog token?
export function matchesToken(rawDefendant, token) {
  return canonicalToken(rawDefendant) === token;
}

export { ALIASES, normDef };
