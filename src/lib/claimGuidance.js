// Claim guidance — for any (client, case) match, returns a structured
// playbook of what the plaintiff has to prove, what documents to gather,
// what the filing pathway is, and the deadline.
//
// Three layers, in priority order:
//
//   1. Case-specific override from src/data/knownTcpaSettlements.js when the
//      case has been enriched with a known-settlement seed (claim portal URL,
//      specific deadline, known per-claimant amount).
//   2. Status-aware template (active → "join as class member" pathway;
//      settled+claim_open → "file a claim in the settlement"; etc.).
//   3. Statutory baseline by caseType — what TCPA / FDCPA / FCRA require
//      to plead a violation. These are the generic "always true" elements.
//
// Pure function, no IO. Consumed by:
//   - src/lib/reportBuilder.js  → injects guidance onto every match
//   - api/_chat-tools.js        → get_client_matches returns it
//   - src/lib/claimGuidance.test.js (TODO) → unit tests
//
// IMPORTANT: nothing in here is legal advice. The point is to give the
// attorney reviewing a match a fast triage checklist — "here's what you
// need from the plaintiff before filing this claim."

import { KNOWN_SETTLEMENTS } from "../data/knownTcpaSettlements.js";
import { normalize as normalizeDefendant } from "./defendantResolver.js";

// ── Statutory baselines (what each statute always requires) ─────────────────
const STATUTORY_BASELINE = {
  TCPA: {
    statute: "47 U.S.C. § 227 (Telephone Consumer Protection Act)",
    perViolation: "$500 (statutory) / $1,500 (willful or knowing)",
    elementsToPlead: [
      "Defendant or its agent contacted plaintiff by phone, text, or fax",
      "Contact was to a cellular telephone or residential line (or unsolicited fax to a fax machine)",
      "Contact used an automatic telephone dialing system (ATDS), prerecorded voice, or autodialed text",
      "Contact was for marketing, debt collection, or other non-emergency purpose",
      "Plaintiff did not provide prior express written consent (or revoked consent before the contact)",
      "Plaintiff was the regular user of the called number at the time of contact",
    ],
    documentsToCollect: [
      "Phone bill or carrier call log showing the inbound call/text (date, time, originating number)",
      "Screenshot of the text message including timestamp and sender ID",
      "Voicemail recording or transcript if a prerecorded voice was left",
      "Government-issued ID matching the name on the phone account",
      "Any consent form the plaintiff signed and a statement of revocation if applicable",
      "Phone number ownership / carrier-account-holder records for the relevant period",
    ],
    factualQuestionsForIntake: [
      "What is the phone number(s) at which you received the contact?",
      "Was this a cellphone or residential landline?",
      "When did the first and most recent contact occur (approximate dates)?",
      "How many calls or texts did you receive in total?",
      "Did you hear a prerecorded message, an artificial voice, or a clicking/pause before a live agent?",
      "Did you ever give the defendant your phone number? If so, when and for what purpose?",
      "Did you tell the defendant to stop calling? When?",
    ],
    redFlags: [
      "Plaintiff gave express consent to a business and never revoked — likely defeats the claim",
      "Most recent contact >4 years ago AND case is not a pending class — SOL bar for individual suit",
      "Calls were from a person, not autodialer/prerecorded — only DNC Registry violations remain",
      "Plaintiff cannot identify the called number or no longer has phone records",
    ],
  },
  FDCPA: {
    statute: "15 U.S.C. § 1692 et seq. (Fair Debt Collection Practices Act)",
    perViolation: "Up to $1,000 statutory damages per case (plus actual damages and attorney fees)",
    elementsToPlead: [
      "Defendant is a 'debt collector' as defined by 15 U.S.C. § 1692a(6)",
      "The debt is a 'consumer debt' (primarily personal, family, or household purpose)",
      "Plaintiff is a 'consumer' under the FDCPA",
      "Defendant engaged in a specific prohibited practice: harassment (§ 1692d), false or misleading representations (§ 1692e), unfair practices (§ 1692f), failure to provide validation notice (§ 1692g), or contacting at prohibited times (§ 1692c)",
    ],
    documentsToCollect: [
      "Copies of every collection letter or notice received (with envelopes if possible)",
      "Call logs and voicemails from the collector",
      "Recorded statements or notes of phone conversations (date, time, what was said)",
      "Original debt origination documents (so the underlying debt's age can be established)",
      "Validation letter response from the debt collector (or proof none was provided)",
      "Credit reports showing the disputed debt and any reporting changes",
    ],
    factualQuestionsForIntake: [
      "Who originally owned the debt and what was it for?",
      "When did you last make a payment or acknowledge the debt?",
      "Did the collector contact you at work, before 8am, or after 9pm?",
      "Did the collector contact a third party (family, employer) about the debt?",
      "Did they threaten arrest, lawsuit, or other action they did not actually plan to take?",
      "Did they refuse to verify the debt after you requested validation?",
      "Did they continue contacting you after you sent a cease-and-desist letter?",
    ],
    redFlags: [
      "The debt is a business debt, not a consumer debt — FDCPA doesn't apply",
      "Defendant is the original creditor, not a third-party debt collector — FDCPA generally doesn't apply (state UDAP laws might)",
      "Plaintiff cannot identify specific prohibited conduct, just general dissatisfaction",
      "Statute of limitations: 1 year from the violation date",
    ],
  },
  FCRA: {
    statute: "15 U.S.C. § 1681 et seq. (Fair Credit Reporting Act)",
    perViolation: "$100 – $1,000 statutory damages per willful violation (plus actual + punitive)",
    elementsToPlead: [
      "Defendant is a 'consumer reporting agency' or a 'furnisher of information' under FCRA",
      "Defendant reported, furnished, or used a consumer report concerning plaintiff",
      "The report contained inaccurate information OR was provided without permissible purpose",
      "Plaintiff disputed the inaccuracy AND defendant failed to conduct a reasonable reinvestigation",
      "Defendant's conduct was willful (for statutory damages) or negligent (actual damages only)",
    ],
    documentsToCollect: [
      "Full credit reports from each bureau showing the disputed item(s)",
      "Written dispute letters sent to the bureau and/or furnisher (with delivery confirmation)",
      "The bureau's reinvestigation response letter",
      "Adverse action notice (denial of credit, employment, housing) if the inaccurate report was used",
      "Documents proving the correct information (e.g., bankruptcy discharge order, satisfaction-of-judgment record)",
      "Identification documents — full legal name and SSN to confirm identity-based reporting errors",
    ],
    factualQuestionsForIntake: [
      "Which credit bureau(s) are involved? Experian, Equifax, TransUnion?",
      "What information is inaccurate? Public record, account status, balance, dates?",
      "When did you first dispute? Did you dispute in writing, online, or by phone?",
      "What was the bureau's response — verified, corrected, deleted, or no response?",
      "Have you been denied credit, housing, or employment as a result?",
      "Did the wrong information cause measurable harm (interest rate increase, lost opportunity)?",
    ],
    redFlags: [
      "Plaintiff has not yet filed a written dispute — must dispute first before FCRA accrues",
      "Inaccuracy is technically correct but unflattering — FCRA requires INACCURACY",
      "Statute of limitations: 2 years from discovery, 5 years from violation",
      "Damages without willful conduct require actual harm — emotional distress alone is hard",
    ],
  },
  "TCPA+FDCPA": {
    statute: "Both 47 U.S.C. § 227 (TCPA) AND 15 U.S.C. § 1692 (FDCPA) apply",
    perViolation: "TCPA $500–$1,500 per call + FDCPA up to $1,000 statutory",
    elementsToPlead: [
      "All TCPA elements (see above) AND all FDCPA elements (see above)",
      "Most common scenario: a debt collector used an autodialer or prerecorded voice to call a consumer's cellphone",
    ],
    documentsToCollect: [
      "Everything from BOTH the TCPA and FDCPA document lists",
      "Particular attention to the time, number called, and method of contact",
    ],
    factualQuestionsForIntake: [
      "All TCPA + all FDCPA intake questions — especially: when did consent get revoked?",
    ],
    redFlags: [
      "All TCPA + all FDCPA red flags",
    ],
  },
};

// ── Case-specific overrides from the known-settlement seed ──────────────────
function seedEntryForCase(caseRecord) {
  if (!caseRecord?.defendants?.length) return null;
  for (const d of caseRecord.defendants) {
    const norm = normalizeDefendant(d.displayName || "");
    if (!norm) continue;
    // Find seed where normalized defendant matches AND caseType matches
    const candidates = KNOWN_SETTLEMENTS.filter((s) =>
      (s.defendantNorm === norm || norm.includes(s.defendantNorm) || s.defendantNorm.includes(norm)) &&
      (s.caseType === caseRecord.caseType || s.caseType === "TCPA+FDCPA" || caseRecord.caseType === "TCPA+FDCPA")
    );
    if (!candidates.length) continue;
    // Prefer the one whose classPeriod is closest in time to filingDate
    if (caseRecord.filingDate) {
      const filedMs = Date.parse(caseRecord.filingDate);
      let best = null;
      let bestDiff = Infinity;
      for (const s of candidates) {
        const periodEnd = s.classPeriod?.end ? Date.parse(s.classPeriod.end) : null;
        if (!periodEnd) continue;
        const diff = Math.abs(filedMs - periodEnd);
        if (diff < bestDiff) { bestDiff = diff; best = s; }
      }
      if (best) return best;
    }
    return candidates[0];
  }
  return null;
}

// ── Pathway resolver ────────────────────────────────────────────────────────
// What can the plaintiff actually do with this match given the case's status?
function resolvePathway(caseRecord) {
  const status = caseRecord?.status || "unknown";
  const closes = caseRecord?.settlement?.claimWindowCloses;
  const closesMs = closes ? Date.parse(closes) : null;
  const now = Date.now();
  const finalApproval = caseRecord?.settlement?.finalApprovalDate
    ? Date.parse(caseRecord.settlement.finalApprovalDate)
    : null;

  // claim_open OR settled-with-future-deadline → file a claim now
  if (status === "claim_open" || (status === "settled" && closesMs && closesMs > now)) {
    return {
      pathway: "settlement_claim",
      actionable: "now",
      headline: "File a claim in the existing settlement before the deadline",
      filingMechanism: "Submit a claim form on the settlement administrator's portal",
      deadline: closes || null,
    };
  }

  // settled with no known close date and final approval recent → likely still in window
  if (status === "settled" && finalApproval && !closesMs) {
    const daysSinceApproval = (now - finalApproval) / (1000 * 60 * 60 * 24);
    if (daysSinceApproval < 365) {
      return {
        pathway: "settlement_claim",
        actionable: "now",
        headline: "Likely still in claim window — check the settlement administrator immediately",
        filingMechanism: "Locate the settlement claim portal; deadlines are typically 6–18 months after final approval",
        deadline: null,
      };
    }
    return {
      pathway: "settlement_claim",
      actionable: "closed",
      headline: "Class settlement reached — claim window has likely closed",
      filingMechanism: "Already-class-member relief is foreclosed; this match is a historical benchmark",
      deadline: null,
    };
  }

  // claim_closed
  if (status === "claim_closed") {
    return {
      pathway: "none",
      actionable: "closed",
      headline: "Settlement claim window has closed",
      filingMechanism: "Plaintiff cannot recover from this class action; consider an individual lawsuit if SOL permits",
      deadline: null,
    };
  }

  // active case → join the class IF certified, OR file individual lawsuit
  if (status === "active") {
    return {
      pathway: "class_member_or_individual",
      actionable: "if_certified",
      headline: "Active litigation — join the class if certified, or file an individual lawsuit",
      filingMechanism: "Monitor for class certification; if certified, opt-in/opt-out notice will issue. Alternatively, file an individual complaint if SOL permits.",
      deadline: null,
    };
  }

  return {
    pathway: "unknown",
    actionable: "unknown",
    headline: "Case status unclear — operator review required",
    filingMechanism: "Manually verify case status with court records before relying on this match",
    deadline: null,
  };
}

// ── Main entry ──────────────────────────────────────────────────────────────
// Returns:
//   {
//     statute: string,
//     pathway: "settlement_claim" | "class_member_or_individual" | "none" | "unknown",
//     actionable: "now" | "if_certified" | "closed" | "unknown",
//     headline: string,
//     filingMechanism: string,
//     deadline: ISO date or null,
//     portalUrl: string or null,
//     noticeUrl: string or null,
//     elementsToPlead: string[],     // facts the plaintiff must prove
//     documentsToCollect: string[],  // what to gather from the plaintiff
//     factualQuestionsForIntake: string[],
//     redFlags: string[],
//     knownPerClaimant: string or null,  // when we have a real seeded amount
//     seedCitation: string or null,
//   }
export function claimGuidance(caseRecord, client = null) {
  const caseType = caseRecord?.caseType || "TCPA";
  const baseline = STATUTORY_BASELINE[caseType] || STATUTORY_BASELINE.TCPA;
  const pathway = resolvePathway(caseRecord);
  const seed = seedEntryForCase(caseRecord);

  return {
    caseId: caseRecord?.id,
    caseType,
    statute: baseline.statute,
    pathway: pathway.pathway,
    actionable: pathway.actionable,
    headline: pathway.headline,
    filingMechanism: pathway.filingMechanism,
    deadline: pathway.deadline,
    portalUrl: caseRecord?.settlement?.claimPortalUrl || null,
    noticeUrl: caseRecord?.settlement?.classNoticeUrl || null,
    knownPerClaimant: seed?.perClaimantRange || caseRecord?.settlement?.perClaimantRange || null,
    perViolationStatutory: baseline.perViolation,
    seedCitation: seed?.source || null,
    elementsToPlead: baseline.elementsToPlead,
    documentsToCollect: baseline.documentsToCollect,
    factualQuestionsForIntake: baseline.factualQuestionsForIntake,
    redFlags: baseline.redFlags,
    // Per-case context if available
    classDefinition: caseRecord?.classDefinition || seed?.classDefinition || null,
    classPeriod: caseRecord?.classPeriod || seed?.classPeriod || null,
    eligibleStates: caseRecord?.eligibleStates || [],
  };
}

// Compact version for tables / chat tool returns — drop the long lists,
// keep the actionable summary.
export function claimGuidanceCompact(caseRecord, client = null) {
  const g = claimGuidance(caseRecord, client);
  return {
    caseId: g.caseId,
    pathway: g.pathway,
    actionable: g.actionable,
    headline: g.headline,
    deadline: g.deadline,
    portalUrl: g.portalUrl,
    keyProofCount: g.elementsToPlead.length,
    documentsCount: g.documentsToCollect.length,
    redFlagCount: g.redFlags.length,
  };
}
