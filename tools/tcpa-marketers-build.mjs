// Build a defendant-grouped summary of the national TCPA index and store it in
// KV at `pacer:tcpa_marketers` for the Credit Portfolio Cases view.
import { kv } from "@vercel/kv";
import { readFileSync } from "fs";

const raw = JSON.parse(readFileSync("/Users/stef/MDL Business/data/pacer-cases/_tcpa_index.json", "utf8"));

function defendantOf(title) {
  let t = String(title);
  // Drop PACER HTML annotations ("<B>...DO NOT FILE...").
  t = t.replace(/<[^>]*>/g, " ").replace(/DO NOT FILE.*/i, " ");
  const parts = t.split(/\s+v[s]?\.?\s+/i);
  if (parts.length < 2) return null;
  let d = parts[parts.length - 1];
  d = d.replace(/\bet\s+al\.?/gi, " ")          // co-defendants
       .replace(/[,.\s]+$/g, "")                 // trailing punctuation
       .replace(/\s+/g, " ")
       .trim();
  return d || null;
}

// Canonical grouping key: strip common entity suffixes, lowercase.
function canon(name) {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|ltd|lp|llp|pllc|pc|p\.c\.|n\.a\.|na|company|holdings?)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const groups = new Map();
let parsed = 0;
for (const c of raw) {
  const d = defendantOf(c.caseTitle);
  if (!d) continue;
  parsed++;
  const key = canon(d);
  if (!key) continue;
  let g = groups.get(key);
  if (!g) {
    g = { defendant: d, defendantQ: key, caseCount: 0, openCases: 0, examples: [], _names: {} };
    groups.set(key, g);
  }
  g.caseCount++;
  if (c.status === "open") g.openCases++;
  // Track the most common surface spelling for display.
  g._names[d] = (g._names[d] || 0) + 1;
  if (g.examples.length < 3) {
    g.examples.push({ title: c.caseTitle.replace(/<[^>]*>/g, "").replace(/DO NOT FILE.*/i, "").trim().slice(0, 120), number: c.docket_number, court: c.court, status: c.status, filed: c.dateFiled });
  }
}

const defendants = [...groups.values()]
  .map(g => {
    const best = Object.entries(g._names).sort((a, b) => b[1] - a[1])[0][0];
    return { defendant: best, defendantQ: g.defendantQ, caseCount: g.caseCount, openCases: g.openCases, examples: g.examples };
  })
  .filter(g => g.caseCount >= 2)          // drop one-off singletons
  .sort((a, b) => (b.caseCount - a.caseCount) || (b.openCases - a.openCases));

const totals = defendants.reduce((t, d) => { t.dockets += d.caseCount; t.open += d.openCases; return t; }, { dockets: 0, open: 0 });

const payload = {
  generated: new Date().toISOString(),
  sourceTotal: raw.length,
  parsed,
  defendantCount: defendants.length,
  totals,
  defendants: defendants.slice(0, 300),   // top 300 multi-case defendants
};

await kv.set("pacer:tcpa_marketers", JSON.stringify(payload));
console.log(`Stored pacer:tcpa_marketers — ${raw.length} dockets, ${defendants.length} multi-case defendants (top 300 kept), ${totals.dockets} grouped dockets, ${totals.open} open`);
console.log("Top 12 marketer defendants:");
defendants.slice(0, 12).forEach(d => console.log(`  ${String(d.caseCount).padStart(4)}  (${d.openCases} open)  ${d.defendant}`));
