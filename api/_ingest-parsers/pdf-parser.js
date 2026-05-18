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

const EXTRACTION_PROMPT = `You are a credit report data extractor. Extract ALL information from the credit report text below into the exact JSON schema provided.

RULES:
- Extract EVERY tradeline / account — credit cards, auto loans, mortgages, student loans, collections, ALL of them. They are ALL potential TCPA defendants.
- For payment history strings: normalise to these codes: C=paid, 1=30d late, 2=60d late, 3=90d late, 4=120d late, 5=150d+ late, 8=repo, 9=collection/CO, -=no data, X=not reported. Left = most recent.
- For TransUnion format: "1" in payment pattern = paid as agreed (→ map to "C"), "2" = 30d (→"1"), "3" = 60d (→"2"), "4" = 90d (→"3"), "5" = 120d+ (→"4"), "X" = not reported.
- Late payment counts: count 1s, 2s, 3s in the normalised string for d30/d60/d90.
- If the report has two consumers (joint report), return consumer[0] for the primary and add consumer2 as a top-level extra field.
- SSN: only the last 4 digits. NEVER store full SSN.
- Dates: ISO YYYY-MM-DD format. If only month/year → use YYYY-MM-01.
- Missing fields → null. Never fabricate data.
- bureauSources: array of which bureaus reported this account, e.g. ["TU","EX","EQ"].
- For collections: creditor = the COLLECTION AGENCY, originalCreditor = the ORIGINAL CREDITOR.
- isCollection: true if this account is in collection, charged off, or "placed for collection".
- responsibility values: "individual", "joint", "co_signer", "authorized_user", "co_applicant".

Return ONLY the JSON object, no markdown fences, no commentary.

SCHEMA:
{
  "reportDate": "YYYY-MM-DD",
  "reportNumber": "string or null",
  "bureau": "TU | EX | EQ | joint | credit_com | unknown",
  "sourceFormat": "pdf",
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
    "employmentHistory": [{ "employer": "", "position": "", "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null", "bureau": "TU|EX|EQ or null" }]
  },
  "accounts": [
    {
      "creditor": "NAME OF LENDER/COLLECTOR",
      "originalCreditor": "null or original creditor for collection accounts",
      "accountNumber": "masked account number",
      "type": "revolving|installment|mortgage|open|collection|other",
      "loanType": "Credit Card|Automobile|Student Loan|Mortgage|Secured|Medical|Other",
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
      "paymentHistory": "CCCCC1CCC",
      "latePayments": { "d30": 0, "d60": 0, "d90": 0 },
      "remarks": [],
      "isCollection": false,
      "amountPlacedForCollection": null,
      "datePlacedForCollection": null,
      "bureauSources": ["TU"]
    }
  ],
  "publicRecords": [
    {
      "type": "bankruptcy_ch7|bankruptcy_ch11|bankruptcy_ch13|civil_judgment|tax_lien_paid|tax_lien_unpaid|other",
      "docket": null,
      "court": null,
      "plaintiff": null,
      "attorney": null,
      "responsibility": "individual",
      "dateFiled": null,
      "dateDischarged": null,
      "dateClosed": null,
      "assets": null,
      "liabilities": null,
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
