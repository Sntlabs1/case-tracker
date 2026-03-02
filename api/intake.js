// GET /api/intake?id=xxx — serves the generated plaintiff intake page
// HTML is stored in Vercel KV by api/intake-site.js (30-day TTL)

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const { id } = req.query;
  if (!id) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send("<!DOCTYPE html><html><body><h1>Missing id parameter</h1></body></html>");
  }

  try {
    const html = await kv.get(`intake:${id}`);

    if (!html) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(
        `<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:sans-serif;background:#0a0f1e;color:#e0e0e0;padding:60px;text-align:center"><h1 style="color:#c4a44a">Intake Page Not Found</h1><p>This intake site has expired or the ID is invalid. Please generate a new one from your case management system.</p></body></html>`
      );
    }

    const htmlStr = typeof html === "string" ? html : String(html);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(htmlStr);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0f1e;color:#f87171;padding:60px"><h1>Error</h1><p>${e.message}</p></body></html>`
    );
  }
}
