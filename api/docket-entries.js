// GET /api/docket-entries?docketId=NNNNNNN
//
// Fetches the 15 most recent docket entries for a CourtListener docket.
// Used by the Case Posture tab to show real evidence of where a case stands,
// instead of guessing from filing date alone.
//
// Returns: { entries: [{date_filed, description, document_number}], source: "CourtListener" }

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).end();

  const { docketId } = req.query;
  if (!docketId || !/^\d+$/.test(docketId)) {
    return res.status(400).json({ error: "numeric docketId required" });
  }

  const token = process.env.COURTLISTENER_API_TOKEN;
  const headers = token
    ? { Authorization: `Token ${token}`, Accept: "application/json" }
    : { Accept: "application/json" };

  try {
    const params = new URLSearchParams({
      docket:     docketId,
      order_by:   "-entry_number",
      page_size:  "15",
    });
    const r = await fetch(`${CL_BASE}/docket-entries/?${params}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (r.status === 429) {
      return res.status(429).json({ error: "CourtListener rate limit — try again in a few minutes" });
    }
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `CourtListener ${r.status}: ${t.slice(0, 200)}` });
    }

    const data = await r.json();
    const entries = (data.results || []).map(e => ({
      date_filed:      e.date_filed      || null,
      entry_number:    e.entry_number    || null,
      description:     e.description    || "",
      shortDescription:e.short_description || "",
      pacer_doc_id:    e.pacer_doc_id    || null,
    }));

    return res.status(200).json({ entries, total: data.count || entries.length, source: "CourtListener" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
