// Credit report PDF parser.
//
// Pass 1: pdf-parse extracts raw text from the PDF buffer.
// Pass 2: Haiku converts the raw text → canonical CreditReport JSON that
//         buildCreditReport() can consume directly.
//
// Handles four PDF shapes seen in practice:
//   A. TransUnion text-based ("TRANSUNION CREDIT REPORT REVIEW") — very
//      structured ASCII; Haiku reads cleanly.
//   B. Experian web-portal PDF — table layout, still machine text.
//   C. Stretto joint / multi-bureau PDF — rich table with TU/EX/EQ columns.
//   D. Generic bureau-style ("SATISFACTORY ACCOUNTS", "ADVERSE ACCOUNTS").
//
// Payment-history codes normalised to our internal scheme:
//   Both "C / OK / 1" (TU text) and "C / 1 / 2" (Stretto) → same schema.
//   C  = paid as agreed
//   1  = 30 days late
//   2  = 60 days late
//   3  = 90 days late
//   4  = 120 days late
//   5  = 150+ days late
//   8  = repossession
//   9  = collection/charge-off
//   -  = no history
//   X  = not reported

import pdfParse from "pdf-parse";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Format detection ────────────────────────────────────────────────────────

function detectFormat(text) {
  const t = text.toUpperCase();
  if (t.includes("TRANSUNION CREDIT REPORT") || t.includes("PMT PATTERN")) return "transunion_text";
  if (t.includes("STRETTO") || t.includes("NON-MORTGAGE LIABILITIES") || t.includes("LIABILITIES WITH BALANCES")) return "stretto_joint";
  if (t.includes("EXPERIAN") && (t.includes("HELPFUL TOOLS") || t.includes("DOCUMENT UPLOAD"))) return "experian_web";
  if (t.includes("ADVERSE ACCOUNTS") || t.includes("SATISFACTORY ACCOUNTS")) return "generic_bureau";
  return "unknown";
}

// ── Haiku extraction prompt ─────────────────────────────────────────────────
//
// Output MUST be valid JSON matching buildCreditReport()'s input shape.
// Haiku is instructed to use null for missing fields and to never invent data.

const EXTRACTION_PROMPT = `You are a credit report data extractor for a plaintiff law firm. Extract EVERY piece of information from the credit report text below. We use this data to identify TCPA/FDCPA/FCRA claims, so completeness is critical.

CRITICAL RULES:
1. ACCOUNTS: Extract EVERY account — open, closed, zero-balance, charged-off, collections, mortgages, auto loans, student loans, store cards, EVERYTHING. Closed accounts with $0 balance are still TCPA defendants (they called during the account relationship). Do NOT skip them.
2. PAYMENT HISTORY: Normalise all formats to: C=paid-as-agreed, 1=30d-late, 2=60d-late, 3=90d-late, 4=120d-late, 5=150d+, 8=repo, 9=collection/charge-off, -=no-data, X=not-reported. Left digit = most recent month. For TransUnion "Pmt Pattern" format: their "1"=paid→our "C", their "2"=30d→our "1", their "3"=60d→our "2", their "4"=90d→our "3", their "5"=120d+→our "4", "X"=X.
3. LATE COUNTS: Count 1s, 2s, 3s in the normalised string for d30/d60/d90 fields.
4. EMPLOYMENT: Extract ALL employment records — employer name, position/title, city/state, hire date, as reported by each bureau. Include all variations (each bureau may report differently).
5. PUBLIC RECORDS: Extract ALL bankruptcies (Ch7/Ch11/Ch13), civil judgments, AND tax liens. For each: court, docket, disposition, dates filed/discharged/closed, assets, liabilities, attorney, plaintiff, defendant.
6. LIENS & JUDGMENTS: If the report has a "Liens and Judgments Search" section, extract every record. Use type="civil_judgment" for judgments and "tax_lien_paid"/"tax_lien_unpaid" for liens.
7. INQUIRIES: Extract ALL — both hard (regular) and soft (account review/promotional). Note the bureau and inquiry type.
8. ADDRESSES: Extract ALL reported addresses with dates (from/to) and which bureau reported each. The full address history is used for geographic eligibility matching.
9. JOINT REPORTS: If two consumers (e.g., Stretto joint report), primary consumer goes in "consumer", second goes in "consumer2" at the top level.
10. CREDIT SCORE: Extract the credit score if shown (e.g., "Your Credit Score is 650" or score table).
11. SSN: ONLY last 4 digits. NEVER extract full SSN.
12. DATES: ISO YYYY-MM-DD. Month/year only → YYYY-MM-01. Missing → null.
13. AMOUNTS: Parse dollar amounts to numbers (remove $, commas). Missing → null.
14. COLLECTIONS: creditor = the COLLECTION AGENCY name, originalCreditor = the ORIGINAL CREDITOR they collected for.
15. Never fabricate. Return null for missing fields.

Return ONLY the JSON object. No markdown. No commentary.

SCHEMA:
{
  "reportDate": "YYYY-MM-DD",
  "reportNumber": "string or null",
  "bureau": "TU | EX | EQ | joint | credit_com | unknown",
  "sourceFormat": "pdf",
  "creditScore": null,
  "consumer": {
    "firstName": "string",
    "lastName": "string",
    "middleName": "string or null",
    "ssnLast4": "4 digits or null",
    "dob": "YYYY-MM-DD or null",
    "emails": [],
    "phoneNumbers": ["+1XXXXXXXXXX"],
    "currentAddress": { "street": "", "city": "", "state": "XX", "zip": "" },
    "addressHistory": [{ "street": "", "city": "", "state": "XX", "zip": "", "from": "YYYY-MM-DD or null", "to": "YYYY-MM-DD or null", "bureau": "TU|EX|EQ or null" }],
    "aliases": [{ "firstName": "", "lastName": "", "type": "maiden|other" }],
    "employmentHistory": [{ "employer": "", "position": "", "city": "", "state": "", "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null", "bureau": "TU|EX|EQ or null" }]
  },
  "consumer2": null,
  "accounts": [
    {
      "creditor": "NAME OF LENDER OR COLLECTION AGENCY",
      "originalCreditor": "null or name of original creditor (for collection accounts)",
      "accountNumber": "masked account number e.g. XXXXXX4645",
      "type": "revolving|installment|mortgage|open|collection|other",
      "loanType": "Credit Card|Automobile|Student Loan|Mortgage|Secured|Medical|Utility|Other",
      "status": "open_current|open_past_due|closed_paid|closed_charged_off|in_collection|in_dispute|bankruptcy|unknown",
      "responsibility": "individual|joint|co_signer|authorized_user|co_applicant|unknown",
      "dateOpened": "YYYY-MM-DD or null",
      "dateLastActivity": "YYYY-MM-DD or null",
      "dateLastReported": "YYYY-MM-DD or null",
      "dateClosed": "YYYY-MM-DD or null",
      "balance": 0,
      "highCredit": 0,
      "creditLimit": 0,
      "monthlyPayment": 0,
      "pastDue": 0,
      "paymentHistory": "CCCCC1CCC (normalised — see rule 2)",
      "latePayments": { "d30": 0, "d60": 0, "d90": 0 },
      "remarks": ["any remarks like ACCOUNT IN DISPUTE, CLOSED BY CONSUMER, etc."],
      "isCollection": false,
      "amountPlacedForCollection": null,
      "datePlacedForCollection": null,
      "creditorAddress": { "street": "", "city": "", "state": "", "zip": "", "phone": "" },
      "bureauSources": ["TU", "EX", "EQ"]
    }
  ],
  "publicRecords": [
    {
      "type": "bankruptcy_ch7|bankruptcy_ch11|bankruptcy_ch13|civil_judgment|tax_lien_paid|tax_lien_unpaid|other",
      "docket": "docket or case number",
      "court": "court name",
      "plaintiff": "plaintiff name",
      "defendant": "defendant name",
      "attorney": "attorney name",
      "obligation": "debt type (e.g. Consumer Debt)",
      "responsibility": "individual|joint",
      "dateFiled": "YYYY-MM-DD or null",
      "dateDischarged": "YYYY-MM-DD or null",
      "dateClosed": "YYYY-MM-DD or null",
      "assets": null,
      "liabilities": null,
      "originalBalance": null,
      "currentBalance": null,
      "disposition": "filed|discharged|dismissed|satisfied",
      "bureauSources": []
    }
  ],
  "inquiries": [
    {
      "creditor": "string",
      "date": "YYYY-MM-DD or null",
      "type": "hard|soft",
      "bureau": "TU|EX|EQ or null"
    }
  ],
  "alerts": [
    {
      "type": "ssn_mismatch|fraud_alert|identity_theft|address_mismatch|other",
      "message": "string",
      "bureau": "TU|EX|EQ or null",
      "severity": "high|medium|low"
    }
  ]
}

CREDIT REPORT TEXT:
`;

// ── Main export ─────────────────────────────────────────────────────────────

export async function parseCreditReportPdf(buffer, filename = "report.pdf") {
  // Step 1: Extract text from PDF
  let rawText;
  try {
    const result = await pdfParse(buffer, {
      // Limit to first 50 pages — most credit reports are < 20 pages.
      max: 50,
    });
    rawText = result.text;
  } catch (e) {
    throw new Error(`PDF text extraction failed: ${e.message}`);
  }

  if (!rawText || rawText.trim().length < 100) {
    throw new Error("PDF appears to be image-only or has no extractable text");
  }

  const format = detectFormat(rawText);

  // Step 2: Haiku structured extraction
  // Truncate to ~60k chars to stay within Haiku context. Most credit reports
  // are 5-15 pages; 60k chars covers ~30+ pages of text.
  const truncated = rawText.slice(0, 60_000);

  let parsed;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      messages: [{ role: "user", content: EXTRACTION_PROMPT + truncated }],
    });
    const content = response.content[0]?.text || "";
    // Strip any accidental markdown fences
    const clean = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error(`Haiku extraction failed: ${e.message}`);
  }

  // Tag the source
  parsed.sourceFormat = "pdf";
  parsed.sourceFilename = filename;
  parsed._detectedFormat = format;

  return parsed;
}

// Convenience: accept a ReadableStream or Buffer (Vercel formData gives a Blob)
export async function parseCreditReportPdfBlob(blob, filename = "report.pdf") {
  const buf = Buffer.from(await blob.arrayBuffer());
  return parseCreditReportPdf(buf, filename);
}
