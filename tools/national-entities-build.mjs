// Build a defendant-grouped summary of the NATIONAL consumer-credit index
// matches (_national_entity_matches.json — NOS 480/371/490 vs all Top-1000
// entities + bureaus) and store it in KV at `pacer:national_entities` for the
// Credit Portfolio Cases view. Run from the project dir (node_modules + .env.local).
import { kv } from "@vercel/kv";
import { readFileSync } from "fs";
import { canonicalToken } from "../api/_lib/defendantToken.js";

const raw = JSON.parse(readFileSync("/Users/stef/MDL Business/data/pacer-cases/_national_entity_matches.json", "utf8"));

// Top-1000 rows that are themselves generic fragments ("COLLECTION", "CREDIT
// MANAGEMENT") containment-match thousands of unrelated collectors — drop any
// entity whose name is built only from these tokens.
const GENERIC = new Set([
  "COLLECTION", "COLLECTIONS", "CREDIT", "MANAGEMENT", "SYSTEM", "SYSTEMS",
  "CONTROL", "SERVICE", "SERVICES", "FINANCIAL", "RECOVERY", "SOLUTIONS",
  "RESOURCE", "RESOURCES", "ASSOCIATES", "NATIONAL", "AMERICAN", "COLL",
  "BUREAU", "AGENCY", "GROUP", "CORP", "CORPORATION", "COMPANY", "INC", "LLC",
]);
const isGeneric = name =>
  name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean)
      .every(t => GENERIC.has(t));

// Collapse near-duplicate Top-1000 spellings (I C SYSTEM / I.C. SYSTEM, INC)
// onto the same canonical join token. Variants matched the SAME dockets, so
// case stats take the max; consumer counts are distinct raw-string rows whose
// people may overlap, so the sum is a ceiling.
const groups = new Map();
for (const [name, e] of Object.entries(raw.entities)) {
  if (isGeneric(name)) continue;
  const token = canonicalToken(name.replace(/ \(bureau\)$/, ""));
  if (!token) continue;
  let g = groups.get(token);
  if (!g) {
    g = { token, names: [], type: e.type, cases: 0, open: 0, candidates: 0, consumers: 0, examples: [] };
    groups.set(token, g);
  }
  g.names.push({ name, cases: e.cases, consumers: e.consumersInDb || 0 });
  g.cases = Math.max(g.cases, e.cases);
  g.open = Math.max(g.open, e.open);
  g.candidates = Math.max(g.candidates, e.candidates);
  g.consumers += e.consumersInDb || 0;
  if (g.examples.length < 3) {
    for (const ex of e.examples || []) {
      if (g.examples.length >= 3) break;
      if (!g.examples.some(x => x.docket === ex.docket)) g.examples.push(ex);
    }
  }
}

const entities = [...groups.values()]
  .map(g => ({
    defendant: g.names.sort((a, b) => (b.consumers - a.consumers) || (b.cases - a.cases))[0].name.replace(/ \(bureau\)$/, ""),
    defendantQ: g.token,
    type: g.type,
    bureau: g.type === "Credit bureau",
    caseCount: g.cases,
    openCases: g.open,
    candidates: g.candidates,
    consumersInDb: g.consumers,
    examples: g.examples,
  }))
  .filter(g => g.caseCount >= 3)
  .sort((a, b) => (b.caseCount - a.caseCount) || (b.openCases - a.openCases));

const totals = entities.reduce((t, d) => {
  t.dockets += d.caseCount; t.open += d.openCases; t.candidates += d.candidates; return t;
}, { dockets: 0, open: 0, candidates: 0 });

const payload = {
  generated: new Date().toISOString(),
  source: "_national_entity_matches.json (NOS 480/371/490 national pull 2015-2026, 120,869 cases)",
  indexCases: raw._meta.indexCases,
  matchedCases: raw._meta.matchedCases,
  entityCount: entities.length,
  totals,
  entities: entities.slice(0, 250),
};

await kv.set("pacer:national_entities", JSON.stringify(payload));
console.log(`Stored pacer:national_entities — ${entities.length} entities (top 250 kept), ${totals.dockets} dockets, ${totals.open} open, ${totals.candidates} class candidates`);
console.log("Top 15:");
entities.slice(0, 15).forEach(d =>
  console.log(`  ${String(d.caseCount).padStart(6)}  (${String(d.openCases).padStart(4)} open)  ${d.defendant}  [${d.defendantQ}]  ${d.consumersInDb.toLocaleString()} consumers`));
