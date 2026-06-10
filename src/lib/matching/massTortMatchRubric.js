// Rules-based mass-tort match scorer.
//
// Pure function: given a client record (with massTortSignals populated by
// creditReportToClient) and a scanner lead object (from KV `lead:${id}`),
// returns a deterministic score and qualification verdict.
// No KV reads, no API calls — safe to call in tight loops inside match-batch.js.
//
// Scoring weights:
//   +35  ZIP in case's geographic hotspots
//   +30  Client state in case's geographicScope or eligibleStates
//   +25  Medical creditor name fuzzy-matches defendant name
//   +20  Auto creditor vintage overlaps injury timeframe AND caseType is "Auto Defect"
//   +20  Pharmacy inquiry matches defendant product AND caseType is "Pharmaceutical"
//   +15  Medical debt at any creditor AND caseType is medical-adjacent
//   +10  Client age range overlaps plaintiff demographics age range
//   +5   Prior bankruptcy with medical debt
//
// Disqualifiers:
//   -100 opportunityStatus = "CLOSED" or caseStage = "Resolved"
//   -100 targetingReadiness = "WAIT_FOR_TRIGGER"
//   -50  Client state not in case states AND geographicScope is not nationwide
//
// Returns the same shape as scoreTcpaPair so callers can handle both uniformly:
//   { score, confidence, qualifies, matchingFactors[], disqualifyingFactors[], caseType }

export const MASS_TORT_WEIGHTS = {
  ZIP_HOTSPOT:           35,
  STATE_MATCH:           30,
  MEDICAL_CREDITOR_FUZZY: 25,
  AUTO_VINTAGE_OVERLAP:  20,
  PHARMACY_DEFENDANT:    20,
  MEDICAL_DEBT_INDUSTRY: 15,
  AGE_OVERLAP:           10,
  BANKRUPTCY_MEDICAL:     5,
};

export const DISQUALIFY = {
  CASE_CLOSED:     "Case is closed (opportunityStatus=CLOSED or caseStage=Resolved)",
  WAIT_TRIGGER:    "Case requires trigger before targeting (targetingReadiness=WAIT_FOR_TRIGGER)",
  STATE_MISMATCH:  "Client state not in case's eligible states (non-nationwide scope)",
};

// Normalise a string for fuzzy substring matching: lowercase, collapse whitespace.
function norm(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// True if either string contains the other as a substring (both non-empty).
function fuzzySubstring(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// Parse the first two 4-digit years out of a freeform timeframe string.
// e.g. "2015-2022", "manufactured between 2016 and 2020", "model years 2018–2023"
function parseYearRange(str) {
  if (!str) return null;
  const matches = String(str).match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length < 1) return null;
  const years = matches.map(Number);
  return { start: Math.min(...years), end: Math.max(...years) };
}

// Parse an age range from a demographics string.
// Accepts "adults 40-70", "ages 50 to 80", "over 60", "under 45" etc.
function parseDemographicsAge(str) {
  if (!str) return null;
  const s = String(str).toLowerCase();

  // Explicit range: "40-70", "40 to 70"
  const rangeMatch = s.match(/\b(\d{2})\s*(?:-|to)\s*(\d{2})\b/);
  if (rangeMatch) {
    return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
  }
  // "over N" / "older than N"
  const overMatch = s.match(/(?:over|older than|above|>)\s*(\d{2})\b/);
  if (overMatch) return { min: parseInt(overMatch[1], 10), max: 100 };
  // "under N" / "younger than N"
  const underMatch = s.match(/(?:under|younger than|below|<)\s*(\d{2})\b/);
  if (underMatch) return { min: 0, max: parseInt(underMatch[1], 10) };

  return null;
}

// True when two {min,max} age ranges overlap (both inclusive).
function ageRangesOverlap(a, b) {
  if (!a || !b) return false;
  return a.min <= b.max && b.min <= a.max;
}

// Determine whether the case is geographically nationwide.
function isNationwide(lead) {
  const scope = (lead.analysis?.geographicScope || lead.geographicScope || "").toLowerCase();
  return scope === "nationwide" || scope === "national";
}

// Resolve the set of case-eligible state codes.
function caseStates(lead) {
  const raw = lead.analysis?.eligibleStates
    || lead.analysis?.plaintiffProfile?.eligibleStates
    || lead.eligibleStates
    || [];
  return new Set(raw.map((s) => (s || "").toUpperCase().slice(0, 2)).filter(Boolean));
}

// Resolve geographic hotspot ZIP codes from the lead.
function caseHotspotZips(lead) {
  const hotspots = lead.analysis?.plaintiffProfile?.geographicHotspots
    || lead.analysis?.geographicHotspots
    || [];
  const zips = new Set();
  for (const h of hotspots) {
    const s = String(h);
    // Expand explicit ZIP ranges like "10001-10099" (capped at 100 per range).
    const rangeRe = /\b(\d{5})-(\d{5})\b/g;
    let rm;
    while ((rm = rangeRe.exec(s)) !== null) {
      const lo = parseInt(rm[1], 10);
      const hi = parseInt(rm[2], 10);
      const count = Math.min(hi - lo + 1, 100);
      for (let z = lo; z < lo + count; z++) {
        zips.add(String(z).padStart(5, "0"));
      }
    }
    // Accept bare ZIPs and ZIPs embedded in "City, ST 12345" strings.
    const singleRe = /\b(\d{5})\b/g;
    let sm;
    while ((sm = singleRe.exec(s)) !== null) {
      zips.add(sm[1]);
    }
  }
  return zips;
}

// Resolve the case's defendant name(s) for fuzzy matching.
function caseDefendantNames(lead) {
  const names = [];
  if (lead.analysis?.defendantProfile?.name) names.push(norm(lead.analysis.defendantProfile.name));
  if (lead.analysis?.defendantProfile?.aliases) {
    for (const a of lead.analysis.defendantProfile.aliases) names.push(norm(a));
  }
  if (lead.defendant)  names.push(norm(lead.defendant));
  if (lead.defendants) for (const d of lead.defendants) names.push(norm(d.displayName || d.name || d));
  return names.filter(Boolean);
}

// Score one (client, lead) pair.
// `lead` is a scanner lead object as stored at `lead:${id}` in KV.
export function scoreMassTortPair(client, lead) {
  const matchingFactors = [];
  const disqualifyingFactors = [];
  let score = 0;

  const analysis   = lead.analysis || {};
  const ct         = (analysis.caseType || lead.caseType || "").toLowerCase();
  const signals    = client.massTortSignals || {};

  // ── Hard disqualifiers ────────────────────────────────────────────────────
  const oppStatus  = (analysis.opportunityStatus || "").toUpperCase();
  const caseStage  = (analysis.caseStage || lead.caseStage || "").toLowerCase();
  const targeting  = (analysis.targetingReadiness || "").toUpperCase();

  if (oppStatus === "CLOSED" || caseStage === "resolved") {
    disqualifyingFactors.push(DISQUALIFY.CASE_CLOSED);
    return finalize({ score: 0, qualifies: false, matchingFactors, disqualifyingFactors, caseType: ct });
  }
  if (targeting === "WAIT_FOR_TRIGGER") {
    disqualifyingFactors.push(DISQUALIFY.WAIT_TRIGGER);
    return finalize({ score: 0, qualifies: false, matchingFactors, disqualifyingFactors, caseType: ct });
  }

  // ── Geographic: client state vs case scope ────────────────────────────────
  const clientStates = new Set(
    [client.state, ...(signals.states || [])].map((s) => (s || "").toUpperCase().slice(0, 2)).filter(Boolean)
  );
  const eligible = caseStates(lead);
  const nationwide = isNationwide(lead);

  let stateMatched = false;
  if (nationwide) {
    score += MASS_TORT_WEIGHTS.STATE_MATCH;
    matchingFactors.push("Nationwide case scope — client state qualifies");
    stateMatched = true;
  } else if ([...clientStates].some((s) => eligible.has(s))) {
    score += MASS_TORT_WEIGHTS.STATE_MATCH;
    matchingFactors.push(`Client state(s) ${[...clientStates].filter((s) => eligible.has(s)).join(", ")} in case eligible states`);
    stateMatched = true;
  }

  if (!stateMatched && !nationwide && eligible.size > 0) {
    disqualifyingFactors.push(DISQUALIFY.STATE_MISMATCH);
    score = Math.max(0, score - 50);
  }

  // ── Geographic: ZIP hotspot ───────────────────────────────────────────────
  const hotspotZips = caseHotspotZips(lead);
  if (hotspotZips.size > 0) {
    const clientZips = signals.zipCodes || [];
    const hitZip = clientZips.find((z) => hotspotZips.has(z));
    if (hitZip) {
      score += MASS_TORT_WEIGHTS.ZIP_HOTSPOT;
      matchingFactors.push(`Client ZIP ${hitZip} is in case geographic hotspot`);
    }
  }

  // ── Medical creditor ↔ defendant fuzzy match ──────────────────────────────
  const defendantNames = caseDefendantNames(lead);
  const medicalCreditors = (signals.medicalCreditors || []).map(norm);

  for (const medCred of medicalCreditors) {
    for (const defName of defendantNames) {
      if (fuzzySubstring(medCred, defName)) {
        score += MASS_TORT_WEIGHTS.MEDICAL_CREDITOR_FUZZY;
        matchingFactors.push(`Medical creditor "${medCred}" fuzzy-matches defendant "${defName}"`);
        break;
      }
    }
    if (matchingFactors.some((f) => f.startsWith("Medical creditor"))) break;
  }

  // ── Auto creditor vintage ↔ injury timeframe (Auto Defect cases only) ─────
  if (ct === "auto defect" || ct === "auto_defect") {
    const injuryTimeframe = analysis.plaintiffProfile?.injuryTimeframe
      || analysis.injuryTimeframe
      || "";
    const injuryYears = parseYearRange(injuryTimeframe);
    if (injuryYears) {
      for (const auto of (signals.autoCreditors || [])) {
        const startY = auto.openYear;
        const endY   = auto.closeYear || new Date().getFullYear();
        if (startY && startY <= injuryYears.end && endY >= injuryYears.start) {
          score += MASS_TORT_WEIGHTS.AUTO_VINTAGE_OVERLAP;
          matchingFactors.push(`Auto loan at "${auto.creditor}" (${startY}–${endY}) overlaps case injury timeframe (${injuryYears.start}–${injuryYears.end})`);
          break;
        }
      }
    }
  }

  // ── Pharmacy inquiry ↔ defendant product (Pharmaceutical cases only) ───────
  if (ct === "pharmaceutical" || ct === "pharma") {
    const pharmInquiries = (signals.pharmacyInquiries || []).map(norm);
    for (const inq of pharmInquiries) {
      for (const defName of defendantNames) {
        if (fuzzySubstring(inq, defName)) {
          score += MASS_TORT_WEIGHTS.PHARMACY_DEFENDANT;
          matchingFactors.push(`Pharmacy inquiry "${inq}" matches defendant "${defName}"`);
          break;
        }
      }
      if (matchingFactors.some((f) => f.startsWith("Pharmacy inquiry"))) break;
    }
  }

  // ── Medical debt industry signal ──────────────────────────────────────────
  const isMedicalCaseType = /pharmaceutical|pharma|medical\s*device|med\s*device/.test(ct);
  if (isMedicalCaseType && (signals.medicalCreditors || []).length > 0) {
    score += MASS_TORT_WEIGHTS.MEDICAL_DEBT_INDUSTRY;
    matchingFactors.push(`Client has medical-creditor accounts (${signals.medicalCreditors.length}) — relevant to ${ct} case`);
  }

  // ── Age range overlap ──────────────────────────────────────────────────────
  if (signals.estimatedAgeRange) {
    const demographicsStr = analysis.plaintiffProfile?.demographics || analysis.demographics || "";
    const caseAge = parseDemographicsAge(demographicsStr);
    if (caseAge && ageRangesOverlap(signals.estimatedAgeRange, caseAge)) {
      score += MASS_TORT_WEIGHTS.AGE_OVERLAP;
      matchingFactors.push(`Client estimated age ${signals.estimatedAgeRange.min}–${signals.estimatedAgeRange.max} overlaps plaintiff demographics (${caseAge.min}–${caseAge.max})`);
    }
  }

  // ── Prior bankruptcy with medical debt ────────────────────────────────────
  if (signals.bankruptcyMedicalDebt) {
    score += MASS_TORT_WEIGHTS.BANKRUPTCY_MEDICAL;
    matchingFactors.push("Prior bankruptcy with medical debt — financial harm signal");
  }

  const qualifies = disqualifyingFactors.length === 0 && score >= 40;
  return finalize({ score, qualifies, matchingFactors, disqualifyingFactors, caseType: ct });
}

function finalize({ score, qualifies, matchingFactors, disqualifyingFactors, caseType }) {
  const clampedScore = Math.max(0, Math.min(100, score));

  let confidence;
  if (clampedScore >= 70) {
    confidence = 85;
  } else if (clampedScore >= 50) {
    confidence = 70;
  } else if (clampedScore >= 30) {
    confidence = 55;
  } else {
    confidence = 35;
  }

  return {
    score: clampedScore,
    qualifies,
    confidence,
    confidenceSource: "rules",
    matchingFactors,
    disqualifyingFactors,
    caseType,
  };
}
