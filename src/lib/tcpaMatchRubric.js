// Rules-based TCPA / FDCPA / FCRA match scorer.
//
// Pure function: given a client record and a TCPA case record, returns a
// deterministic score and qualification verdict. No KV, no API calls. Used by
// api/match-cases.js as the fast path; only ambiguous results (confidence < 70)
// escalate to Haiku.
//
// Scoring:
//   +40  Defendant exact canonical-ID hit in client.collectionsHistory
//   +25  Defendant parent / subsidiary match
//   +15  client.state ∈ case.eligibleStates  (or case.geographicScope = "nationwide")
//   +15  Client residency window overlaps case.classPeriod
//   +10  Phone is valid US 10-digit and not on opt-out list
//   +5   client.existingCases includes prior TCPA / FDCPA case (familiarity)
//
// Disqualifiers (any one zeroes the score and sets qualifies=false):
//   -100 Defendant on client.claimedSettlements (already claimed)
//   -100 client.tcpaOptOut === true
//   -50  Case status = "claim_closed"
//   -50  Class period ended > 4 yrs before client's most recent collections entry (SOL)
//
// Confidence: rough proxy for "how sure are we about this score?"
//   - 90+  : exact defendant hit + state + period overlap
//   - 75-89: parent/subsidiary defendant OR weak period overlap
//   - 60-74: state + period only, no defendant link → escalate to Haiku
//   - < 60 : insufficient data → escalate to Haiku

export const RULE_WEIGHTS = {
  DEFENDANT_EXACT:      40,
  DEFENDANT_FAMILY:     25,
  STATE_OR_NATIONWIDE:  15,
  RESIDENCY_OVERLAP:    15,
  VALID_PHONE:          10,
  PRIOR_FAMILIARITY:     5,
};

export const DISQUALIFY = {
  ALREADY_CLAIMED: "Client has already claimed this settlement",
  OPTED_OUT:       "Client has opted out of TCPA contact",
  CLAIM_CLOSED:    "Settlement claim window has closed",
  SOL_EXPIRED:     "Statute of limitations expired (>4 yrs since contact)",
};

const TCPA_SOL_DAYS = 4 * 365;

// Score one (client, case) pair.
// `caseRecord` must be a TCPA case as built by tcpaSchema.buildCase.
export function scoreTcpaPair(client, caseRecord) {
  const matchingFactors = [];
  const disqualifyingFactors = [];
  let score = 0;
  let confidenceContributors = 0;
  let matchType = "none";

  // ── Disqualifiers (short-circuit) ──────────────────────────────────────────
  if (client.tcpaOptOut === true) {
    disqualifyingFactors.push(DISQUALIFY.OPTED_OUT);
    return finalize({ score: 0, qualifies: false, matchType: "disqualified", matchingFactors, disqualifyingFactors, confidence: 100 });
  }

  if (Array.isArray(client.claimedSettlements) &&
      client.claimedSettlements.some((s) => s.caseId === caseRecord.id)) {
    disqualifyingFactors.push(DISQUALIFY.ALREADY_CLAIMED);
    return finalize({ score: 0, qualifies: false, matchType: "disqualified", matchingFactors, disqualifyingFactors, confidence: 100 });
  }

  if (caseRecord.status === "claim_closed") {
    disqualifyingFactors.push(DISQUALIFY.CLAIM_CLOSED);
    // Don't short-circuit — caller may still want to see the score for an audit
    // trail. We return qualifies=false but compute the raw score below.
  }

  // ── Defendant match (the load-bearing signal) ──────────────────────────────
  // We scan BOTH client.collectionsHistory (legacy, FDCPA-shaped) AND
  // client.creditAccounts (full credit report — every tradeline). Any
  // creditor on the client's credit report is a potential TCPA defendant if
  // they autodialed / prerecorded calls — not just collection agencies.
  const caseDefendantIds = new Set((caseRecord.defendants || []).map((d) => d.canonicalId).filter(Boolean));
  const caseDefendantNames = new Set((caseRecord.defendants || []).map((d) => (d.displayName || "").toLowerCase()));
  const clientCreditorIds = new Set();
  const clientCreditorNames = new Set();
  for (const entry of (client.collectionsHistory || [])) {
    if (entry.creditorCanonicalId) clientCreditorIds.add(entry.creditorCanonicalId);
    if (entry.debtBuyerCanonicalId) clientCreditorIds.add(entry.debtBuyerCanonicalId);
    if (entry.creditor) clientCreditorNames.add(entry.creditor.toLowerCase());
    if (entry.debtBuyer) clientCreditorNames.add(entry.debtBuyer.toLowerCase());
  }
  for (const account of (client.creditAccounts || [])) {
    if (account.creditorCanonicalId) clientCreditorIds.add(account.creditorCanonicalId);
    if (account.originalCreditorCanonicalId) clientCreditorIds.add(account.originalCreditorCanonicalId);
    if (account.creditor) clientCreditorNames.add(account.creditor.toLowerCase());
    if (account.originalCreditor) clientCreditorNames.add(account.originalCreditor.toLowerCase());
  }

  let exactDefendantHit = false;
  for (const cId of caseDefendantIds) {
    if (clientCreditorIds.has(cId)) {
      exactDefendantHit = true;
      break;
    }
  }
  if (exactDefendantHit) {
    score += RULE_WEIGHTS.DEFENDANT_EXACT;
    matchingFactors.push("Defendant matches client creditor (canonical ID)");
    matchType = "exact-defendant";
    confidenceContributors += 50;
  } else {
    // Check parent/subsidiary match — if any case defendant has a parent that
    // appears in client creditors. The case record doesn't carry parent info
    // directly; subsidiary lookups would need a follow-up KV read. For the
    // pure-function path, fall back to fuzzy displayName match as a weaker
    // signal that still lets us pick up "Capital One" vs "Capital One Bank".
    let familyHit = false;
    for (const caseName of caseDefendantNames) {
      for (const creditorName of clientCreditorNames) {
        if (caseName && creditorName &&
            (caseName.includes(creditorName) || creditorName.includes(caseName))) {
          familyHit = true;
          break;
        }
      }
      if (familyHit) break;
    }
    if (familyHit) {
      score += RULE_WEIGHTS.DEFENDANT_FAMILY;
      matchingFactors.push("Defendant family match (substring)");
      matchType = "parent-subsidiary";
      confidenceContributors += 25;
    }
  }

  // ── Geographic eligibility ────────────────────────────────────────────────
  const clientState = (client.state || "").toUpperCase();
  const caseStates = new Set((caseRecord.eligibleStates || []).map((s) => s.toUpperCase()));
  const isNationwide = caseRecord.geographicScope === "nationwide";
  if (isNationwide || (clientState && caseStates.has(clientState))) {
    score += RULE_WEIGHTS.STATE_OR_NATIONWIDE;
    matchingFactors.push(isNationwide ? "Nationwide class scope" : `Client state ${clientState} in eligible states`);
    confidenceContributors += 15;
    if (matchType === "none") matchType = "state-eligibility";
  } else if (clientState) {
    disqualifyingFactors.push(`Client state ${clientState} not in eligible states`);
  }

  // ── Residency / class period overlap ──────────────────────────────────────
  // Period overlap is a +15 bonus when confirmed. When the case has a class
  // period AND the client's residency does NOT overlap, we DO NOT disqualify
  // — class-period data quality varies by source (Westlaw editor summaries,
  // hand-curated seeds, agent extractions), and a strict-disqualify policy
  // makes us brittle to data noise. Drop confidence and flag for review.
  // Hard disqualifiers are reserved for unambiguous signals (opt-out,
  // claim-closed, already-claimed).
  const overlap = computeResidencyOverlap(client, caseRecord);
  if (overlap.overlaps) {
    score += RULE_WEIGHTS.RESIDENCY_OVERLAP;
    matchingFactors.push(`Residency overlaps class period (${overlap.basis})`);
    confidenceContributors += 15;
    if (matchType === "none" || matchType === "state-eligibility") matchType = "state+period";
  } else if (overlap.basis === "out-of-period") {
    // Soft signal — note for attorney review, don't disqualify.
    matchingFactors.push("Period overlap unconfirmed — attorney review");
    confidenceContributors -= 10;
  }

  // ── SOL check ─────────────────────────────────────────────────────────────
  const solExpired = isSolExpired(client, caseRecord);
  if (solExpired) {
    disqualifyingFactors.push(DISQUALIFY.SOL_EXPIRED);
    score = Math.max(0, score - 50);
  }

  // ── Phone validity ────────────────────────────────────────────────────────
  const validPhone = (client.phoneNumbers || []).some(isValidUsE164);
  if (validPhone) {
    score += RULE_WEIGHTS.VALID_PHONE;
    matchingFactors.push("Valid US phone on file");
    confidenceContributors += 5;
  }

  // ── Prior familiarity ─────────────────────────────────────────────────────
  const existing = String(client.existingCases || "").toLowerCase();
  if (/\btcpa\b|\bfdcpa\b|\bfcra\b|\brobocall\b/.test(existing)) {
    score += RULE_WEIGHTS.PRIOR_FAMILIARITY;
    matchingFactors.push("Prior TCPA/FDCPA case in client history");
  }

  // ── Determine qualifies ────────────────────────────────────────────────────
  const qualifies =
    disqualifyingFactors.length === 0 &&
    score >= 50 &&
    matchType !== "none";

  // Confidence: high when we landed on a strong defendant signal AND geography;
  // low when only state matched.
  let confidence = Math.min(95, confidenceContributors);
  if (exactDefendantHit && overlap.overlaps && (isNationwide || caseStates.has(clientState))) {
    confidence = Math.max(confidence, 90);
  } else if (matchType === "state+period") {
    confidence = Math.min(confidence, 65);
  } else if (matchType === "state-eligibility") {
    confidence = Math.min(confidence, 55);
  }

  return finalize({ score, qualifies, matchType, matchingFactors, disqualifyingFactors, confidence });
}

function finalize(out) {
  return {
    score: Math.max(0, Math.min(100, out.score)),
    qualifies: out.qualifies,
    matchType: out.matchType,
    matchingFactors: out.matchingFactors,
    disqualifyingFactors: out.disqualifyingFactors,
    confidence: out.confidence,
    confidenceSource: "rules",
  };
}

function isValidUsE164(p) {
  return typeof p === "string" && /^\+1\d{10}$/.test(p);
}

function computeResidencyOverlap(client, caseRecord) {
  const cp = caseRecord.classPeriod || {};
  if (!cp.start && !cp.end) return { overlaps: false, basis: "no-class-period" };
  const cpStart = cp.start ? Date.parse(cp.start) : -Infinity;
  const cpEnd   = cp.end   ? Date.parse(cp.end)   : Infinity;

  // Prefer addressHistory if present
  if (Array.isArray(client.addressHistory) && client.addressHistory.length) {
    for (const a of client.addressHistory) {
      const aStart = a.start ? Date.parse(a.start) : -Infinity;
      const aEnd   = a.end   ? Date.parse(a.end)   : Date.now();
      if (aStart <= cpEnd && aEnd >= cpStart) {
        return { overlaps: true, basis: "address history" };
      }
    }
    return { overlaps: false, basis: "out-of-period" };
  }

  // Fall back to collectionsHistory dateRange
  if (Array.isArray(client.collectionsHistory) && client.collectionsHistory.length) {
    for (const e of client.collectionsHistory) {
      const eStart = e.dateRange?.start ? Date.parse(e.dateRange.start) : -Infinity;
      const eEnd   = e.dateRange?.end   ? Date.parse(e.dateRange.end)   : Date.now();
      if (eStart <= cpEnd && eEnd >= cpStart) {
        return { overlaps: true, basis: "collections history" };
      }
    }
  }

  // Fall back to creditAccounts opened/closed dates (full credit report)
  if (Array.isArray(client.creditAccounts) && client.creditAccounts.length) {
    for (const a of client.creditAccounts) {
      const aStart = a.dateOpened       ? Date.parse(a.dateOpened) : -Infinity;
      const aEnd   = (a.dateClosed || a.dateLastActivity || a.dateLastReported)
                       ? Date.parse(a.dateClosed || a.dateLastActivity || a.dateLastReported)
                       : Date.now();
      if (aStart <= cpEnd && aEnd >= cpStart) {
        return { overlaps: true, basis: "credit account dates" };
      }
    }
    return { overlaps: false, basis: "out-of-period" };
  }

  // No data to confirm or deny — neutral.
  return { overlaps: false, basis: "no-residency-data" };
}

function isSolExpired(client, caseRecord) {
  // SOL bars filing a NEW lawsuit more than 4 yrs after the violation.
  // It does NOT bar filing a CLAIM in an existing class settlement — the
  // class action's filing date controls, not the individual claimant's.
  // So skip SOL for cases that are already settled / in-claim-window.
  const status = caseRecord?.status;
  if (status === "settled" || status === "claim_open") return false;
  // claim_closed is its own disqualifier (handled separately); dismissed
  // doesn't matter (the case is dead either way).

  // For ACTIVE / unfiled-case scenarios, SOL = 4 yrs from most recent contact
  // (or class period end if no contact data). If neither known, can't tell.
  const lastContact = mostRecentContact(client);
  const cpEnd = caseRecord.classPeriod?.end ? Date.parse(caseRecord.classPeriod.end) : null;
  const referenceDate = lastContact ?? cpEnd;
  if (!referenceDate) return false;
  const daysSince = (Date.now() - referenceDate) / (1000 * 60 * 60 * 24);
  return daysSince > TCPA_SOL_DAYS;
}

function mostRecentContact(client) {
  let latest = null;
  const consider = (raw) => {
    if (!raw) return;
    const t = Date.parse(raw);
    if (isNaN(t)) return;
    if (latest === null || t > latest) latest = t;
  };
  for (const e of (client.collectionsHistory || [])) {
    for (const d of (e.contactDates || [])) consider(d);
    consider(e.dateRange?.end);
  }
  // Credit report tradelines: last activity / last reported are the best
  // proxies for "most recent contact from this creditor."
  for (const a of (client.creditAccounts || [])) {
    consider(a.dateLastActivity);
    consider(a.dateLastReported);
    consider(a.datePlacedForCollection);
  }
  return latest;
}
