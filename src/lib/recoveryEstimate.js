// Recovery-amount estimator — per (client, case) match.
//
// Returns { floor, ceiling, method, perViolation, violations, note } in USD.
// Pure function, no IO. Used by:
//   - reportBuilder.js   per-client report (matched case rows + summary stats)
//   - portfolio-report   aggregate $ across all clients for a partner
//
// Model: layered, in priority order:
//
//   1. SETTLED case with parseable settlement.perClaimantRange
//      → use the parsed midpoint as both floor and ceiling.
//      method = "settled_per_claimant"
//
//   2. TCPA / FDCPA / FCRA cases without settlement data
//      → statutory damages:
//        - TCPA  47 U.S.C. § 227(b)(3): $500 floor, $1500 willful ceiling
//        - FDCPA 15 U.S.C. § 1692k(a)(2)(A): up to $1000 actual + statutory
//          (we use $500/$1000 for floor/ceiling — actual depends on harm)
//        - FCRA  15 U.S.C. § 1681n(a)(1)(A): $100–$1000 per willful violation
//      method = "statutory_floor"
//
// Violations: best estimate from the client's collectionsHistory.
//   - Default: 1 violation per matched case (the conservative lower bound).
//   - If collectionsHistory entry naming the defendant has contactDates[]
//     populated, use that count (capped at 50 to bound the ceiling claim).
//   - If contactMethods[] includes both "call" and "sms", count each method.
//
// We never multiply by huge violation counts without supporting data — a
// $500K claim against one creditor on no evidence is not defensible. The
// CAPS below are deliberate; tune them as real call-log data becomes
// available from credit.com.

const PER_VIOLATION = {
  TCPA:        { floor: 500, ceiling: 1500 },   // 47 USC § 227(b)(3)
  FDCPA:       { floor: 500, ceiling: 1000 },   // 15 USC § 1692k
  FCRA:        { floor: 100, ceiling: 1000 },   // 15 USC § 1681n
  "TCPA+FDCPA":{ floor: 1000, ceiling: 2500 },  // combined claims (conservative)
};

const MAX_VIOLATIONS_PER_MATCH = 50;   // hard ceiling absent direct call-log evidence
const SOFT_CAP_PER_MATCH       = 500000; // sanity ceiling on a single match's ceiling

// Settlement amounts are stored as free-text strings ("$500-$1,500",
// "$1.5M / 250000 claimants", "~$420 per claimant"). Pull the FIRST 1-2
// dollar numbers and return midpoint when a range is detected.
//
// Returns { value, isRange, low, high } or null if no numbers found.
export function parseDollarRange(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Look for patterns like $500, $1,500, $1.5K, $1.5M, $2 billion
  const tokens = [...raw.matchAll(/\$?\s*([\d.,]+)\s*([kmb])?(?:illion|illion|hundred|thousand)?/gi)];
  const numbers = [];
  for (const t of tokens) {
    const n = parseFloat(t[1].replace(/,/g, ""));
    if (isNaN(n) || n <= 0) continue;
    const suffix = (t[2] || "").toLowerCase();
    let mult = 1;
    if (suffix === "k") mult = 1_000;
    else if (suffix === "m") mult = 1_000_000;
    else if (suffix === "b") mult = 1_000_000_000;
    // Detect inline "thousand"/"million"/"billion" without a suffix code
    const inline = (t[0] || "").toLowerCase();
    if (inline.includes("thousand")) mult = 1_000;
    else if (inline.includes("million")) mult = 1_000_000;
    else if (inline.includes("billion")) mult = 1_000_000_000;
    numbers.push(n * mult);
  }
  if (!numbers.length) return null;
  if (numbers.length === 1) {
    return { value: numbers[0], isRange: false, low: numbers[0], high: numbers[0] };
  }
  // Use first two as low/high (Westlaw "Search Snippet" patterns sometimes
  // have spurious later numbers — fund total, attorney fees, etc.)
  const [a, b] = numbers;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  // Pure midpoint
  return { value: (low + high) / 2, isRange: low !== high, low, high };
}

// Estimate violations naming this defendant in the client's collectionsHistory.
// Sums contactDates length across all entries pointing at the defendant.
// Defaults to 1 if no contact data — that's the conservative legal minimum
// "at least one unwanted contact" we'd plead.
export function estimateViolations(client, caseRecord) {
  const defendantIds = new Set((caseRecord?.defendants || []).map(d => d.canonicalId).filter(Boolean));
  const defendantNames = new Set((caseRecord?.defendants || []).map(d => (d.displayName || "").toLowerCase()).filter(Boolean));
  const matchesDefendant = (entry, fields) =>
    fields.some(({ canonId, name }) =>
      (canonId && defendantIds.has(canonId)) ||
      (name && [...defendantNames].some((n) => name.toLowerCase().includes(n) || n.includes(name.toLowerCase())))
    );

  let count = 0;
  let matched = false;
  // 1. Legacy collectionsHistory entries
  for (const entry of (client?.collectionsHistory || [])) {
    const linked = matchesDefendant(entry, [
      { canonId: entry.creditorCanonicalId,  name: entry.creditor },
      { canonId: entry.debtBuyerCanonicalId, name: entry.debtBuyer },
    ]);
    if (!linked) continue;
    matched = true;
    const dates   = Array.isArray(entry.contactDates)   ? entry.contactDates.length   : 0;
    const methods = Array.isArray(entry.contactMethods) ? entry.contactMethods.length : 0;
    count += Math.max(dates, methods, 1);
  }
  // 2. Full credit-report tradelines — every account whose creditor is the
  // defendant is a potential TCPA touchpoint. Estimate contacts from late-
  // payment markers (each 30/60/90-day late = at least one collection call).
  for (const a of (client?.creditAccounts || [])) {
    const linked = matchesDefendant(a, [
      { canonId: a.creditorCanonicalId,         name: a.creditor },
      { canonId: a.originalCreditorCanonicalId, name: a.originalCreditor },
    ]);
    if (!linked) continue;
    matched = true;
    const lates = (a.latePayments?.d30 || 0) + (a.latePayments?.d60 || 0) + (a.latePayments?.d90 || 0);
    // Each late-payment cycle typically corresponds to 2-4 collection
    // contacts (calls + letters); use a conservative 1 per cycle.
    count += Math.max(lates, a.isCollection ? 3 : 1);
  }
  if (!matched) return 1; // No direct defendant link — minimum-one plead
  return Math.min(Math.max(count, 1), MAX_VIOLATIONS_PER_MATCH);
}

// Main entry. Returns the recovery estimate for one (client, case) pair.
//
// Inputs:
//   client      — the canonical client record
//   caseRecord  — the canonical case record
//   isQualifying — whether the rules-based matcher said qualifies=true
//                  (we still return an estimate for sub-threshold matches,
//                   but mark them as "speculative")
//
// Output (all dollar values are floats):
//   {
//     floor:        minimum likely recovery
//     ceiling:      maximum likely recovery
//     midpoint:     (floor + ceiling) / 2
//     method:       "settled_per_claimant" | "statutory_floor" | "speculative"
//     perViolation: { floor, ceiling }
//     violations:   integer count used
//     note:         human-readable explanation
//   }
export function estimateRecovery(client, caseRecord, { isQualifying = true } = {}) {
  if (!caseRecord) {
    return { floor: 0, ceiling: 0, midpoint: 0, method: "no_case", violations: 0, note: "missing case data" };
  }

  // 1. Try settled per-claimant amount first
  const claimRange = parseDollarRange(caseRecord.settlement?.perClaimantRange);
  if (claimRange && claimRange.value > 0 &&
      ["settled", "claim_open", "claim_closed"].includes(caseRecord.status)) {
    const floor = Math.min(claimRange.low, claimRange.high);
    const ceiling = Math.max(claimRange.low, claimRange.high);
    return {
      floor,
      ceiling,
      midpoint: (floor + ceiling) / 2,
      method: "settled_per_claimant",
      violations: 1,
      perViolation: { floor, ceiling },
      note: `Per-claimant award from settlement: ${caseRecord.settlement.perClaimantRange}`,
    };
  }

  // 2. Statutory damages by case type
  const statutory = PER_VIOLATION[caseRecord.caseType] || PER_VIOLATION.TCPA;
  const violations = estimateViolations(client, caseRecord);
  const floor = statutory.floor * violations;
  const ceiling = Math.min(statutory.ceiling * violations, SOFT_CAP_PER_MATCH);

  return {
    floor,
    ceiling,
    midpoint: (floor + ceiling) / 2,
    method: isQualifying ? "statutory_floor" : "speculative",
    violations,
    perViolation: statutory,
    note:
      violations > 1
        ? `Statutory ${caseRecord.caseType} damages × ${violations} estimated violations`
        : `Statutory ${caseRecord.caseType} damages, minimum one violation pled`,
  };
}

// Bulk roll-up: given a list of {client, caseRecord, qualifies} triples,
// return totals + per-status breakdown. Used by the portfolio aggregator.
export function aggregateRecovery(triples) {
  const totals = { floor: 0, ceiling: 0, midpoint: 0, matches: 0 };
  const byStatus = {}; // status → { floor, ceiling, matches }
  const byMethod = {}; // method → { floor, ceiling, matches }
  const byCaseType = {};
  const settledMatches = [];

  for (const t of triples) {
    if (!t.caseRecord || !t.client) continue;
    const est = estimateRecovery(t.client, t.caseRecord, { isQualifying: !!t.qualifies });
    totals.floor    += est.floor;
    totals.ceiling  += est.ceiling;
    totals.midpoint += est.midpoint;
    totals.matches  += 1;

    const status = t.caseRecord.status || "active";
    byStatus[status] = byStatus[status] || { floor: 0, ceiling: 0, midpoint: 0, matches: 0 };
    byStatus[status].floor    += est.floor;
    byStatus[status].ceiling  += est.ceiling;
    byStatus[status].midpoint += est.midpoint;
    byStatus[status].matches  += 1;

    byMethod[est.method] = byMethod[est.method] || { floor: 0, ceiling: 0, matches: 0 };
    byMethod[est.method].floor   += est.floor;
    byMethod[est.method].ceiling += est.ceiling;
    byMethod[est.method].matches += 1;

    const ct = t.caseRecord.caseType || "TCPA";
    byCaseType[ct] = byCaseType[ct] || { floor: 0, ceiling: 0, matches: 0 };
    byCaseType[ct].floor   += est.floor;
    byCaseType[ct].ceiling += est.ceiling;
    byCaseType[ct].matches += 1;

    if (est.method === "settled_per_claimant") settledMatches.push({ ...t, est });
  }

  return { totals, byStatus, byMethod, byCaseType, settledMatches };
}

export function formatUSD(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
