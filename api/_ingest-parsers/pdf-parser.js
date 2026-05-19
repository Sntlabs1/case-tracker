// Credit report PDF parser — sends the raw PDF to Claude as a native document.
//
// Claude's API supports PDFs directly (no text extraction needed). This avoids
// the pdf-parse npm module entirely and works better on image-heavy / table
// PDFs like Stretto joint reports where text extraction garbles formatting.
//
// Input:  base64-encoded PDF string
// Output: canonical CreditReport object (buildCreditReport() input shape)

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are extracting a credit report for a TCPA/FDCPA plaintiff law firm. Extract EVERY piece of information.

CRITICAL RULES:
1. ACCOUNTS: Extract EVERY account — open, closed, zero-balance, charged-off, collections, mortgages, auto loans, student loans, store cards, ALL of them. Closed accounts with $0 balance are still TCPA defendants. Do NOT skip them.
2. PAYMENT HISTORY: Normalise to: C=paid, 1=30d-late, 2=60d-late, 3=90d-late, 4=120d-late, 5=150d+, 8=repo, 9=collection/CO, -=no-data, X=not-reported. Left = most recent month.
   For TransUnion "Pmt Pattern": their "1"=paid→"C", "2"=30d→"1", "3"=60d→"2", "4"=90d→"3", "5"=120d+→"4".
3. LATE COUNTS: Count 1s, 2s, 3s in normalised string for d30/d60/d90.
4. EMPLOYMENT: Extract ALL employer records including city, state, dates, bureau.
5. PUBLIC RECORDS: ALL bankruptcies (Ch7/Ch11/Ch13), civil judgments, tax liens. Include court, docket, disposition, dates, assets, liabilities, attorney.
6. LIENS & JUDGMENTS: Use type="civil_judgment" for judgments, "tax_lien_paid"/"tax_lien_unpaid" for liens.
7. INQUIRIES: ALL — hard and soft. Note bureau and type.
8. ADDRESSES: ALL reported addresses with dates and bureau.
9. JOINT REPORTS: Primary consumer → "consumer", second → "consumer2" top-level.
10. CREDIT SCORE: Extract if shown.
11. SSN: ONLY last 4 digits. NEVER full SSN.
12. DATES: ISO YYYY-MM-DD. Month/year only → YYYY-MM-01.
13. AMOUNTS: Numbers only (strip $ and commas). Missing → null.
14. COLLECTIONS: creditor = the COLLECTION AGENCY, originalCreditor = the ORIGINAL CREDITOR they collected for.
15. Never fabricate. Return null for missing fields.

Return ONLY the JSON object. No markdown. No commentary.

SCHEMA:
{
  "reportDate": "YYYY-MM-DD",
  "reportNumber": null,
  "bureau": "TU | EX | EQ | joint | credit_com | unknown",
  "sourceFormat": "pdf",
  "creditScore": null,
  "consumer": {
    "firstName": "",
    "lastName": "",
    "middleName": null,
    "ssnLast4": null,
    "dob": null,
    "emails": [],
    "phoneNumbers": [],
    "currentAddress": { "street": "", "city": "", "state": "", "zip": "" },
    "addressHistory": [{ "street": "", "city": "", "state": "", "zip": "", "from": null, "to": null, "bureau": null }],
    "aliases": [],
    "employmentHistory": [{ "employer": "", "position": "", "city": "", "state": "", "start": null, "end": null, "bureau": null }]
  },
  "consumer2": null,
  "accounts": [
    {
      "creditor": "",
      "originalCreditor": null,
      "accountNumber": "",
      "type": "revolving|installment|mortgage|open|collection|other",
      "loanType": null,
      "status": "open_current|open_past_due|closed_paid|closed_charged_off|in_collection|in_dispute|bankruptcy|unknown",
      "responsibility": "individual|joint|co_signer|authorized_user|co_applicant|unknown",
      "dateOpened": null,
      "dateLastActivity": null,
      "dateLastReported": null,
      "dateClosed": null,
      "balance": null,
      "highCredit": null,
      "creditLimit": null,
      "monthlyPayment": null,
      "pastDue": null,
      "paymentHistory": "",
      "latePayments": { "d30": 0, "d60": 0, "d90": 0 },
      "remarks": [],
      "isCollection": false,
      "amountPlacedForCollection": null,
      "datePlacedForCollection": null,
      "creditorAddress": null,
      "bureauSources": []
    }
  ],
  "publicRecords": [
    {
      "type": "bankruptcy_ch7|bankruptcy_ch11|bankruptcy_ch13|civil_judgment|tax_lien_paid|tax_lien_unpaid|other",
      "docket": null,
      "court": null,
      "plaintiff": null,
      "defendant": null,
      "attorney": null,
      "obligation": null,
      "responsibility": "individual",
      "dateFiled": null,
      "dateDischarged": null,
      "dateClosed": null,
      "assets": null,
      "liabilities": null,
      "disposition": null,
      "bureauSources": []
    }
  ],
  "inquiries": [
    { "creditor": "", "date": null, "type": "hard|soft", "bureau": null }
  ],
  "alerts": [
    { "type": "ssn_mismatch|fraud_alert|identity_theft|address_mismatch|other", "message": "", "bureau": null, "severity": "high|medium|low" }
  ]
}`;

// Parse a credit report PDF given as a base64 string.
// Returns a canonical credit report object ready for buildCreditReport().
export async function parseCreditReportPdfBase64(base64, filename = "report.pdf") {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("base64 string required");
  }

  let parsed;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      }],
    });

    const content = response.content[0]?.text || "";
    const clean = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error(`PDF extraction failed: ${e.message}`);
  }

  parsed.sourceFormat = "pdf";
  parsed.sourceFilename = filename;
  return parsed;
}

// Backward-compat shim — accepts a Buffer and converts to base64 internally.
export async function parseCreditReportPdfBlob(blob, filename = "report.pdf") {
  let base64;
  if (typeof blob === "string") {
    base64 = blob;
  } else if (Buffer.isBuffer(blob)) {
    base64 = blob.toString("base64");
  } else {
    const buf = Buffer.from(await blob.arrayBuffer());
    base64 = buf.toString("base64");
  }
  return parseCreditReportPdfBase64(base64, filename);
}
