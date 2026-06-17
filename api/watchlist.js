import { kv } from "@vercel/kv";

// Persistent watchlist for tracked credit-defendant opportunities. One KV key
// holds the whole list (low volume — a user's tracked set). Each item stores the
// defendant token, a stage, notes, and a snapshot of status-at-add so the UI can
// flag what changed since (e.g., a settlement appeared, dockets moved).
const KEY = "watchlist:credit";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const items = (await kv.get(KEY)) || [];
      return res.status(200).json({ items });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (req.method === "POST") {
      const token = (body.token || "").trim();
      if (!token) return res.status(400).json({ error: "token required" });
      const items = (await kv.get(KEY)) || [];
      const now = new Date().toISOString();
      const i = items.findIndex((x) => x.token === token);
      if (i >= 0) {
        // update stage/notes; keep original snapshot + addedAt
        items[i] = { ...items[i], ...body, token, updatedAt: now };
      } else {
        items.push({ token, addedAt: now, updatedAt: now, stage: "monitoring", ...body });
      }
      await kv.set(KEY, items);
      return res.status(200).json({ items });
    }

    if (req.method === "DELETE") {
      const token = (req.query.token || body.token || "").trim();
      let items = (await kv.get(KEY)) || [];
      items = items.filter((x) => x.token !== token);
      await kv.set(KEY, items);
      return res.status(200).json({ items });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
