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

import { KNOWN_SETTLEMENTS } from "../../data/knownTcpaSettlements.js";
import { normalize as normalizeDefendant } from "../ingest/defendantResolver.js";

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
      "For DNC Registry claims (§ 227(c)(5)): number registered >31 days before the call, call was a telephone solicitation, no established business relationship, AND more than one violation within a 12-month period",
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
      "Is your number on the National Do Not Call Registry? When did you register it, and did you get more than one solicitation call in any 12-month period?",
    ],
    redFlags: [
      "Plaintiff gave express consent to a business and never revoked — likely defeats the claim",
      "Most recent contact >4 years ago AND case is not a pending class — SOL bar for individual suit",
      "Calls were from a person, not autodialer/prerecorded — only DNC Registry violations remain",
      "Plaintiff cannot identify the called number or no longer has phone records",
      "Client in TX/LA/MS: Bradford v. Sovereign Pest Control (5th Cir. Feb. 2026) holds ORAL consent suffices — written-consent theories are weaker in the Fifth Circuit",
      "Text-based § 227(c) DNC claims face an active circuit split on whether texts are 'calls' — viability is jurisdiction-dependent (C.D. Ill./N.D. Fla./M.D. Fla./N.D. Ohio say no; D. Or./N.D. Cal./S.D.N.Y. say yes)",
      "Post-McLaughlin (SCOTUS 2025) courts are NOT bound by FCC interpretations — theories resting on FCC rules rather than statutory text must survive independent construction",
      "A single unwanted text invites a TransUnion Article III standing challenge — multiple contacts make standing materially safer",
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
  CROA: {
    statute: "15 U.S.C. § 1679 et seq. (Credit Repair Organizations Act)",
    perViolation: "Actual damages + punitive damages + attorney fees; no statutory cap",
    elementsToPlead: [
      "Defendant is a 'credit repair organization' as defined by 15 U.S.C. § 1679a(3) — receives money to improve consumer's credit",
      "Defendant made an untrue or misleading representation regarding its services",
      "Defendant engaged in a prohibited practice (e.g., charging fees before services rendered, failing to provide required disclosures, recommending false statements to bureaus)",
      "Plaintiff is a consumer who was damaged by the prohibited practice",
      "Defendant's conduct was willful or negligent",
    ],
    documentsToCollect: [
      "Credit repair service agreement or contract with the defendant",
      "All marketing materials, emails, or websites that described the service",
      "Payment receipts showing fees charged before results delivered",
      "Required CROA disclosure document (3-day cancellation right notice) — or evidence it was not provided",
      "Credit reports before and after the service period showing changes (or lack thereof)",
      "Any dispute letters filed by the credit repair organization on plaintiff's behalf",
      "Communications showing referral from Credit.com or other lead-generator to Lexington Law / PGX Holdings",
    ],
    factualQuestionsForIntake: [
      "Did you sign up for a credit repair service through Credit.com, Lexington Law, or a similar company?",
      "Were you charged upfront before any results were delivered?",
      "What promises were made about credit score improvement or debt removal?",
      "Did the company tell you to dispute accurate negative items?",
      "Did you receive a written disclosure of your right to cancel within 3 business days?",
      "How much total did you pay the credit repair organization?",
    ],
    redFlags: [
      "If the plaintiff's own credit reports show genuinely accurate negative information, the CROA claim weakens",
      "Statute of limitations: 5 years from violation (longer than most consumer statutes)",
      "Must prove the defendant is a CRO — some companies structure fees to avoid the definition",
      "Arbitration clauses in credit repair contracts may be enforceable (check contract)",
    ],
  },
  CIPA: {
    statute: "CA Penal Code §§ 631, 632 (California Invasion of Privacy Act); also FL Stat. § 934.03; MA G.L. ch. 272 § 99",
    perViolation: "$5,000 per violation (fixed statutory damages) in CA; same in FL and MA",
    elementsToPlead: [
      "Defendant intentionally wiretapped, recorded, or intercepted plaintiff's confidential communication without consent",
      "OR: Defendant used a third-party pixel, session-replay script, or tracking technology to capture plaintiff's financial or personal data from a website without disclosure",
      "Communication was 'confidential' — at least one party reasonably expected privacy (CA standard)",
      "Plaintiff did not consent to the interception (lack of conspicuous notice = lack of consent)",
      "Defendant acted intentionally (not accidentally)",
    ],
    documentsToCollect: [
      "Screenshots of defendant's website privacy policy (or lack thereof) during the class period",
      "Evidence of third-party pixels on the website (e.g., FullStory, Mouseflow, Meta Pixel, Google Analytics with enhanced data) — network request logs or public audits",
      "Any call recording or transcription of phone calls with the defendant",
      "Website session-replay technology audit reports (e.g., from Privacy Sandbox or similar tools)",
      "Credit report showing the defendant pulled plaintiff's data (FCRA inquiry log)",
    ],
    factualQuestionsForIntake: [
      "Were you a California, Florida, or Massachusetts resident when you used the defendant's website or called them?",
      "Did you submit personal or financial information on the defendant's website (Credit.com, Lexington Law, etc.)?",
      "Did you speak with anyone from the defendant by phone? Were you told the call was recorded?",
      "Did you see any notice that the website tracked your session or shared your data with third parties?",
    ],
    redFlags: [
      "California all-party consent standard — if both parties consented (e.g., clear notice in terms), the claim fails",
      "Federal Wiretap Act preemption argument — defendant may claim federal law governs",
      "Statute of limitations: 1 year in CA (short — act quickly); 3 years in FL",
      "Class certification is difficult for CIPA: individualized consent issues can defeat commonality",
    ],
  },
  FL_FTSA: {
    statute: "FL Stat. § 501.059 (Florida Telephone Solicitation Act)",
    perViolation: "$500 per violation or actual damages, whichever is greater (up to $1,500 willful) PLUS prevailing-party attorneys' fees and costs — federal TCPA has no fee provision",
    elementsToPlead: [
      "Defendant made or caused to be made an unsolicited telephonic sales call (telephone call, text message, or voicemail transmission) soliciting a sale of consumer goods or services",
      "Call used an automated system for the SELECTION AND DIALING of telephone numbers, or played a recorded message — the 2023 amendment changed 'or' to 'and', so auto-dialing a human-curated list alone may not qualify",
      "No prior express written consent: a signed writing (electronic/digital signature, checking a box, or an affirmative text/email reply qualifies) that lists the authorized number and contains a clear and conspicuous disclosure authorizing automated calls or texts",
      "Call was 'unsolicited' — not within a statutory carve-out: response to plaintiff's express request, primarily in connection with an EXISTING DEBT or incomplete contract, prior or existing business relationship, or newspaper-publisher calls",
      "TEXT CLAIMS ONLY — STOP safe harbor (2023 amendment): plaintiff replied 'STOP' and defendant continued texting more than 15 days after the opt-out; failure to plead this is fatal to a text claim",
      "Applies to intrastate AND interstate calls; a FL area code is PRESUMED to reach a FL resident regardless of where the caller or consumer actually is",
    ],
    documentsToCollect: [
      "Phone records showing calls from the defendant to plaintiff's number",
      "Text message logs (screenshots with timestamps and sender IDs)",
      "Plaintiff's 'STOP' reply and every message received after it — timestamps prove the 15-day safe harbor lapsed",
      "Any consent form or opt-in record — or evidence that none exists",
      "Evidence the call solicited a sale (script, message content) rather than collecting an existing debt",
      "Any written complaints, cease-and-desist letters, or opt-out requests sent to defendant",
    ],
    factualQuestionsForIntake: [
      "What phone number were the calls made to? (A FL area code is presumed a FL resident — FL residency also works for non-FL area codes)",
      "Was the call or text trying to SELL you something, or was it about a debt or account you already had? (Existing-debt calls are exempt)",
      "For texts: did you reply 'STOP'? When? Did the texts continue for more than 15 days afterward?",
      "How many calls or texts did you receive from the defendant?",
      "Did you ever sign anything (or check a box online) consenting to automated calls or texts from this company?",
    ],
    redFlags: [
      "Calls primarily in connection with an existing debt or contract are statutorily EXEMPT — collection contact generally cannot support an FTSA claim; the call must be a sales solicitation",
      "Text claims that cannot plead the STOP reply + 15 days of continued texts get dismissed — confirm at intake before filing",
      "2023 amendment requires automated SELECTION AND DIALING — pre-2023 'or' pleadings no longer state a claim for post-amendment calls",
      "If the automated-system element fails, consider § 501.059(5)(b) caller-ID theory (failure to transmit a callable number / no two-way line) or § 501.059(5)(a) FL no-call list — same damages and fee shifting, and the caller-ID theory is where plaintiffs are pivoting post-2023",
      "Statute of limitations: 4 years (F.S. § 95.11(3)(f), same as TCPA)",
      "Plead FTSA ALONGSIDE federal TCPA — the written-consent requirement is statutory (Bradford doesn't reach it), texts are covered by name (the federal 'texts aren't calls' split doesn't apply), and fee shifting makes it the economically superior vehicle",
    ],
  },
  FCRA_FURNISHER: {
    statute: "15 U.S.C. § 1681s-2(b) (FCRA — Furnisher Liability after Dispute)",
    perViolation: "$100–$1,000 per willful violation; actual damages for negligent violations",
    elementsToPlead: [
      "Defendant is a 'furnisher of information' — it regularly furnishes consumer credit information to credit bureaus",
      "Plaintiff disputed inaccurate information to a credit bureau in writing",
      "The bureau notified the furnisher of the dispute within 5 business days",
      "Defendant failed to conduct a reasonable reinvestigation of the disputed information",
      "Defendant continued to report inaccurate information OR reinserted previously deleted tradelines without proper notice",
      "Defendant's failure was willful (for statutory damages) or at minimum negligent (actual damages)",
    ],
    documentsToCollect: [
      "Full credit reports from all three bureaus (Experian, Equifax, TransUnion) showing the disputed tradeline",
      "Written dispute letter sent to the credit bureau (with certified mail return receipt)",
      "The bureau's reinvestigation response (did it verify? correct? delete?)",
      "Any subsequent credit reports showing the same inaccuracy persisting or reinsertion of deleted items",
      "Adverse action notices (denied credit, higher rates) attributable to the inaccurate reporting",
      "Payment history string showing '9' codes (collection contact events)",
      "Account transfer documents if account was sold from Springleaf to OneMain (§ 1692g notice issues)",
    ],
    factualQuestionsForIntake: [
      "Which creditor or collector reported the inaccurate information?",
      "What specifically is inaccurate — balance, status, payment history, account ownership?",
      "Have you disputed this with the credit bureau in writing? When?",
      "Has the inaccurate item been deleted but then reappeared ('reinsertion')?",
      "Has the inaccuracy caused you to be denied credit, charged higher rates, or denied housing/employment?",
      "Do you have documentation proving the information is wrong (e.g., bankruptcy discharge, satisfaction of debt)?",
    ],
    redFlags: [
      "Private right of action under § 1681s-2(b) requires a prior written dispute to the BUREAU — not just calling the furnisher",
      "Must prove the furnisher failed to investigate after receiving the bureau's dispute notice",
      "Statute of limitations: 2 years from discovery OR 5 years from violation (whichever is later)",
      "If information is technically correct but old, must argue FCRA's 7-year reporting limit instead",
    ],
  },
  UDAAP: {
    statute: "Dodd-Frank § 1031 + § 1036 (CFPB UDAAP); CA UCL/CLRA; FL FDUTPA; NY GBL § 349; MA G.L. ch. 93A",
    perViolation: "Varies by state: $500–$10,000 per violation; CA UCL allows restitution + injunction; MA 93A allows 2×–3× multiplier for willful violations",
    elementsToPlead: [
      "Defendant is a 'covered person' or 'service provider' under Dodd-Frank (or a business under the state UDAP law)",
      "Defendant engaged in an 'unfair, deceptive, or abusive' act or practice",
      "For UNFAIR: practice causes substantial injury, not reasonably avoidable, not outweighed by countervailing benefits",
      "For DECEPTIVE: representation or omission likely to mislead a reasonable consumer in a material way",
      "For ABUSIVE: exploits consumer's lack of understanding or inability to protect their own interests",
      "Plaintiff is a consumer in the relevant state who suffered harm from the practice",
    ],
    documentsToCollect: [
      "Credit repair or financial services contract showing deceptive terms",
      "Marketing materials, advertisements, or website screenshots containing the alleged misrepresentations",
      "Credit reports showing the harm (e.g., inaccurate tradelines, unauthorized inquiries)",
      "Payment records showing fees paid for services that were not rendered as represented",
      "Any communications showing the defendant was aware of the deceptive practice",
      "State AG complaints or CFPB enforcement actions against the same defendant (class-wide evidence)",
    ],
    factualQuestionsForIntake: [
      "What representation did the defendant make that you relied on?",
      "How was the representation untrue or misleading?",
      "What harm did you suffer as a result (financial loss, credit damage, time spent disputing)?",
      "Which state were you a resident of when you entered the agreement or were harmed?",
      "Do you have any written or recorded evidence of the misleading statements?",
    ],
    redFlags: [
      "UDAAP claims often require a showing of actual harm or injury — speculative harm may not suffice",
      "CA UCL unlawful prong requires an underlying statutory violation",
      "Preemption: federal banking regulators may argue OCC or FDIC preempts state UDAP for national banks",
      "Statute of limitations: 4 years for CA UCL; 2 years FL FDUTPA; 3 years NY GBL 349; 4 years MA 93A",
    ],
  },
  ECOA: {
    statute: "15 U.S.C. § 1691 et seq. (Equal Credit Opportunity Act) / Reg B",
    perViolation: "Up to $10,000 individual; class cap $500,000 or 1% of net worth (whichever is less)",
    elementsToPlead: [
      "Defendant is a 'creditor' — regularly extends or arranges consumer credit",
      "Defendant took an adverse action against plaintiff (denial, termination, unfavorable change, or counteroffer)",
      "Defendant failed to provide a required adverse-action notice within 30 days",
      "Notice, if given, was incomplete — missing specific reasons for denial, ECOA statement, or credit score disclosure",
      "Plaintiff suffered actual damages or statutory damages from the failure",
    ],
    documentsToCollect: [
      "All adverse-action notices received (or evidence that none was provided)",
      "Credit application submitted to defendant",
      "Denial letter or email from defendant",
      "Credit reports pulled by defendant (inquiry log)",
      "Any credit score disclosure statement provided (or evidence it was omitted)",
      "Documentation of harm caused by the denial (alternative financing costs, lost opportunity)",
    ],
    factualQuestionsForIntake: [
      "Did you apply for credit with the defendant and get denied or receive unfavorable terms?",
      "Did the defendant send you an adverse-action notice explaining the denial?",
      "If you received a notice, did it include specific reasons for the denial?",
      "Did the notice include your credit score and the factors that affected it?",
      "When did you apply, and when (if ever) did you receive any written notice from the defendant?",
    ],
    redFlags: [
      "ECOA applies to ADVERSE ACTIONS — a creditor who never responded is different from one who responded late",
      "Statute of limitations: 5 years from violation (favorable SOL)",
      "Class definition for adverse-action claims is typically defined by the creditor's batch processes — common proof is strong",
      "Individual damages are capped at $10K but attorneys' fees are available on top",
    ],
  },
  ROSENTHAL: {
    statute: "CA Civil Code § 1788 et seq. (Rosenthal Fair Debt Collection Practices Act)",
    perViolation: "Up to $1,000 statutory damages + actual damages + attorney fees",
    elementsToPlead: [
      "Defendant is a 'debt collector' under the Rosenthal Act (broader than federal FDCPA — includes original creditors in CA)",
      "The debt is a 'consumer debt' (personal, family, or household purpose)",
      "Plaintiff is a 'debtor' under the Rosenthal Act",
      "Defendant engaged in prohibited conduct: harassment, false statements, unfair practices, or failure to provide validation notice",
      "Defendant's conduct occurred in connection with the collection of a consumer debt",
    ],
    documentsToCollect: [
      "All collection letters or notices from the defendant",
      "Phone records and voicemails from the collector",
      "Any written demands or cease-and-desist letters sent to the defendant",
      "Credit reports showing the debt and any reporting changes",
      "Evidence of harassment: excessive call frequency logs, calls at prohibited times, threats",
    ],
    factualQuestionsForIntake: [
      "Were you a California resident when you received the collection contacts?",
      "Who was the original creditor? Was it the original creditor or a third-party collector calling you?",
      "What types of contact did you receive — calls, letters, texts?",
      "Did the collector call before 8am or after 9pm?",
      "Did the collector contact your employer, family members, or neighbors about the debt?",
      "Did they make threats (arrest, lawsuit, wage garnishment) that were false or premature?",
    ],
    redFlags: [
      "Unlike federal FDCPA, Rosenthal applies to original creditors AND third-party collectors in CA",
      "SOL: 1 year from violation (same as FDCPA — short, act quickly)",
      "Must confirm client was CA resident at the time of the violating conduct",
      "Arbitration clauses in the underlying credit agreement may apply to Rosenthal claims",
    ],
  },
  FCCPA: {
    statute: "FL Stat. § 559.55 et seq. (Florida Consumer Collection Practices Act)",
    perViolation: "$1,000 per violation + actual damages + attorney fees",
    elementsToPlead: [
      "Defendant is a 'person' who collects consumer debts in Florida",
      "The debt is a 'consumer debt' (personal, family, or household purpose)",
      "Defendant engaged in prohibited conduct: harassment, false representations, unfair practices, or failure to validate debt",
      "Plaintiff is a 'debtor' under the FCCPA",
      "Defendant's conduct occurred in FL or targeted FL residents",
    ],
    documentsToCollect: [
      "All collection letters, emails, or text messages from the defendant",
      "Phone records showing calls from the defendant (date, time, frequency)",
      "Any written demands or opt-out notices sent to the defendant",
      "Credit reports showing the FL resident's account status with the defendant",
      "Evidence of excessive contact, threats, or third-party disclosure by the defendant",
    ],
    factualQuestionsForIntake: [
      "Were you a Florida resident when you received the collection contacts?",
      "What specific conduct did the collector engage in that felt unfair or deceptive?",
      "Did the collector contact you more than 3 times in a week?",
      "Did the collector disclose your debt to anyone other than you or your attorney?",
      "Were you threatened with legal action that the collector had no actual intention of pursuing?",
      "Did you send a written cease-and-desist letter and did the calls continue?",
    ],
    redFlags: [
      "FCCPA applies to all persons collecting consumer debts in FL (including original creditors) — broader than FDCPA",
      "SOL: 2 years from violation (favorable vs. FDCPA's 1 year)",
      "FL courts have required plaintiff to prove the debt was for personal/family/household purpose",
      "FCCPA claims stack with FDCPA — pursuing both maximizes per-violation recovery",
    ],
  },
  GLBA: {
    statute: "15 U.S.C. § 6801 et seq. (Gramm-Leach-Bliley Act) — Safeguards Rule (16 C.F.R. Part 314)",
    perViolation: "No private right of action under GLBA directly; claims brought as negligence per se, breach of contract, or state unfair trade practices. Estimated per-member credit monitoring value: $100–$2,500.",
    elementsToPlead: [
      "Defendant is a 'financial institution' covered by GLBA",
      "Defendant failed to implement adequate safeguards to protect customers' nonpublic personal information",
      "A data breach or unauthorized disclosure occurred as a result of the inadequate safeguards",
      "Plaintiff's nonpublic personal information was compromised",
      "Plaintiff suffered actual harm: identity theft, fraudulent accounts, credit damage, or mitigation costs",
      "State unfair trade practices claim: defendant's failure to disclose the inadequate safeguards was deceptive",
    ],
    documentsToCollect: [
      "Data breach notification letter received from the defendant",
      "Evidence of unauthorized accounts, credit inquiries, or identity theft linked to the breach",
      "Identity theft report filed with the FTC (identitytheft.gov)",
      "Credit reports showing new/unauthorized accounts opened after the breach",
      "Receipts for credit monitoring or identity protection services purchased post-breach",
      "Any communications from the defendant acknowledging the breach",
    ],
    factualQuestionsForIntake: [
      "Did you receive a data breach notification from the defendant?",
      "Has anyone opened new credit accounts, taken out loans, or filed taxes in your name since the breach?",
      "Did you purchase credit monitoring or identity protection services as a result?",
      "Have you had to dispute unauthorized accounts or inquiries on your credit report?",
      "What specific nonpublic personal information (SSN, account numbers, DOB) was exposed?",
    ],
    redFlags: [
      "GLBA itself has no private right of action — claims must be brought under state law or common law negligence",
      "Plaintiff must show actual harm beyond the mere exposure of data (standing issue post-TransUnion v. Ramirez)",
      "Arbitration clauses in the defendant's account agreements may be enforceable",
      "Statute of limitations varies by state law theory used; typically 2–4 years",
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
// Detect bankruptcy-related side-channel claims:
//   • Automatic stay violation (11 U.S.C. § 362) — collector contacted plaintiff
//     between petition date and discharge
//   • Discharge injunction violation (11 U.S.C. § 524) — collector contacted
//     plaintiff after discharge on a discharged debt
//
// Each violation carries $5,000 minimum statutory damages + actual + punitive
// + attorney fees, and is a separate cause of action from the underlying
// TCPA / FDCPA claim. So a single plaintiff with a discharged Ch 7 and 3
// post-discharge collection contacts could have a $15,000+ floor independent
// of any class action recovery.
function bankruptcyOpportunities(caseRecord, client) {
  if (!client?.bankruptcies?.length) return [];
  const targets = (caseRecord?.defendants || []).map((d) => ({
    id: d.canonicalId,
    name: (d.displayName || "").toLowerCase(),
  }));
  const out = [];
  for (const bk of client.bankruptcies) {
    const filedMs = bk.dateFiled ? Date.parse(bk.dateFiled) : null;
    const dischargedMs = bk.dateDischarged ? Date.parse(bk.dateDischarged) : null;
    if (!filedMs) continue;

    for (const a of (client.creditAccounts || [])) {
      const isDefendant =
        targets.some((t) =>
          (t.id && (a.creditorCanonicalId === t.id || a.originalCreditorCanonicalId === t.id)) ||
          (t.name && a.creditor && a.creditor.toLowerCase().includes(t.name)) ||
          (t.name && a.originalCreditor && a.originalCreditor.toLowerCase().includes(t.name))
        );
      if (!isDefendant) continue;
      const lastActivityMs = a.dateLastActivity ? Date.parse(a.dateLastActivity) : null;
      const lastReportedMs = a.dateLastReported ? Date.parse(a.dateLastReported) : null;
      const ref = lastActivityMs || lastReportedMs;
      if (!ref) continue;

      if (dischargedMs && ref > dischargedMs) {
        out.push({
          claim: "Discharge injunction violation (11 U.S.C. § 524)",
          floor: 5000,
          ceiling: 50000,
          summary: `${a.creditor} had account activity on ${a.dateLastActivity || a.dateLastReported}, AFTER bankruptcy discharge on ${bk.dateDischarged}. Each post-discharge collection contact violates the discharge injunction.`,
          evidence: ["Discharge order", "Account activity records post-discharge", "Plaintiff's affidavit re any contacts received"],
        });
      } else if (ref > filedMs && (!dischargedMs || ref <= dischargedMs)) {
        out.push({
          claim: "Automatic stay violation (11 U.S.C. § 362)",
          floor: 5000,
          ceiling: 50000,
          summary: `${a.creditor} had account activity on ${a.dateLastActivity || a.dateLastReported}, between bankruptcy petition ${bk.dateFiled} and discharge. Each contact during the stay is a separate violation.`,
          evidence: ["Bankruptcy petition + notice-of-filing", "Account activity records during stay period", "Any collection letter or call log"],
        });
      }
    }
  }
  return out;
}

export function claimGuidance(caseRecord, client = null) {
  const caseType = caseRecord?.caseType || "TCPA";
  const baseline = STATUTORY_BASELINE[caseType] || STATUTORY_BASELINE.TCPA;
  const pathway = resolvePathway(caseRecord);
  const seed = seedEntryForCase(caseRecord);
  const bankruptcyOpps = bankruptcyOpportunities(caseRecord, client);

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
    // Side-channel opportunities derived from the client's credit report
    bankruptcyOpportunities: bankruptcyOpps,
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
