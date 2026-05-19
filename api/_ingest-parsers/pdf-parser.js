// Credit report PDF parser — sends the raw PDF to Claude as a native document.
//
// Claude's API supports PDFs directly (no text extraction needed). This avoids
// the pdf-parse npm module entirely and works better on image-heavy / table
// PDFs like Stretto joint reports where text extraction garbles formatting.
//
// Input:  base64-encoded PDF string
// Output: canonical CreditReport object (buildCreditReport() input shape)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL     = "https://api.anthropic.com/v1/messages";

async function callClaude(model, max_tokens, messages) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      // pdfs-2024-09-25 beta enables native PDF document blocks on all models
      "anthropic-beta": "pdfs-2024-09-25",
    },
    body: JSON.stringify({ model, max_tokens, messages }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// Repair the two most common LLM JSON bugs: literal control chars inside
// strings and unescaped double-quotes inside string values.
function sanitizeForParse(text) {
  let out = "";
  let inStr = false;
  let prevSlash = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (inStr) {
      if (prevSlash) { out += ch; prevSlash = false; continue; }
      if (ch === "\\") { out += ch; prevSlash = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (code < 0x20) { // literal control char inside string
        if (code === 0x0a) { out += "\\n"; continue; }
        if (code === 0x0d) { out += "\\r"; continue; }
        if (code === 0x09) { out += "\\t"; continue; }
        continue; // drop other control chars
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

// Extraction prompt — fields needed by the TCPA/FDCPA/FCRA matcher.
//
// paymentHistory is back: each '9' in the string is a collection-contact
// event (FDCPA + TCPA violation counter); each '1'/'2'/'3' is a 30/60/90-day
// late. LEFT = most recent month. C=current/paid, -=no data, 8=repo.
//
// Joint reports: some credit bureaus (Stretto, Experian joint) include TWO
// consumer records. We extract both as consumer + consumer2 so the ingest
// path can create two client records from one PDF.
const EXTRACTION_PROMPT = `Extract this credit report for a TCPA/FDCPA/FCRA plaintiff law firm.

RULES:
- Extract EVERY account (open, closed, collections, charged-off — each creditor is a potential defendant).
- For collection accounts: creditor = the COLLECTION AGENCY, originalCreditor = who they collected for.
- latePayments: count how many 30-day, 60-day, and 90+-day late occurrences appear in the payment history.
- paymentHistory: extract the raw payment history string exactly as shown (e.g. "CCCCC1CC9C--"). LEFT = most recent. C=paid/current, 1=30d late, 2=60d, 3=90d, 4=120d, 5=150d, 6=180d, 8=repo/repossession, 9=collection/chargeoff, -=no data. This is CRITICAL for FDCPA violation counting.
- SSN: ONLY the last 4 digits. Never full SSN.
- Dates: YYYY-MM-DD. Month/year only → YYYY-MM-01.
- Amounts: numbers only (strip $ and commas). Missing → null.
- JOINT REPORTS: If the report contains two consumers (e.g. "Sam Sample" AND "Pat Sample"), extract both into consumer and consumer2. If only one consumer, set consumer2 to null.
- Return ONLY a JSON object — no markdown, no explanation, no commentary.

{
  "bureau": "TU|EX|EQ|joint|unknown",
  "creditScore": null,
  "consumer": {
    "firstName": "", "lastName": "", "ssnLast4": null, "dob": null,
    "phoneNumbers": ["include ALL phone numbers listed"],
    "currentAddress": { "street": "", "city": "", "state": "", "zip": "" },
    "addressHistory": [{ "street": "", "city": "", "state": "", "zip": "", "from": null, "to": null }],
    "employmentHistory": [{ "employer": "", "city": "", "state": "", "start": null, "end": null }]
  },
  "consumer2": null,
  "accounts": [
    {
      "creditor": "",
      "originalCreditor": null,
      "accountNumber": "last 4 digits only, or null",
      "type": "revolving|installment|mortgage|collection|other",
      "status": "open_current|open_past_due|closed_paid|closed_charged_off|in_collection|other",
      "isCollection": false,
      "balance": null,
      "creditLimit": null,
      "monthlyPayment": null,
      "dateOpened": null,
      "dateLastActivity": null,
      "paymentHistory": null,
      "latePayments": { "d30": 0, "d60": 0, "d90": 0 }
    }
  ],
  "publicRecords": [
    {
      "type": "bankruptcy_ch7|bankruptcy_ch11|bankruptcy_ch13|civil_judgment|tax_lien_paid|tax_lien_unpaid|other",
      "dateFiled": null,
      "dateDischarged": null,
      "disposition": null,
      "amount": null
    }
  ],
  "inquiries": [
    { "creditor": "", "date": null, "type": "hard|soft" }
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
    // Sonnet with slim schema — targets ~800-1200 output tokens → 10-20s
    const raw = await callClaude(
      "claude-sonnet-4-6",
      4000,
      [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }]
    );

    if (!raw || !raw.trim()) throw new Error("Model returned empty response");

    const clean = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    // Repair common LLM JSON bugs (unescaped quotes, literal newlines in strings)
    const repaired = sanitizeForParse(clean);
    parsed = JSON.parse(repaired);
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
