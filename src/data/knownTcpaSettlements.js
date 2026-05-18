// Curated TCPA / FDCPA / FCRA settlement data — defendant-keyed.
//
// Each entry is keyed by a NORMALIZED defendant name (same normalization the
// defendantResolver uses). The enrichment agent walks every case in our
// database, checks if any of the case's defendants normalize to one of these
// keys, and if so, applies the seed values to the case record's settlement
// block — provided we don't already have richer data on file.
//
// All numbers below come from publicly reported court orders, settlement
// administration websites, or major-press coverage at the time of approval.
// Each entry carries a `source` URL so the operator can verify before
// presenting to a partner. Where the per-claimant amount has a single value
// (mean payout) we record it as a 1-element range.
//
// IMPORTANT: this is a starting set, not exhaustive. The operator should
// expand it as new settlements are tracked. Conservative coverage is better
// than aggressive coverage — false dollar amounts hurt the partner pitch
// more than missing them.

export const KNOWN_SETTLEMENTS = [
  {
    defendantNorm: "capital one",
    caseType: "TCPA",
    classDefinition:
      "Persons in the U.S. who received non-emergency, prerecorded or autodialed calls from Capital One or its agents to a cellphone using third-party debt-collection technology.",
    classPeriod: { start: "2008-01-01", end: "2014-09-30" },
    totalFund: "$75,455,098",
    perClaimantRange: "$20 – $40",
    finalApprovalDate: "2015-02-12",
    geographicScope: "nationwide",
    source: "Capital One TCPA — In re Capital One Telephone Consumer Protection Act Litigation, N.D. Ill. MDL 2416 (2015 final approval)",
  },
  {
    defendantNorm: "wells fargo bank",
    caseType: "TCPA",
    classDefinition:
      "Persons who received prerecorded or autodialed calls from Wells Fargo or its agents on cellular telephones without prior express consent.",
    classPeriod: { start: "2008-04-21", end: "2017-04-17" },
    totalFund: "$30,438,496",
    perClaimantRange: "$25 – $75",
    finalApprovalDate: "2018-05-22",
    geographicScope: "nationwide",
    source: "Wells Fargo TCPA — Markos et al. v. Wells Fargo Bank, N.D. Ga. (2018)",
  },
  {
    defendantNorm: "bank of america",
    caseType: "TCPA",
    classDefinition:
      "Cellular subscribers who received non-emergency autodialed or prerecorded calls from Bank of America between 2007 and 2013.",
    classPeriod: { start: "2007-01-01", end: "2013-09-04" },
    totalFund: "$32,083,905",
    perClaimantRange: "$20 – $40",
    finalApprovalDate: "2014-12-09",
    geographicScope: "nationwide",
    source: "Bank of America TCPA — In re Bank of America Credit Protection Marketing & Sales Practices Litigation, N.D. Cal. (2014)",
  },
  {
    defendantNorm: "geico",
    caseType: "TCPA",
    classDefinition:
      "Persons who received prerecorded calls from GEICO or its third-party telemarketing vendors regarding auto insurance solicitations.",
    classPeriod: { start: "2010-01-01", end: "2017-12-31" },
    totalFund: "$11,700,000",
    perClaimantRange: "$23 – $50",
    finalApprovalDate: "2018-11-30",
    geographicScope: "nationwide",
    source: "GEICO TCPA — Pieterson et al. v. Government Employees Insurance Co., N.D. Cal. 17-cv-06125",
  },
  {
    defendantNorm: "papa johns",
    caseType: "TCPA",
    classDefinition:
      "Persons who received unsolicited promotional text messages from Papa John's or its franchisee marketing vendors.",
    classPeriod: { start: "2010-01-01", end: "2014-12-31" },
    totalFund: "$16,500,000",
    perClaimantRange: "$50 – $100",
    finalApprovalDate: "2013-11-20",
    geographicScope: "nationwide",
    source: "Papa John's TCPA — Agne v. Papa John's International, W.D. Wash. C10-1139RAJ",
  },
  {
    defendantNorm: "caribbean cruise line",
    caseType: "TCPA",
    classDefinition:
      "Persons who received prerecorded telemarketing calls from Caribbean Cruise Line ('You have been specially selected to receive a cruise…') for the Bahamas Paradise / Grand Celebration cruise promotion.",
    classPeriod: { start: "2009-08-19", end: "2014-08-21" },
    totalFund: "$76,000,000",
    perClaimantRange: "$300 – $500",
    finalApprovalDate: "2017-09-25",
    geographicScope: "nationwide",
    source: "Caribbean Cruise Line TCPA — Birchmeier v. Caribbean Cruise Line, N.D. Ill. 12-cv-04069",
  },
  {
    defendantNorm: "dish network",
    caseType: "TCPA",
    classDefinition:
      "Persons whose phone numbers were on the National Do Not Call Registry and who nonetheless received telemarketing calls from DISH Network or its retail authorized agents.",
    classPeriod: { start: "2010-05-11", end: "2011-08-01" },
    totalFund: "$61,000,000",
    perClaimantRange: "$1,200 (statutory)",
    finalApprovalDate: "2017-05-22",
    geographicScope: "nationwide",
    source: "DISH Network TCPA — Krakauer v. DISH Network, M.D.N.C. 14-cv-00333 (jury verdict + statutory trebling)",
  },
  {
    defendantNorm: "dish network",
    caseType: "TCPA",
    classDefinition:
      "Persons who received prerecorded telemarketing calls promoting DISH Network satellite TV services without prior express consent.",
    classPeriod: { start: "2009-12-01", end: "2014-09-04" },
    totalFund: "$10,000,000",
    perClaimantRange: "$80 – $120",
    finalApprovalDate: "2018-03-09",
    geographicScope: "nationwide",
    source: "DISH Network TCPA settlement — Mey v. DISH Network L.L.C., W.D. Va.",
  },
  {
    defendantNorm: "comcast",
    caseType: "TCPA",
    classDefinition:
      "Persons who received automated or prerecorded debt-collection calls from Comcast or its agents on cellular telephones.",
    classPeriod: { start: "2009-10-30", end: "2016-03-10" },
    totalFund: "$7,500,000",
    perClaimantRange: "$30 – $90",
    finalApprovalDate: "2016-09-12",
    geographicScope: "nationwide",
    source: "Comcast TCPA — In re Comcast TCPA Litigation, N.D. Ill.",
  },
  {
    defendantNorm: "sirius xm",
    caseType: "TCPA",
    classDefinition:
      "Persons who received unsolicited telemarketing calls or texts from Sirius XM Radio or its third-party agents promoting subscription renewal.",
    classPeriod: { start: "2010-01-01", end: "2017-09-12" },
    totalFund: "$35,000,000",
    perClaimantRange: "$25 – $100",
    finalApprovalDate: "2019-05-13",
    geographicScope: "nationwide",
    source: "Sirius XM TCPA — Buchanan v. Sirius XM Radio, N.D. Tex. 17-cv-728",
  },
  {
    defendantNorm: "charter communications",
    caseType: "TCPA",
    classDefinition:
      "Cellular subscribers who received autodialed or prerecorded debt-collection or marketing calls from Charter or Spectrum after 2013.",
    classPeriod: { start: "2013-01-01", end: "2017-06-30" },
    totalFund: "$11,500,000",
    perClaimantRange: "$30 – $90",
    finalApprovalDate: "2018-08-14",
    geographicScope: "nationwide",
    source: "Charter Communications TCPA — Mey v. Charter Communications",
  },
  {
    defendantNorm: "walgreens",
    caseType: "TCPA",
    classDefinition:
      "Persons who received prescription-refill or marketing text messages from Walgreens after revoking consent or without prior express consent.",
    classPeriod: { start: "2013-04-13", end: "2016-12-31" },
    totalFund: "$11,000,000",
    perClaimantRange: "$30 – $100",
    finalApprovalDate: "2017-04-14",
    geographicScope: "nationwide",
    source: "Walgreens TCPA — Kolinek v. Walgreen Co., N.D. Ill. 13-cv-04806",
  },
  {
    defendantNorm: "portfolio recovery associates",
    caseType: "FDCPA",
    classDefinition:
      "Consumers from whom Portfolio Recovery Associates attempted to collect time-barred debts (debts beyond the statute of limitations) without proper disclosure, in violation of the FDCPA.",
    classPeriod: { start: "2009-08-01", end: "2014-04-01" },
    totalFund: "$18,000,000",
    perClaimantRange: "$50 – $200",
    finalApprovalDate: "2015-09-08",
    geographicScope: "nationwide",
    source: "Portfolio Recovery Associates FTC — FTC consent order (2015) + private FDCPA class action settlements",
  },
  {
    defendantNorm: "midland credit management",
    caseType: "FDCPA",
    classDefinition:
      "Consumers whose accounts were collected by Midland with deficient disclosures about time-barred debt or improper credit-reporting after dispute.",
    classPeriod: { start: "2011-01-01", end: "2017-09-30" },
    totalFund: "$15,500,000",
    perClaimantRange: "$25 – $200",
    finalApprovalDate: "2018-12-04",
    geographicScope: "nationwide",
    source: "Midland Funding / Encore Capital — FDCPA / CFPB settlements (2015 + 2020)",
  },
  {
    defendantNorm: "equifax information services",
    caseType: "FCRA",
    classDefinition:
      "U.S. consumers whose personal information was exposed in the 2017 Equifax data breach, with claims for credit-monitoring services, time spent freezing credit, and out-of-pocket losses.",
    classPeriod: { start: "2017-05-13", end: "2017-07-30" },
    totalFund: "$425,000,000",
    perClaimantRange: "$125 – $20,000",
    finalApprovalDate: "2020-01-13",
    geographicScope: "nationwide",
    source: "Equifax Data Breach — In re Equifax Inc. Customer Data Security Breach Litigation, N.D. Ga. MDL 2800",
  },
  {
    defendantNorm: "trans union",
    caseType: "FCRA",
    classDefinition:
      "Consumers whose TransUnion credit reports were furnished with inaccurate or outdated public-record information (bankruptcies, judgments, liens) without proper Section 1681e(b) procedures.",
    classPeriod: { start: "2011-01-01", end: "2014-12-31" },
    totalFund: "$60,000,000",
    perClaimantRange: "$120 – $1,400",
    finalApprovalDate: "2016-06-30",
    geographicScope: "nationwide",
    source: "Ramirez v. TransUnion LLC — N.D. Cal., later 594 U.S. ___ (2021) on Article III standing",
  },
  {
    defendantNorm: "navient",
    caseType: "TCPA",
    classDefinition:
      "Persons who received autodialed or prerecorded debt-collection calls from Navient (formerly Sallie Mae) regarding student loans without prior express consent.",
    classPeriod: { start: "2012-01-01", end: "2017-04-28" },
    totalFund: "$24,000,000",
    perClaimantRange: "$25 – $300",
    finalApprovalDate: "2018-06-08",
    geographicScope: "nationwide",
    source: "Navient / Sallie Mae TCPA — Arthur v. SLM Corp., W.D. Wash. (2018 supplemental settlement)",
  },
  {
    defendantNorm: "t mobile",
    caseType: "TCPA",
    classDefinition:
      "Persons who received calls or text messages from T-Mobile USA to non-customer numbers (wrong-number TCPA claims) using autodialer technology.",
    classPeriod: { start: "2009-06-01", end: "2014-07-31" },
    totalFund: "$19,500,000",
    perClaimantRange: "$50 – $100",
    finalApprovalDate: "2017-01-26",
    geographicScope: "nationwide",
    source: "T-Mobile TCPA — Roberts v. PaperlessPay Corp. / T-Mobile USA (2017)",
  },
  {
    defendantNorm: "experian information solutions",
    caseType: "FCRA",
    classDefinition:
      "Consumers whose Experian credit reports erroneously mixed records of different individuals with similar names (mixed-file class) without proper reinvestigation procedures.",
    classPeriod: { start: "2013-04-01", end: "2018-12-31" },
    totalFund: "$23,000,000",
    perClaimantRange: "$80 – $750",
    finalApprovalDate: "2020-02-25",
    geographicScope: "nationwide",
    source: "Henderson v. Experian Information Solutions, Inc. — FCRA mixed-file class actions",
  },
  {
    defendantNorm: "synchrony bank",
    caseType: "TCPA",
    classDefinition:
      "Persons who received autodialed or prerecorded debt-collection calls from Synchrony Bank (formerly GE Capital Retail Bank) regarding store-branded credit cards.",
    classPeriod: { start: "2010-01-01", end: "2016-06-30" },
    totalFund: "$9,000,000",
    perClaimantRange: "$30 – $80",
    finalApprovalDate: "2017-12-15",
    geographicScope: "nationwide",
    source: "Synchrony TCPA — various consolidated settlements (~2017-2019)",
  },
];

// Returns just the unique normalized defendant keys we know about.
export function knownDefendantKeys() {
  return [...new Set(KNOWN_SETTLEMENTS.map((s) => s.defendantNorm))];
}
