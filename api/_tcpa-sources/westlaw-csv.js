// Westlaw CSV bulk seeder.
//
// Reads Westlaw Edge "Save to CSV" exports from the working dir and ingests
// them as TCPA / FDCPA / FCRA cases. Westlaw's export gives us much higher
// signal per row than the CourtListener docket feed: case captions, court
// lines, citations, docket numbers, and 1-3 paragraph editor-written summaries
// describing the conduct alleged. That's the seed corpus the platform is
// built on, and the state-law variants (FL Telephone Solicitation Act, MD
// TCPA, OK TSA, etc.) are not reachable through CourtListener at all.
//
// Trigger via the existing orchestrator:
//   GET /api/tcpa-ingest?source=westlaw-csv
//
// Production note: Westlaw redistribution is bounded by their ToS, and the
// raw exports include session-scoped URLs. The CSVs are intentionally NOT
// committed to git — this runner reads them from the local filesystem and
// will silently no-op in production where the files don't ship with the
// deploy. Use it from `vite dev` (with the vercel-api-plugin), or invoke
// from a one-shot script.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import {
  detectCaseType,
  parseDefendantsFromCaption,
  parsePlaintiffsFromCaption,
} from "../../src/lib/ingest/tcpaIngestNormalize.js";
import {
  normalize as normalizeDefendantName,
  createDefendant,
} from "../../src/lib/ingest/defendantResolver.js";

// ── Config ───────────────────────────────────────────────────────────────────
const DEFAULT_CSV_DIRS = [process.cwd(), join(process.cwd(), "dev")];
const STATS_KEY = "tcpa:ingest:westlaw-csv:stats";
const CHECKPOINT_KEY = "tcpa:ingest:westlaw-csv:checkpoint";

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Minimal RFC-4180 parser. Handles quoted fields, embedded commas, escaped
// quotes (`""`), and UTF-8 BOM. The Westlaw export uses CRLF and a UTF-8 BOM
// on the first row.
function parseCSV(text) {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\r") { /* swallow */ }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  // Drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every(c => !c.trim())) rows.pop();
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const body = rows.slice(1).map(arr => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (arr[i] ?? "").trim(); });
    return obj;
  });
  return { headers, rows: body };
}

// ── Court Line parsing ───────────────────────────────────────────────────────
// "United States District Court, M.D. Florida, Tampa Division."
//   → { name: full, jurisdiction: "federal", state: "FL", district: "M.D." }
// "Supreme Court of New York, Monroe County."
//   → { name: full, jurisdiction: "state",  state: "NY", district: "" }
// "United States Court of Appeals, Tenth Circuit."
//   → { name: full, jurisdiction: "federal", state: "",  district: "" }

const STATE_NAME_TO_CODE = {
  Alabama:"AL", Alaska:"AK", Arizona:"AZ", Arkansas:"AR", California:"CA",
  Colorado:"CO", Connecticut:"CT", Delaware:"DE", Florida:"FL", Georgia:"GA",
  Hawaii:"HI", "Hawai'i":"HI", Idaho:"ID", Illinois:"IL", Indiana:"IN",
  Iowa:"IA", Kansas:"KS", Kentucky:"KY", Louisiana:"LA", Maine:"ME",
  Maryland:"MD", Massachusetts:"MA", Michigan:"MI", Minnesota:"MN",
  Mississippi:"MS", Missouri:"MO", Montana:"MT", Nebraska:"NE", Nevada:"NV",
  "New Hampshire":"NH", "New Jersey":"NJ", "New Mexico":"NM", "New York":"NY",
  "North Carolina":"NC", "North Dakota":"ND", Ohio:"OH", Oklahoma:"OK",
  Oregon:"OR", Pennsylvania:"PA", "Rhode Island":"RI", "South Carolina":"SC",
  "South Dakota":"SD", Tennessee:"TN", Texas:"TX", Utah:"UT", Vermont:"VT",
  Virginia:"VA", Washington:"WA", "West Virginia":"WV", Wisconsin:"WI",
  Wyoming:"WY", "District of Columbia":"DC", "Puerto Rico":"PR",
};

// Short forms that appear in federal designators: "N.Y.", "Cal.", "Fla.",
// "Tex.", "Ill.", "Mass.", "Pa.", "Va.", "Md.", "Mich.", "Ariz." etc.
const SHORT_FORM_TO_CODE = {
  Ala:"AL", Alaska:"AK", Ariz:"AZ", Ark:"AR", Cal:"CA", "Calif":"CA",
  Colo:"CO", Conn:"CT", Del:"DE", Fla:"FL", Ga:"GA", "Haw":"HI", Idaho:"ID",
  Ill:"IL", Ind:"IN", Iowa:"IA", Kan:"KS", "Kans":"KS", Ky:"KY", La:"LA",
  Me:"ME", Md:"MD", Mass:"MA", Mich:"MI", Minn:"MN", Miss:"MS", Mo:"MO",
  Mont:"MT", Neb:"NE", Nev:"NV", "N.H":"NH", "N.J":"NJ", "N.M":"NM",
  "N.Y":"NY", "N.C":"NC", "N.D":"ND", Ohio:"OH", Okla:"OK", "Or":"OR",
  Pa:"PA", "R.I":"RI", "S.C":"SC", "S.D":"SD", Tenn:"TN", Tex:"TX",
  Utah:"UT", Vt:"VT", Va:"VA", Wash:"WA", "W. Va":"WV", "W.Va":"WV",
  Wis:"WI", Wyo:"WY", "D.C":"DC", "P.R":"PR",
};

// Match "M.D. Florida", "S.D.N.Y.", "C.D. Cal.", "E.D. Tex.", "N.D. Ill."
// Returns { district, state } or null.
function matchFederalDistrict(line) {
  // Two flavors:
  //   1. "<dist>. <Long-State>"        e.g. "M.D. Florida"
  //   2. "<dist><Short-State-with-periods>" e.g. "S.D.N.Y." → district "S.D.", state "N.Y."
  //   3. "<dist>. <Short-State>"       e.g. "C.D. Cal.", "E.D. Tex."
  const distRe = /\b([NSEMC]\.D\.|D\.)\s*([A-Z][\w.\s']+?)(?=[,.]\s|\sDivision|\s—|\s-|$)/;
  const m = line.match(distRe);
  if (m) {
    const district = m[1];
    let stateRaw = m[2].trim().replace(/[,.]+$/, "");
    // First try long-name match
    if (STATE_NAME_TO_CODE[stateRaw]) {
      return { district, state: STATE_NAME_TO_CODE[stateRaw] };
    }
    // Try short form (strip trailing periods then split by spaces, take whole thing)
    const short = stateRaw.replace(/\./g, "").trim();
    if (SHORT_FORM_TO_CODE[short]) {
      return { district, state: SHORT_FORM_TO_CODE[short] };
    }
    // Special-case stacked initials: "N.Y.", "N.J.", "S.C." with no space
    const stacked = stateRaw.replace(/\s+/g, "").replace(/\.+$/, "");
    if (SHORT_FORM_TO_CODE[stacked]) {
      return { district, state: SHORT_FORM_TO_CODE[stacked] };
    }
  }
  // Stacked initials with no space at all: "S.D.N.Y." or "E.D.N.Y."
  const stackedRe = /\b([NSEMC]\.D\.|D\.)\s*([A-Z](?:\.[A-Z])+\.)/;
  const ms = line.match(stackedRe);
  if (ms) {
    const district = ms[1];
    const cleaned = ms[2].replace(/\./g, "");
    if (SHORT_FORM_TO_CODE[cleaned]) return { district, state: SHORT_FORM_TO_CODE[cleaned] };
  }
  return null;
}

export function parseCourtLine(rawLine) {
  // Normalize curly apostrophes (Westlaw uses ’ in "Hawai’i") and whitespace.
  const line = (rawLine || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!line) return { name: "", jurisdiction: "federal", state: "", district: "" };
  const isFederal = /\bUnited\s+States\b|^\s*U\.\s*S\./i.test(line);

  // Federal: try matching a district designator
  if (isFederal) {
    const m = matchFederalDistrict(line);
    if (m) return { name: line, jurisdiction: "federal", state: m.state, district: m.district };
    // Federal court of appeals — multi-state, leave state empty
    return { name: line, jurisdiction: "federal", state: "", district: "" };
  }

  // State courts: scan for any state name (longest match wins)
  let bestState = "";
  let bestLen = 0;
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (line.includes(name) && name.length > bestLen) {
      bestState = code;
      bestLen = name.length;
    }
  }
  return { name: line, jurisdiction: "state", state: bestState, district: "" };
}

// ── Date parsing ─────────────────────────────────────────────────────────────
// Westlaw uses "December 31, 2020". Parse as UTC midnight to avoid the local-
// timezone shift that bumps the date back a day for negative-UTC systems.
const MONTH_INDEX = {
  january:0, february:1, march:2, april:3, may:4, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11,
  jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11,
};
export function parseWestlawDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^([A-Za-z.]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) {
    const month = MONTH_INDEX[m[1].toLowerCase().replace(/\.$/, "")];
    if (month === undefined) return null;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  // Fallback: ISO-ish input ("2020-12-31") or anything Date can handle
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Case-type hint from filename ─────────────────────────────────────────────
// Most reliable signal for state TCPA-equivalents (the summary may not mention
// "TCPA" if it's a state statute).
const FILENAME_TYPE_HINTS = [
  { re: /\bFCRA\b|\bFair Credit Reporting\b/i,    type: "FCRA"  },
  { re: /\bFDCPA\b|\bFair Debt Collection\b/i,    type: "FDCPA" },
  { re: /\bAuto-?Dialer\b/i,                       type: "TCPA"  },
  { re: /\bTelephone (?:Consumer Protection|Solicitation|Privacy) Act\b/i, type: "TCPA" },
  { re: /\bTCPA\b/i,                               type: "TCPA"  },
  { re: /\bCommercial Electronic Mail\b/i,         type: "TCPA"  }, // CEMA — anti-spam, TCPA-adjacent
  { re: /\bDo Not Call\b/i,                        type: "TCPA"  },
  { re: /\brobocall\b/i,                           type: "TCPA"  },
];

function caseTypeFromFilename(filename) {
  for (const { re, type } of FILENAME_TYPE_HINTS) {
    if (re.test(filename)) return type;
  }
  return null;
}

// ── URL cleanup ──────────────────────────────────────────────────────────────
// Strip Westlaw session-scoped params so we don't leak them when displaying URLs.
const STRIP_PARAMS = new Set([
  "listSource", "list", "rank", "sessionScopeId", "ppcid", "originationContext",
  "transitionType", "contextData", "VR", "RS", "searchGuid", "searchPosition",
]);
function cleanWestlawUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (STRIP_PARAMS.has(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch { return url; }
}

// ── Deterministic ID ─────────────────────────────────────────────────────────
// The Westlaw Document URL embeds a unique document GUID (e.g.
// "I4aaec7304cb211eb94d5d4e51cfa3c85") between /Document/ and the next slash.
// That's the strongest primary key. Falling back to Docket+Court hash for
// rows missing a Westlaw URL; the bare Citation field is NOT unique
// ("Not Reported in Fed. Supp." appears on thousands of unreported cases).
function deterministicId(row) {
  const url = row["Document URL"] || "";
  const m = url.match(/\/Document\/([A-Za-z0-9]+)\//);
  if (m) return `wl_${m[1]}`;

  // Fallback: hash docket + court + title — unique enough when URL is missing.
  const docket = row["Docket Num"] || "";
  const court = row["Court Line"] || "";
  const title = row.Title || "";
  const seed = `${docket}|${court}|${title}`;
  if (!seed.trim()) return null;
  const h = createHash("sha1").update(seed).digest("hex").slice(0, 14);
  return `wl_${h}`;
}

// ── Row → buildCase input ────────────────────────────────────────────────────
function rowToCase(row, filename) {
  const title = row.Title || "";
  if (!title) return null;
  const court = parseCourtLine(row["Court Line"]);
  const filingDate = parseWestlawDate(row["Filed Date"]);
  // buildCase requires filingDate to be non-empty — skip rows without one
  if (!filingDate) return null;

  // Case type: filename hint first (strongest for state statutes), then summary text.
  const summary = row.Summary || "";
  const snippets = [row["Search Snippet 1"], row["Search Snippet 2"], row["Search Snippet 3"], row["Search Snippet 4"]]
    .filter(Boolean).join(" ");
  const haystack = `${title} ${summary} ${snippets}`;
  let caseType = caseTypeFromFilename(filename);
  if (!caseType) {
    caseType = detectCaseType(haystack, "") || "TCPA"; // last-resort: assume TCPA (this is a TCPA-focused CSV set)
  }

  const id = deterministicId(row);
  if (!id) return null;

  // For state-law cases, the state from the court is also the eligible state
  // (the state statute only protects residents of that state).
  const eligibleStates = court.jurisdiction === "state" && court.state ? [court.state] : [];
  const geographicScope = court.jurisdiction === "state" ? "single-state" : "nationwide";

  return {
    id,
    caption: title,
    caseType,
    defendants: parseDefendantsFromCaption(title),
    plaintiffs: parsePlaintiffsFromCaption(title),
    court: {
      name: court.name,
      jurisdiction: court.jurisdiction,
      state: court.state,
      district: court.district,
      docket: row["Docket Num"] || "",
      citation: row.Citation || row["Parallel Cite"] || "",
    },
    natureOfSuit: null, // Westlaw doesn't carry NOS codes
    filingDate,
    lastDocketDate: filingDate,
    status: "active", // Westlaw exports are opinions, not docket-status snapshots
    classDefinition: "", // Not captured at this granularity
    conductDescription: summary || snippets,
    geographicScope,
    eligibleStates,
    source: "westlaw",
    sourceUrl: cleanWestlawUrl(row["Document URL"] || ""),
    citations: row.Citation
      ? [row.Citation, row["Parallel Cite"]].filter(Boolean)
      : [],
  };
}

// ── Bulk defendant resolution ────────────────────────────────────────────────
// Per-row resolveOrSuggest() falls back to a trigram scan over ALL defendants
// when the alias lookup misses. With ~2000 unique defendants in a 5K-row file
// that's 5M+ KV ops worst-case (O(N²) over the run).
//
// Strategy: walk all records once, collect unique normalized names, hit the
// alias table directly (one kv.get per unique name), createDefendant on miss,
// then back-fill each record's defendant array with the canonicalId.
async function bulkResolveDefendants(records) {
  const uniqueNames = new Map(); // normName → originalDisplay
  for (const r of records) {
    for (const d of (r.defendants || [])) {
      const display = typeof d === "string" ? d : (d?.displayName || d?.name);
      if (!display) continue;
      const norm = normalizeDefendantName(display);
      if (!norm) continue;
      if (!uniqueNames.has(norm)) uniqueNames.set(norm, display);
    }
  }
  if (!uniqueNames.size) return;

  // Single alias lookup per unique name (parallel in batches of 100).
  const cache = new Map(); // norm → canonicalId
  const normList = [...uniqueNames.keys()];
  const LOOKUP_BATCH = 100;
  for (let i = 0; i < normList.length; i += LOOKUP_BATCH) {
    const slice = normList.slice(i, i + LOOKUP_BATCH);
    const results = await Promise.all(
      slice.map((n) => kv.get(`tcpa:defendant_alias:${n}`).catch(() => null))
    );
    slice.forEach((n, j) => {
      if (results[j]) cache.set(n, results[j]);
    });
  }

  // Create defendants for names that didn't have an exact alias hit. Sequential
  // so concurrent createDefendant calls don't collide on shared indexes.
  for (const norm of normList) {
    if (cache.has(norm)) continue;
    const display = uniqueNames.get(norm);
    try {
      const created = await createDefendant({ displayName: display });
      cache.set(norm, created.canonicalId);
    } catch {
      // Skip — record will fall back to per-row resolution downstream
    }
  }

  // Back-fill canonicalId onto each record's defendants
  for (const r of records) {
    r.defendants = (r.defendants || [])
      .map((d) => {
        const display = typeof d === "string" ? d : (d?.displayName || d?.name);
        if (!display) return null;
        const norm = normalizeDefendantName(display);
        const canonicalId = cache.get(norm);
        if (!canonicalId) return null; // skip rather than send to slow path
        return {
          canonicalId,
          displayName: display,
          role: typeof d === "string" ? "primary" : (d?.role || "primary"),
        };
      })
      .filter(Boolean);
  }
}

// ── File discovery ───────────────────────────────────────────────────────────
async function listCsvFiles(dirs) {
  const found = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /\.csv$/i.test(e.name)) {
          found.push(join(dir, e.name));
        }
      }
    } catch {
      // Dir doesn't exist — skip
    }
  }
  return found;
}

// ── Main runner ──────────────────────────────────────────────────────────────
export async function runWestlawCsv({
  caseTypes = ["TCPA", "FDCPA", "FCRA"],
  mode = "daily",
  importer,
  csvDirs = DEFAULT_CSV_DIRS,
  files = null,
} = {}) {
  if (!importer) throw new Error("runWestlawCsv requires importer fn");

  const csvFiles = files || (await listCsvFiles(csvDirs));
  if (!csvFiles.length) {
    const empty = {
      source: "westlaw-csv",
      mode,
      filesProcessed: 0,
      created: 0, updated: 0, unchanged: 0, errors: 0,
      note: "no CSV files found; Westlaw CSVs live locally only, not in production deploys",
    };
    await kv.set(STATS_KEY, JSON.stringify({ ...empty, ranAt: new Date().toISOString() }), { ex: 30 * 24 * 3600 }).catch(() => {});
    return empty;
  }

  let totalRows = 0;
  let skippedRows = 0;
  let typeFilteredRows = 0;
  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0, totalErrors = 0;
  const filesProcessed = [];

  for (const path of csvFiles) {
    try {
      const text = await readFile(path, "utf-8");
      const { rows } = parseCSV(text);
      const filename = path.split("/").pop();

      // Build records for this file
      const records = [];
      for (const r of rows) {
        totalRows++;
        const rec = rowToCase(r, filename);
        if (!rec) { skippedRows++; continue; }
        if (caseTypes && !caseTypes.includes(rec.caseType)) { typeFilteredRows++; continue; }
        records.push(rec);
      }

      // Bulk-resolve defendants ONCE per file. Without this each unique new
      // defendant triggers an O(N) trigram scan inside resolveOrSuggest, which
      // makes the importer O(N²) total. We use exact-alias-only lookups here
      // (one kv.get per unique normalized name) and createDefendant on miss.
      await bulkResolveDefendants(records);

      // Import in chunks of 50 so a transient KV hiccup doesn't lose a whole file
      const CHUNK = 50;
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const r = await importer(slice);
        totalCreated   += r.created;
        totalUpdated   += r.updated;
        totalUnchanged += r.unchanged;
        totalErrors    += r.errors.length;
      }

      filesProcessed.push({ file: filename, rows: rows.length, ingested: records.length });
    } catch (e) {
      filesProcessed.push({ file: path.split("/").pop(), error: e.message });
      totalErrors++;
    }
  }

  const summary = {
    source: "westlaw-csv",
    mode,
    filesProcessed: filesProcessed.length,
    files: filesProcessed,
    totalRows,
    skippedRows,
    typeFilteredRows,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  };
  await kv.set(STATS_KEY, JSON.stringify({ ...summary, ranAt: new Date().toISOString() }), { ex: 30 * 24 * 3600 }).catch(() => {});
  await kv.set(CHECKPOINT_KEY, new Date().toISOString(), { ex: 365 * 24 * 3600 }).catch(() => {});
  return summary;
}
