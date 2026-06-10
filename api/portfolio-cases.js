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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const [raw, tcpaRaw] = await Promise.all([
      kv.get("match:defendant_evidence"),
      kv.get("pacer:tcpa_marketers"),
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

    const defendants = Object.entries(clusters).map(([name, c]) => {
      const caseType = CATEGORY_CASE_TYPE[c.category] || "FDCPA";
      return {
        defendant:        name,
        defendantQ:       canonicalToken(name),
        category:         c.category,
        caseType,
        caseCount:        c.caseCount || 0,
        openCases:        c.openCases || 0,
        newCases:         newCounts[name] || 0,
        classSettlement:  classSettlement.has(name),
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
      ? (tcpa.defendants || []).map(d => ({
          defendant:   d.defendant,
          defendantQ:  canonicalToken(d.defendant || d.defendantQ || ""),
          caseType:    "TCPA",
          caseCount:   d.caseCount,
          openCases:   d.openCases,
          examples:    d.examples || [],
        }))
      : [];

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
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
