// Per-connection intake questionnaire generator.
//
// The credit.com data is thin (name/phone/email/state only — no DOB, address, or
// SSN) and stale (mostly 2017-2019). So for every person->defendant connection we
// can SUGGEST a claim but cannot CONFIRM it. This module turns each connection
// into a client-ready list of questions whose answers fill exactly the gaps that
// decide eligibility:
//   1. Identity   — confirm we have the right person (data lacks DOB/address/SSN)
//   2. Timing     — confirm CURRENT status (data is stale; an answer of "they're
//                   still collecting/reporting" can revive a facially time-barred
//                   connection via the ongoing-conduct theory)
//   3. Conduct    — the case-specific facts we never have (harassment, inaccuracy,
//                   post-discharge collection, repossession notice, etc.)
//
// Pure (no IO). Render at read time from a client:* record.

// Asked once per claimant (not per connection).
const IDENTITY_QUESTIONS = [
  "Please confirm your full legal name (and any other names you've used).",
  "What is your current mailing address?",
  "What is your date of birth?",
  "What is the best phone number and email to reach you?",
  "The last 4 digits of your SSN (optional, but it helps us confirm these accounts are actually yours).",
];

// Asked once per claimant, at the close.
const CLOSING_QUESTIONS = [
  "Did you ever sign anything agreeing to settle disputes through arbitration with any of these companies?",
  "Are you already represented by another attorney for any of these matters?",
];

// label, intro, per-defendant questions, documents to request.
const CASE_QUESTIONS = {
  FDCPA: {
    label: "Debt collection (FDCPA)",
    questions: d => [
      `Do you recognize a debt that ${d} contacted you about? Roughly what was it for (credit card, medical, etc.)?`,
      "Was this debt for personal, family, or household purposes (not a business debt)?",
      `How did ${d} contact you — phone calls, letters, texts, or emails?`,
      `When did ${d} most recently contact you about it? (an approximate month/year)`,
      `Did ${d} ever do any of these: call many times a day, call before 8am or after 9pm, threaten you, contact your employer/family/friends, keep contacting you after you asked them to stop, claim you owed a different amount, or threaten a lawsuit they didn't file?`,
      "Is this debt actually yours, or could it be a mistake or identity mix-up?",
    ],
    documents: ["Any collection letters, voicemails, or texts", "The most recent statement showing the balance"],
  },
  FCRA: {
    label: "Credit reporting error (FCRA)",
    questions: d => [
      `Is what ${d} is reporting about you on your credit report wrong in any way — wrong balance, not your account, already paid, or discharged in bankruptcy?`,
      "Did you formally dispute it with a credit bureau (Equifax, Experian, or TransUnion)? If so, roughly when, and did they fix it?",
      `Is the incorrect ${d} information STILL showing on your credit report today?`,
      "Did this cost you anything — a denied loan, apartment, or job, a higher interest rate, or other harm?",
    ],
    documents: ["A current copy of your credit report showing the item", "Any dispute letters and the bureau's responses"],
  },
  DischargeViolation: {
    label: "Collecting on a discharged debt (bankruptcy)",
    questions: d => [
      "Did you file for bankruptcy? Which chapter (7 or 13), and roughly when?",
      "Was your bankruptcy completed/discharged? Approximately when?",
      `Was the ${d} debt included in that bankruptcy?`,
      `After your discharge, did ${d} keep trying to collect, send statements, or report a balance still owed?`,
      `Is ${d} still showing this debt as owed or with a balance on your credit report now?`,
    ],
    documents: ["Your bankruptcy discharge order", "The schedules listing your debts", "Any letters/statements received after discharge", "A current credit report"],
  },
  AutoLending: {
    label: "Auto loan / repossession",
    questions: d => [
      `Did you finance or lease a vehicle through ${d}? Roughly when?`,
      "Was the vehicle repossessed? If so, when?",
      `Before the repossession or sale, did ${d} send you written notice?`,
      `Did ${d} pursue you for a remaining balance (a "deficiency") after taking the car?`,
      "Were there fees or add-ons (GAP, warranties) or terms you didn't agree to or weren't told about?",
      "What state did you sign the loan in?",
    ],
    documents: ["Your retail installment / loan contract", "Any repossession or sale notices", "Payment records"],
  },
  StudentLoan: {
    label: "Student loan servicing",
    questions: d => [
      `Were your student loans serviced by ${d}? Federal or private?`,
      `Did ${d} mishandle anything — misapply payments, mess up an income-driven plan or forbearance, or report your loans incorrectly?`,
      `Is ${d} still servicing, reporting, or collecting now?`,
    ],
    documents: ["Servicer statements", "Payment history", "Any correspondence about your account"],
  },
  RESPA: {
    label: "Mortgage servicing (RESPA)",
    questions: d => [
      `Was your mortgage serviced by ${d}?`,
      `Did ${d} mishandle your loan — misapply payments, force-place insurance, mishandle escrow, ignore a written request, or move toward foreclosure improperly?`,
      `Did you send ${d} a written complaint or request for information, and did they respond?`,
      "Roughly when did these problems happen, and are they still ongoing?",
    ],
    documents: ["Mortgage statements", "Your written request and any response", "Escrow statements"],
  },
  UDAP_Payday: {
    label: "Payday / high-cost loan",
    questions: d => [
      `Did you take a loan from ${d}? In what state, and roughly when?`,
      "What was the interest rate or fees — did it seem far higher than expected?",
      "Did you get stuck in repeated rollovers or renewals?",
      `Did ${d} take money from your bank account without clear authorization, or more than agreed?`,
    ],
    documents: ["Your loan agreement", "Bank statements showing the withdrawals"],
  },
  DataBreach: {
    label: "Data breach settlement",
    questions: d => [
      `Did you receive a data-breach notification letter from ${d}? Roughly when?`,
      "Did you experience any fraud, identity theft, or out-of-pocket costs you believe are connected to the breach?",
      "Do you still have the notice letter, or the Class Member ID / PIN it contained?",
      `Would you like us to file a claim in the ${d} settlement on your behalf before the deadline?`,
    ],
    documents: ["The breach notice letter", "Proof of any losses (bank or fraud records)"],
  },
};

// Plain-language status context shown with each connection.
const STATUS_CONTEXT = {
  discharge_ongoing: "Our records suggest this debt may still be reported after a bankruptcy — potentially a live claim with no filing deadline if it's still being reported.",
  live:              "This appears to be within the filing window based on our records — but our data is dated, so we need to confirm current status.",
  live_state_udap:   "This may be filable under your state's consumer-protection law — timing needs confirming.",
  time_barred:       "Based on our (older) records this may be past the federal deadline — BUT if the company is STILL contacting you or STILL reporting it, the claim can be revived. The timing questions below are the most important.",
  undated:           "Our source data has no dates for this account, so confirming when things happened is essential.",
};

// Build the full questionnaire for one client record.
export function buildIntakeQuestionnaire(client) {
  const cases = Array.isArray(client.cases) ? client.cases : [];

  // One connection per (caseType + defendant); keep the best solStatus we have.
  const byKey = new Map();
  for (const c of cases) {
    const key = `${c.caseType}|${c.defendantToken || c.defendant}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, c);
  }

  const rank = { discharge_ongoing: 4, live: 3, live_state_udap: 2, undated: 1, time_barred: 0 };
  const connections = [...byKey.values()].sort(
    (a, b) => (rank[b.solStatus] || 0) - (rank[a.solStatus] || 0)
  );

  const sections = connections.map(c => {
    const tmpl = CASE_QUESTIONS[c.caseType];
    const d = c.defendant || "this company";
    return {
      caseType:    c.caseType,
      label:       tmpl ? tmpl.label : c.caseType,
      defendant:   d,
      solStatus:   c.solStatus,
      lastReported: c.lastReported || null,
      whatWeBelieve: `Your credit file shows a possible ${tmpl ? tmpl.label.toLowerCase() : c.caseType} connection with ${d}` +
                     (c.lastReported ? `, last reported around ${c.lastReported}.` : "."),
      statusContext: STATUS_CONTEXT[c.solStatus] || "",
      questions:   tmpl ? tmpl.questions(d) : [`Do you recognize an account or debt involving ${d}? When, and what happened?`],
      documentsToProvide: tmpl ? tmpl.documents : [],
    };
  });

  return {
    claimantId:   client.id,
    name:         client.name || null,
    state:        client.state || null,
    actionable:   client.actionable ?? null,
    intro:        "To confirm whether you may have a claim, please answer the questions below. " +
                  "Our records are based on older credit data, so a few of these confirm details we can't see — " +
                  "especially the timing and whether each company is still involved.",
    identityQuestions: IDENTITY_QUESTIONS,
    connections:  sections,
    closingQuestions:  CLOSING_QUESTIONS,
    connectionCount: sections.length,
  };
}

// Flatten to a single ordered, sendable list of questions (for a simple message).
export function flattenQuestionnaire(q) {
  const out = [];
  out.push("CONFIRM YOUR IDENTITY:");
  q.identityQuestions.forEach(x => out.push(`  - ${x}`));
  q.connections.forEach((s, i) => {
    out.push("");
    out.push(`ABOUT ${s.defendant.toUpperCase()} — ${s.label}:`);
    s.questions.forEach(x => out.push(`  - ${x}`));
    if (s.documentsToProvide.length) out.push(`  (If you have them: ${s.documentsToProvide.join("; ")}.)`);
  });
  out.push("");
  out.push("FINALLY:");
  q.closingQuestions.forEach(x => out.push(`  - ${x}`));
  return out.join("\n");
}
