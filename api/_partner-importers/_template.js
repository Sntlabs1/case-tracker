// Template for adding a new partner importer.
//
// Steps to onboard partner N+2:
//   1. Copy this file to api/_partner-importers/<partner-id>.js
//   2. Update the `normalize` function to map their data shape to ours
//   3. POST to /api/partners with { id: "<partner-id>", name: "Partner Name", ... }
//   4. Done — the Clients tab CSV upload UI picks up the new partner automatically.
//
// The normalize function receives one raw client row from the partner and
// returns an object that buildClientRecord (in api/clients.js) can consume.
// At minimum it needs:
//   - firstName, lastName (or full name field they can split)
//   - phone / email (used for dedup)
//   - state (used for state-based case matching)
//   - partnerId (REQUIRED — set to this partner's id)
//   - ingestSource (string, partner display name)
// Optional but high-value:
//   - collectionsHistory[] (creditor, dateRange) — drives TCPA defendant matching
//   - addressHistory[] (state, city, dateRange) — drives residency/period matching
//   - dob, age, tcpaOptOut, contactRights, sourceFirm

function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export default function normalize(c) {
  // ── Customize this block for the partner's actual field names. ──────────

  const phones = []
    .concat(c.phone, c.phone_number, c.mobile, c.cell)
    .filter(Boolean)
    .map(normalizePhone)
    .filter(Boolean);

  return {
    firstName:    c.firstName || c.first_name || "",
    lastName:     c.lastName  || c.last_name  || "",
    email:        c.email     || "",
    phone:        phones[0]   || "",
    phoneNumbers: phones,
    state:        (c.state || "").toUpperCase().slice(0, 2),
    city:         c.city || "",
    dob:          c.dob || c.date_of_birth || null,

    // REQUIRED — change "your_partner_id" to match the id you'll register.
    partnerId:    "your_partner_id",
    ingestSource: "Your Partner Display Name",

    contactRights: {
      source:    "Your Partner partnership",
      scopeNote: c.scopeNote || "Partner has consent to contact for partnership-relevant matters.",
    },
    tcpaOptOut: c.tcpaOptOut === true,
  };
}
