// Canonical field-mapping helpers for the TCPA/FDCPA/FCRA ingest pipeline.
//
// Each source (CourtListener, UniCourt, Trellis, RSS feeds) returns its own
// shape. This module converts those shapes into the input format expected by
// tcpaSchema.buildCase(). Keeps the per-source modules thin and consistent.

// Federal district court ID → US state code.
// Maps CourtListener court IDs (e.g. "cand", "nysd") to two-letter state codes.
// Source: https://www.courtlistener.com/api/rest/v4/courts/?jurisdiction=FD
export const FEDERAL_COURT_TO_STATE = {
  // Alabama
  almb: "AL", almd: "AL", alnb: "AL", alnd: "AL", alsb: "AL", alsd: "AL",
  // Alaska
  akb: "AK", akd: "AK",
  // Arizona
  arb: "AZ", ard: "AZ", azb: "AZ", azd: "AZ",
  // Arkansas
  areb: "AR", ared: "AR", arwb: "AR", arwd: "AR",
  // California
  cacb: "CA", cacd: "CA", caeb: "CA", caed: "CA", canb: "CA", cand: "CA",
  casb: "CA", casd: "CA",
  // Colorado
  cob: "CO", cod: "CO",
  // Connecticut
  ctb: "CT", ctd: "CT",
  // Delaware
  deb: "DE", ded: "DE",
  // District of Columbia
  dcb: "DC", dcd: "DC",
  // Florida
  flmb: "FL", flmd: "FL", flnb: "FL", flnd: "FL", flsb: "FL", flsd: "FL",
  // Georgia
  gamb: "GA", gamd: "GA", ganb: "GA", gand: "GA", gasb: "GA", gasd: "GA",
  // Hawaii
  hib: "HI", hid: "HI",
  // Idaho
  idb: "ID", idd: "ID",
  // Illinois
  ilcb: "IL", ilcd: "IL", ilnb: "IL", ilnd: "IL", ilsb: "IL", ilsd: "IL",
  // Indiana
  innb: "IN", innd: "IN", insb: "IN", insd: "IN",
  // Iowa
  ianb: "IA", iand: "IA", iasb: "IA", iasd: "IA",
  // Kansas
  ksb: "KS", ksd: "KS",
  // Kentucky
  kyeb: "KY", kyed: "KY", kywb: "KY", kywd: "KY",
  // Louisiana
  laeb: "LA", laed: "LA", lamb: "LA", lamd: "LA", lawb: "LA", lawd: "LA",
  // Maine
  meb: "ME", med: "ME",
  // Maryland
  mdb: "MD", mdd: "MD",
  // Massachusetts
  mab: "MA", mad: "MA",
  // Michigan
  mieb: "MI", mied: "MI", miwb: "MI", miwd: "MI",
  // Minnesota
  mnb: "MN", mnd: "MN",
  // Mississippi
  msnb: "MS", msnd: "MS", mssb: "MS", mssd: "MS",
  // Missouri
  moeb: "MO", moed: "MO", mowb: "MO", mowd: "MO",
  // Montana
  mtb: "MT", mtd: "MT",
  // Nebraska
  nebraskab: "NE", ned: "NE",
  // Nevada
  nvb: "NV", nvd: "NV",
  // New Hampshire
  nhb: "NH", nhd: "NH",
  // New Jersey
  njb: "NJ", njd: "NJ",
  // New Mexico
  nmb: "NM", nmd: "NM",
  // New York
  nyeb: "NY", nyed: "NY", nynb: "NY", nynd: "NY", nysb: "NY", nysd: "NY",
  nywb: "NY", nywd: "NY",
  // North Carolina
  nceb: "NC", nced: "NC", ncmb: "NC", ncmd: "NC", ncwb: "NC", ncwd: "NC",
  // North Dakota
  ndb: "ND", ndd: "ND",
  // Ohio
  ohnb: "OH", ohnd: "OH", ohsb: "OH", ohsd: "OH",
  // Oklahoma
  okeb: "OK", oked: "OK", oknb: "OK", oknd: "OK", okwb: "OK", okwd: "OK",
  // Oregon
  orb: "OR", ord: "OR",
  // Pennsylvania
  paeb: "PA", paed: "PA", pamb: "PA", pamd: "PA", pawb: "PA", pawd: "PA",
  // Puerto Rico
  prb: "PR", prd: "PR",
  // Rhode Island
  rib: "RI", rid: "RI",
  // South Carolina
  scb: "SC", scd: "SC",
  // South Dakota
  sdb: "SD", sdd: "SD",
  // Tennessee
  tneb: "TN", tned: "TN", tnmb: "TN", tnmd: "TN", tnwb: "TN", tnwd: "TN",
  // Texas
  txeb: "TX", txed: "TX", txnb: "TX", txnd: "TX", txsb: "TX", txsd: "TX",
  txwb: "TX", txwd: "TX",
  // Utah
  utb: "UT", utd: "UT",
  // Vermont
  vtb: "VT", vtd: "VT",
  // Virginia
  vaeb: "VA", vaed: "VA", vawb: "VA", vawd: "VA",
  // Washington
  waeb: "WA", waed: "WA", wawb: "WA", wawd: "WA",
  // West Virginia
  wvnb: "WV", wvnd: "WV", wvsb: "WV", wvsd: "WV",
  // Wisconsin
  wieb: "WI", wied: "WI", wiwb: "WI", wiwd: "WI",
  // Wyoming
  wyb: "WY", wyd: "WY",
};

// Detect case type from a cause-of-action string (CourtListener `cause` field
// or any free-text complaint description).
// Returns "TCPA", "FDCPA", "FCRA", "TCPA+FDCPA", or null.
export function detectCaseType(cause = "", natureOfSuit = "") {
  const c = String(cause || "").toLowerCase();
  const hasTcpa = /\b(?:47[:\s]+227|telephone\s+consumer|tcpa)\b/.test(c);
  const hasFdcpa = /\b(?:15[:\s]+1692|fair\s+debt\s+collection|fdcpa)\b/.test(c);
  const hasFcra = /\b(?:15[:\s]+1681|fair\s+credit\s+reporting|fcra)\b/.test(c);
  if (hasTcpa && hasFdcpa) return "TCPA+FDCPA";
  if (hasTcpa) return "TCPA";
  if (hasFdcpa) return "FDCPA";
  if (hasFcra) return "FCRA";
  // NOS-only fallback: 890 → likely TCPA, 480 → likely FDCPA/FCRA but ambiguous.
  if (String(natureOfSuit) === "890") return "TCPA";
  return null;
}

// "Smith v. Capital One Bank, N.A." → ["Capital One Bank, N.A."]
// "Doe et al. v. ABC Corp.; XYZ Inc." → ["ABC Corp.", "XYZ Inc."]
// Heuristic; for noisy captions the source-specific module should override.
export function parseDefendantsFromCaption(caption = "") {
  if (!caption) return [];
  const m = caption.match(/\sv\.?\s+(.+)$/i);
  if (!m) return [];
  const tail = m[1]
    .replace(/\s+et\s+al\.?\s*$/i, "")
    .trim();
  // Split on semicolons or " and " conjunction; not commas (corporate names use them).
  return tail
    .split(/\s*;\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Smith v. Capital One Bank, N.A." → ["Smith"]
// "Smith et al. v. Capital One"      → ["Smith"]
// "In re Acme TCPA Litigation"        → []  (MDL captions have no individual plaintiff)
// "John Doe and Jane Doe v. Acme"     → ["John Doe", "Jane Doe"]
//
// Companion to parseDefendantsFromCaption — extracts the LEFT side of "v."
// Strips "et al." and class-action notation. Returns at most 4 names to
// avoid pathological captions blowing up the index.
export function parsePlaintiffsFromCaption(caption = "") {
  if (!caption) return [];
  // Skip MDL / In re / case-name patterns that don't have a named plaintiff
  if (/^\s*(?:in\s+re|matter\s+of)\b/i.test(caption)) return [];
  const m = caption.match(/^(.+?)\sv\.?\s+/i);
  if (!m) return [];
  const head = m[1]
    .replace(/\s+et\s+al\.?\s*$/i, "")
    .replace(/,\s*(?:individually|on\s+behalf\s+of|et\s+al|class\s+representative).*$/i, "")
    .replace(/,?\s+as\s+representative.*$/i, "")
    .trim();
  // Split conjunctions but NOT commas (last names can be followed by middle initials etc.)
  const names = head
    .split(/\s*;\s*|\s+and\s+|\s+&\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.length >= 2 && s.length <= 80)
    .slice(0, 4);
  return names;
}

// Normalize a plaintiff name for indexing: lowercase, strip punctuation,
// collapse whitespace. NOT applied to defendants — those have their own
// canonical normalization in defendantResolver. Used as the key in the
// tcpa:cases_by_plaintiff:${norm} inverted index.
export function normalizePlaintiff(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[.,'"]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// CourtListener docket → buildCase() input.
// Accepts both the resource shape (snake_case: case_name, date_filed,
// nature_of_suit) and the search-API shape (camelCase: caseName, dateFiled,
// natureOfSuit). The two endpoints return overlapping but not identical fields.
//
// When `assumeCaseType` is passed (e.g. by a search-API caller that's already
// constrained on caseType), we skip the cause-string detection — the search
// query was the filter, not the cause field.
export function fromCourtListener(docket, { assumeCaseType } = {}) {
  // Prefer court_id (short slug like "cacd") — the search API also returns
  // a `court` field but as a full display name ("District Court, C.D. Cal.")
  // which doesn't match the FEDERAL_COURT_TO_STATE map.
  const courtId =
    docket.court_id ||
    (typeof docket.court === "string" && /^[a-z]{2,8}$/.test(docket.court) ? docket.court : "") ||
    docket.court?.id ||
    "";
  const courtName =
    docket.court_name ||
    docket.courtName ||
    (typeof docket.court === "string" ? docket.court : "") ||
    courtId;
  const caption =
    docket.case_name ||
    docket.caseName ||
    docket.case_name_full ||
    docket.caseNameFull ||
    "";
  const cause = docket.cause || "";
  const nosRaw = docket.nature_of_suit ?? docket.natureOfSuit ?? "";
  const nos = String(nosRaw).replace(/\D/g, "") || null;
  const caseType = assumeCaseType || detectCaseType(cause, nos);
  if (!caseType) return null;

  const dateTerminated = docket.date_terminated || docket.dateTerminated;
  const dateFiled = docket.date_filed || docket.dateFiled;
  const dateLast = docket.date_last_filing || docket.dateLastFiling;
  const docketNum = docket.docket_number || docket.docketNumber || "";
  // TCPA class actions almost never get dismissed on the merits — they settle.
  // CourtListener marks a case terminated once it concludes (settlement OR
  // dismissal). We can't distinguish from the docket header alone, so use
  // "settled" rather than "dismissed" — the settlement-enrichment agent will
  // promote it to "claim_open" when it finds an active claim window. Marking
  // as dismissed would silently bury these cases from matching entirely.
  const status = dateTerminated ? "settled" : "active";
  const state = FEDERAL_COURT_TO_STATE[courtId] || "";
  const dockId = docket.id || docket.docket_id || docket.docketId;
  if (!dockId) return null;

  return {
    id: `cl_${dockId}`,
    caption,
    caseType,
    defendants: parseDefendantsFromCaption(caption),
    plaintiffs: parsePlaintiffsFromCaption(caption),
    court: {
      name: courtName,
      jurisdiction: "federal",
      state,
      district: courtId,
      docket: docketNum,
      citation: "",
    },
    natureOfSuit: nos,
    filingDate: dateFiled || null,
    lastDocketDate: dateLast || dateFiled || null,
    status,
    conductDescription: cause,
    geographicScope: "nationwide",
    eligibleStates: [],
    source: "CourtListener",
    sourceUrl: (() => {
      const u = docket.absolute_url || docket.docket_absolute_url || "";
      if (!u) return "";
      return u.startsWith("http") ? u : `https://www.courtlistener.com${u}`;
    })(),
  };
}
