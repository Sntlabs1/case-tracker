import { kv } from "@vercel/kv";

// LEX-sourced tradeline dates (od, lrd, pr.filed/disch, signal lastReported)
// were ingested as raw MMYY strings ("0117" = Jan 2017); CC-sourced dates are
// already "YYYY-MM". Normalize everything to "YYYY-MM" so the UI formats and
// sorts dates consistently. Unambiguous: a valid MMYY month (01-12) can never
// collide with a plausible year (19xx/20xx).
function normYM(v) {
  if (v === null || v === undefined) return v;
  const s = String(v).trim();
  const mmyy = /^(\d{2})(\d{2})$/.exec(s);
  if (mmyy) {
    const mo = parseInt(mmyy[1], 10);
    const yy = parseInt(mmyy[2], 10);
    if (mo >= 1 && mo <= 12) {
      const y = yy <= 26 ? 2000 + yy : 1900 + yy; // same pivot as credit-rederive.py
      return `${y}-${String(mo).padStart(2, "0")}`;
    }
  }
  return v;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > 64) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const [raw, crRaw] = await Promise.all([
      kv.get(`client:${id}`),
      kv.get(`credit_report:${id}`),
    ]);
    if (raw === null || raw === undefined) {
      return res.status(404).json({ error: "Client not found" });
    }
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    const creditReport = crRaw ? (typeof crRaw === "string" ? JSON.parse(crRaw) : crRaw) : null;
    if (creditReport) {
      creditReport.tl = (creditReport.tl || []).map(t => ({ ...t, od: normYM(t.od), lrd: normYM(t.lrd) }));
      creditReport.pr = (creditReport.pr || []).map(p => ({ ...p, filed: normYM(p.filed), disch: normYM(p.disch) }));
    }
    const cases = (c.cases || c.caseSignals || []).map(s => ({ ...s, lastReported: normYM(s.lastReported) }));
    const normalized = {
      ...c,
      score:           c.priorityScore  ?? c.score,
      cases,
      bankruptcyFiled: normYM(c.bankruptcyFiled),
      intakeReady:     c.intakeReady,
      creditReport,
    };
    return res.status(200).json(normalized);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
