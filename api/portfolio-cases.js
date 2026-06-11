// GET /api/portfolio-cases
// Serves the real PACER case catalog that the credit DB is matched against,
// grouped by defendant. Reads the `match:defendant_evidence` map built by the
// match-derive sweep from data/pacer-cases/ (41 canonical FDCPA/FCRA/TCPA
// defendants, ~33.9K federal dockets). Powers the "Cases" view of the Credit
// Portfolio tab.

import { kv } from "@vercel/kv";
import { canonicalToken } from "./_lib/defendantToken.js";

// Map each defendant cluster category to the primary consumer-protection
// case type it drives. Used for the case-type filter and legal context.
const CATEGORY_CASE_TYPE = {
  "collector":             "FDCPA",
  "debt-buyer":            "FDCPA",
  "auto-lender":           "AutoLending",
  "subprime-card":         "FCRA",
  "subprime-installment":  "FCRA",
};

const N_SHARDS = 16;

// Eligible-people count per defendant (sum of its casepeople shards), cached
// in KV — the catalog is ~340 tokens x 16 shards, too many zcards per request.
// Powers the per-case total-claim estimate column in the Cases table.
const CASE_TOTALS_KEY   = "portfolio:case_totals:v2"; // v2: includes open-settlement catalog tokens
const CASE_TOTALS_TTL_S = 6 * 60 * 60;

async function casepeopleTotal(token) {
  const cards = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) => kv.zcard(`casepeople:${token}:${s}`).catch(() => 0))
  );
  return cards.reduce((a, b) => a + (b || 0), 0);
}

async function caseTotals(tokens) {
  const cachedRaw = await kv.get(CASE_TOTALS_KEY).catch(() => null);
  if (cachedRaw) {
    const cached = typeof cachedRaw === "string" ? JSON.parse(cachedRaw) : cachedRaw;
    if (cached && cached.totals) return cached.totals;
  }
  const totals = {};
  const BATCH = 40; // 40 tokens x 16 shards = 640 parallel zcards per wave
  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH);
    const counts = await Promise.all(slice.map(t => casepeopleTotal(t)));
    slice.forEach((t, j) => { if (counts[j] > 0) totals[t] = counts[j]; });
  }
  await kv.set(CASE_TOTALS_KEY, { computedAt: Date.now(), totals }, { ex: CASE_TOTALS_TTL_S })
    .catch(() => {});
  return totals;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const [raw, tcpaRaw, nationalRaw, pathsRaw] = await Promise.all([
      kv.get("match:defendant_evidence"),
      kv.get("pacer:tcpa_marketers"),
      kv.get("pacer:national_entities"),
      kv.get("case:claim_paths"),
    ]);
    if (!raw) {
      return res.status(200).json({
        status: "not_loaded",
        message: "PACER case evidence not loaded yet. Run the match-derive sweep.",
        defendants: [],
      });
    }
    const ev = typeof raw === "string" ? JSON.parse(raw) : raw;
    const clusters = ev.clusters || {};
    const newCounts = ev.newCaseCounts || {};
    const classSettlement = new Set(ev.classSettlementDefendants || []);

    // Claim-path registry (tools/claim-paths-build.py): per defendant token,
    // whether a LIVE recovery avenue exists today — an open settlement window
    // (claim_window) or open litigation the person's match can join/originate
    // against (joinable_litigation). Defendants with status "none" must not be
    // pitched as claimable.
    const pathsDoc = pathsRaw ? (typeof pathsRaw === "string" ? JSON.parse(pathsRaw) : pathsRaw) : null;
    const pathReg = pathsDoc?.registry || {};
    const claimPathOf = token => {
      const r = pathReg[token];
      if (!r) return { status: "unknown" };
      return {
        status:           r.status,
        liveSettlements:  (r.liveSettlements || []).slice(0, 3),
        openLitigation:   (r.openClassCandidates || 0) + (r.openDockets || 0) + (r.tcpaOpenDockets || 0),
      };
    };

    const defendants = Object.entries(clusters).map(([name, c]) => {
      const caseType = CATEGORY_CASE_TYPE[c.category] || "FDCPA";
      const token = canonicalToken(name);
      return {
        defendant:        name,
        defendantQ:       token,
        category:         c.category,
        caseType,
        caseCount:        c.caseCount || 0,
        openCases:        c.openCases || 0,
        newCases:         newCounts[name] || 0,
        classSettlement:  classSettlement.has(name),
        claimPath:        claimPathOf(token),
        examples:         (c.examples || []).slice(0, 3),
      };
    });

    // Highest-volume defendants first; open cases break ties.
    defendants.sort((a, b) =>
      (b.caseCount - a.caseCount) || (b.openCases - a.openCases)
    );

    const totals = defendants.reduce(
      (t, d) => {
        t.dockets += d.caseCount;
        t.open    += d.openCases;
        t.newCases += d.newCases;
        return t;
      },
      { dockets: 0, open: 0, newCases: 0 }
    );

    // National TCPA marketer index (defendant-grouped). Reference catalog —
    // many are robocall marketers absent from credit reports, but the top
    // entries are banks/lenders that DO appear and are matchable to people.
    const tcpa = tcpaRaw ? (typeof tcpaRaw === "string" ? JSON.parse(tcpaRaw) : tcpaRaw) : null;
    const tcpaMarketers = tcpa
      ? (tcpa.defendants || []).map(d => {
          const token = canonicalToken(d.defendant || d.defendantQ || "");
          return {
            defendant:   d.defendant,
            defendantQ:  token,
            caseType:    "TCPA",
            caseCount:   d.caseCount,
            openCases:   d.openCases,
            claimPath:   claimPathOf(token),
            examples:    d.examples || [],
          };
        })
      : [];

    // National consumer-credit index (NOS 480/371/490, 2015-2026, all Top-1000
    // entities + the big-3 bureaus). Built by tools/national-entities-build.mjs
    // from the 120,869-case national pull. Bureau entries apply to the entire
    // base (every person has all three bureau files), so they are flagged and
    // the UI skips the per-person casepeople join for them.
    const national = nationalRaw
      ? (typeof nationalRaw === "string" ? JSON.parse(nationalRaw) : nationalRaw)
      : null;
    const nationalEntities = national
      ? (national.entities || []).map(d => ({
          defendant:     d.defendant,
          defendantQ:    d.defendantQ,
          caseType:      "FCRA",
          bureau:        !!d.bureau,
          entityType:    d.type || null,
          caseCount:     d.caseCount,
          openCases:     d.openCases,
          candidates:    d.candidates,
          consumersInDb: d.consumersInDb || null,
          claimPath:     claimPathOf(d.defendantQ),
          examples:      d.examples || [],
        }))
      : [];

    // FULL open-settlement catalog: every registry token with a live claim
    // window, regardless of whether the defendant appears in any PACER docket
    // catalog. Without this, settled-but-never-litigated-here defendants
    // (Krispy Kreme, Avis, SunTrust, ...) are invisible in the Cases view —
    // exactly the cases credit.com customers can claim TODAY.
    const titleize = t => t.replace(/\b[a-z]/g, ch => ch.toUpperCase());
    const openSettlements = Object.entries(pathReg)
      .filter(([, r]) => r.status === "claim_window" && (r.liveSettlements || []).length)
      .map(([token, r]) => ({
        defendant:   titleize(token),
        defendantQ:  token,
        caseType:    "OpenSettlement",
        caseCount:   (r.openDockets || 0),
        openCases:   (r.openDockets || 0),
        claimPath:   claimPathOf(token),
        examples:    [],
      }));

    // Eligible-people count per defendant for the total-claim estimate column.
    // National entities are included (post catalog expansion the casepeople
    // index covers them); bureau entries are skipped — they apply to the whole
    // base, there is no per-person join for them.
    const tokenSet = new Set(
      [...defendants.map(d => d.defendantQ),
       ...tcpaMarketers.map(m => m.defendantQ),
       ...openSettlements.map(s => s.defendantQ),
       ...nationalEntities.filter(d => !d.bureau).map(d => d.defendantQ)].filter(Boolean)
    );
    const totalsByToken = await caseTotals([...tokenSet]);
    for (const d of defendants)    d.consumers = totalsByToken[d.defendantQ] || 0;
    for (const m of tcpaMarketers) m.consumers = totalsByToken[m.defendantQ] || 0;
    for (const s of openSettlements) s.consumers = totalsByToken[s.defendantQ] || 0;
    for (const n of nationalEntities) {
      if (!n.bureau) n.consumers = totalsByToken[n.defendantQ] || 0;
    }

    return res.status(200).json({
      status:       "ok",
      generated:    ev.generated || null,
      defendantCount: defendants.length,
      totals,
      defendants,
      tcpaMarketers,
      tcpaMarketerMeta: tcpa
        ? { sourceTotal: tcpa.sourceTotal, defendantCount: tcpa.defendantCount, totals: tcpa.totals }
        : null,
      openSettlements,
      nationalEntities,
      nationalEntityMeta: national
        ? { indexCases: national.indexCases, matchedCases: national.matchedCases,
            entityCount: national.entityCount, totals: national.totals }
        : null,
      claimPathMeta: pathsDoc?._meta || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
