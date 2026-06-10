// Partner-facing claimant -> case match browser.
//
// GET /api/credit-matches
//   ?limit=50&offset=0          page through claimants, highest priority score first
//   ?state=CA                   filter by state
//   ?caseType=FDCPA             only claimants with >=1 case of this type
//   ?defendant=midland          only claimants naming this defendant (canonical token)
//   ?intakeReady=1              only actionable, contactable leads
//   ?actionable=1               only claimants with >=1 non-time-barred claim
//   ?minScore=80                minimum priority score
// GET /api/credit-matches?id=<clientId>   single claimant: per-connection detail + masked contact
//
// Reads the corrected `client:*` records directly (each case already carries
// solStatus / statuteRef / recovery) and joins PACER docket evidence by
// canonical token. The old derived `match:*` layer is no longer required.

import { kv } from "@vercel/kv";
import { canonicalToken } from "./_lib/defendantToken.js";

const N_SHARDS = 16;

const ELIGIBILITY_LABEL = {
  discharge_ongoing: "Viable — discharge-injunction violation, no SOL while reporting",
  live:              "Viable — within federal statute of limitations",
  live_state_udap:   "Viable via state UDAP statute",
  time_barred:       "Federally time-barred — evaluate state law only",
  undated:           "Timing unverified — source lacks dates",
};

// Honest, non-overstated reasoning. States the RELATIONSHIP and the SOL posture;
// never asserts a violation exists from a tradeline alone.
function renderReasoning(name, conn) {
  const rel = conn.caseType === "DischargeViolation"
    ? `${name}'s credit report shows ${conn.defendant} still reporting a balance/collection after a bankruptcy filing`
    : `${name}'s credit report shows a ${conn.caseType} relationship with ${conn.defendant}`;
  let r = `${rel}. ${ELIGIBILITY_LABEL[conn.solStatus] || conn.solStatus}.`;
  if (conn.statuteRef) r += ` (${conn.statuteRef}.)`;
  if (conn.docketCount) {
    r += ` ${conn.cluster || conn.defendant} has ${conn.docketCount.toLocaleString()} federal dockets (${conn.openCases || 0} open)`;
    if (conn.newCases)        r += `, incl. ${conn.newCases} filed 2024-2026`;
    if (conn.classSettlement) r += `, with a confirmed class settlement`;
    r += ".";
  }
  r += " A tradeline establishes a relationship, not a violation; facts must be developed before any claim.";
  return r;
}

function maskPhone(p) {
  if (!p) return null;
  const d = String(p).replace(/\D/g, "");
  return d.length >= 4 ? `***-***-${d.slice(-4)}` : "***-***-****";
}
function maskEmail(e) {
  if (!e) return null;
  const at = e.indexOf("@");
  return at < 0 ? "****" : `****${e.slice(at)}`;
}

// Build connection objects from a client's cases[], joining PACER evidence.
function connectionsFor(client, name, evidence) {
  const clusters = evidence.clusters || {};
  const newCounts = evidence.newCaseCounts || {};
  const classSet = new Set(evidence.classSettlementDefendants || []);
  // Index PACER clusters by canonical token once.
  const byToken = evidence._byToken || (evidence._byToken = (() => {
    const m = new Map();
    for (const [cname, c] of Object.entries(clusters)) {
      m.set(canonicalToken(cname), { name: cname, ...c });
    }
    return m;
  })());

  return (client.cases || []).map(cs => {
    const ev = byToken.get(cs.defendantToken);
    const conn = {
      caseType:        cs.caseType,
      defendant:       cs.defendant,
      defendantToken:  cs.defendantToken,
      cluster:         ev ? ev.name : null,
      strength:        cs.strength,
      solStatus:       cs.solStatus,
      statuteRef:      cs.statuteRef,
      lastReported:    cs.lastReported || null,
      recoveryLow:     cs.estRecoveryLow,
      recoveryHigh:    cs.estRecoveryHigh,
      docketCount:     ev ? (ev.caseCount || 0) : 0,
      openCases:       ev ? (ev.openCases || 0) : 0,
      newCases:        ev ? (newCounts[ev.name] || 0) : 0,
      classSettlement: ev ? classSet.has(ev.name) : false,
      dockets:         ev ? (ev.examples || []).slice(0, 3).map(e =>
                          `${e.title} (${e.number}, ${e.court}, ${e.status})`) : [],
      eligibility:     cs.solStatus,
      eligibilityLabel: ELIGIBILITY_LABEL[cs.solStatus] || cs.solStatus,
    };
    conn.reasoning = renderReasoning(name, conn);
    return conn;
  });
}

const ACTIONABLE = new Set(["live", "live_state_udap", "discharge_ongoing"]);

async function topByScore(maxScan) {
  const per = Math.ceil(maxScan / N_SHARDS);
  const slices = await Promise.all(
    Array.from({ length: N_SHARDS }, (_, s) =>
      kv.zrange(`by_score:${s}`, 0, per - 1, { rev: true, withScores: true }).catch(() => [])
    )
  );
  const merged = [];
  for (const slice of slices) {
    for (let i = 0; i < slice.length; i += 2) merged.push([slice[i], Number(slice[i + 1])]);
  }
  merged.sort((a, b) => b[1] - a[1]);
  return merged.map(m => m[0]);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")     return res.status(405).json({ error: "Method not allowed" });

  try {
    const evRaw = await kv.get("match:defendant_evidence");
    const evidence = evRaw ? (typeof evRaw === "string" ? JSON.parse(evRaw) : evRaw) : {};

    const { id } = req.query;

    // ── single claimant detail ──────────────────────────────────────────
    if (id) {
      if (!/^[A-Za-z0-9_-]+$/.test(id) || id.length > 64) {
        return res.status(400).json({ error: "Invalid id" });
      }
      const clientRaw = await kv.get(`client:${id}`);
      if (!clientRaw) return res.status(404).json({ error: "No record for this claimant" });
      const client = typeof clientRaw === "string" ? JSON.parse(clientRaw) : clientRaw;
      const name = client.name || "This claimant";
      const connections = connectionsFor(client, name, evidence);
      return res.status(200).json({
        id: client.id,
        name,
        state: client.state,
        score: client.priorityScore,
        actionable: client.actionable,
        intakeReady: client.intakeReady,
        recovery: client.recoveryEstimate || {},
        solSummary: client.solSummary || null,
        dataVintage: client.dataVintage || null,
        bankruptcyFiled: client.bankruptcyFiled || null,
        contact: { phone: maskPhone(client.phone), email: maskEmail(client.email) },
        connectionCount: connections.length,
        connections,
      });
    }

    // ── list / browse ───────────────────────────────────────────────────
    const limit       = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset      = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const state       = req.query.state ? String(req.query.state).toUpperCase() : null;
    const caseType    = req.query.caseType || null;
    const defToken    = req.query.defendant ? canonicalToken(req.query.defendant) : null;
    const minScore    = req.query.minScore ? parseInt(req.query.minScore, 10) : null;
    const intakeReady = req.query.intakeReady === "1" || req.query.intakeReady === "true";
    const actionable  = req.query.actionable === "1" || req.query.actionable === "true";

    const cards = await Promise.all(
      Array.from({ length: N_SHARDS }, (_, s) => kv.zcard(`by_score:${s}`).catch(() => 0))
    );
    const total = cards.reduce((a, b) => a + b, 0);

    const ids = await topByScore(20000);
    const results = [];
    let collected = 0;
    const batch = 250;
    for (let i = 0; i < ids.length && results.length < limit; i += batch) {
      const slice = ids.slice(i, i + batch);
      const recs = await Promise.all(slice.map(cid => kv.get(`client:${cid}`)));
      for (const r of recs) {
        if (!r) continue;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        if (minScore != null && (c.priorityScore || 0) < minScore) continue;
        if (state && c.state !== state) continue;
        if (intakeReady && !c.intakeReady) continue;
        if (actionable && !c.actionable) continue;
        const cs = c.cases || [];
        if (caseType && !cs.some(x => x.caseType === caseType)) continue;
        if (defToken && !cs.some(x => x.defendantToken === defToken)) continue;
        if (collected++ < offset) continue;
        if (results.length >= limit) break;
        const name = c.name || "This claimant";
        const connections = connectionsFor(c, name, evidence);
        results.push({
          id: c.id, name, state: c.state, score: c.priorityScore,
          actionable: c.actionable, intakeReady: c.intakeReady,
          recovery: c.recoveryEstimate || {},
          solSummary: c.solSummary || null,
          connectionCount: connections.length,
          strongConnections: connections.filter(x => ACTIONABLE.has(x.solStatus)).length,
          topConnections: connections
            .slice()
            .sort((a, b) => (ACTIONABLE.has(b.solStatus) ? 1 : 0) - (ACTIONABLE.has(a.solStatus) ? 1 : 0))
            .slice(0, 3),
        });
      }
    }

    return res.status(200).json({
      total,
      returned: results.length,
      offset,
      limit,
      note: "total = all claimants indexed; filtered results are bounded to the top 20k by score per request",
      filters: { state, caseType, defendant: req.query.defendant || null, minScore, intakeReady, actionable },
      claimants: results,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
