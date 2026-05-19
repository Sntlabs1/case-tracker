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

// Slim prompt — only the fields the TCPA matcher actually needs.
// Full detail (payment history strings, court info, etc.) massively inflates
// output tokens and causes 90-120s timeouts. This version targets ~800-1200
// output tokens and runs in 10-20s.
const EXTRACTION_PROMPT = `Extract this credit report for a TCPA/FDCPA plaintiff law firm.

RULES:
- Include EVERY account (all creditors, open and closed — each is a potential TCPA defendant).
- For collections: creditor = the COLLECTION AGENCY, originalCreditor = who they collected for.
- latePayments: count 30-day-late, 60-day-late, 90+-day-late occurrences from the payment history.
- SSN: last 4 digits ONLY. Dates: YYYY-MM-DD. Amounts: numbers only (no $ or commas). Missing → null.
- Be concise. Omit null/empty/zero fields to save space.
- Return ONLY a JSON object. No markdown, no explanation.

{
  "bureau": "TU|EX|EQ|joint|unknown",
  "creditScore": null,
  "consumer": {
    "firstName": "", "lastName": "", "ssnLast4": null, "dob": null,
    "phoneNumbers": [],
    "currentAddress": { "city": "", "state": "", "zip": "" },
    "addressHistory": [{ "city": "", "state": "", "from": null, "to": null }],
    "employmentHistory": [{ "employer": "", "city": "", "state": "" }]
  },
  "accounts": [
    {
      "creditor": "", "originalCreditor": null,
      "type": "revolving|installment|mortgage|collection|other",
      "status": "open_current|open_past_due|closed_paid|closed_charged_off|in_collection|other",
      "isCollection": false,
      "balance": null, "dateOpened": null, "dateLastActivity": null,
      "latePayments": { "d30": 0, "d60": 0, "d90": 0 }
    }
  ],
  "publicRecords": [
    { "type": "bankruptcy_ch7|bankruptcy_ch13|civil_judgment|tax_lien|other", "dateFiled": null, "disposition": null }
  ],
  "inquiries": [{ "creditor": "", "date": null, "type": "hard|soft" }]
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
