// Per-client TCPA / FDCPA / FCRA eligibility report.
//
// GET /api/client-report?clientId=<id>&format=html|csv|json[&fresh=1]
//
// Loads the client, runs (or reads the cached) match-cases output, and renders
// a structured eligibility report. Three formats:
//   html — printable report (browser handles "Save as PDF")
//   csv  — one row per matched case, columns include score/qualifies/factors
//   json — raw report shape (for the UI inline panel, or downstream tooling)
//
// Caching: if a precomputed snapshot exists at tcpa:client_report:${id} and
// is fresh (default 24h), serve it. Pass ?fresh=1 to force re-run.

import { kv } from "@vercel/kv";
import { buildClientReport, renderHtml, renderCsv } from "../src/lib/reportBuilder.js";
import { handleClientToCases } from "./match-cases.js";

const REPORT_KEY = (id) => `tcpa:client_report:${id}`;
const REPORT_TTL_DAYS = 7;
const FRESH_HOURS = 24;

async function loadClient(clientId) {
  const raw = await kv.get(`client:${clientId}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function loadCachedReport(clientId) {
  const raw = await kv.get(REPORT_KEY(clientId)).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

function isFreshEnough(report) {
  if (!report?.generatedAt) return false;
  const age = (Date.now() - Date.parse(report.generatedAt)) / (1000 * 60 * 60);
  return age >= 0 && age < FRESH_HOURS;
}

// Build a fresh report for a client. Exported so match-batch can reuse it.
export async function generateClientReport(client, { topN = 200 } = {}) {
  const { status, body } = await handleClientToCases({
    clientId: client.id,
    caseType: "AUTO",
    topN,
  });
  if (status >= 400) throw new Error(body?.error || `match-cases failed (${status})`);
  const report = buildClientReport({ client, matchResult: body });
  await kv.set(REPORT_KEY(client.id), JSON.stringify(report), { ex: REPORT_TTL_DAYS * 24 * 3600 }).catch(() => {});
  return report;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { clientId, format = "html", fresh, topN, meta } = req.query || {};
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  // Lightweight metadata read — used by the UI to render a "snapshot age" chip.
  if (meta) {
    const cached = await loadCachedReport(clientId);
    if (!cached) return res.status(200).json({ exists: false });
    const ageHours = (Date.now() - Date.parse(cached.generatedAt)) / (1000 * 60 * 60);
    return res.status(200).json({
      exists: true,
      generatedAt: cached.generatedAt,
      ageHours: Math.max(0, ageHours),
      fresh: ageHours < FRESH_HOURS,
      summary: cached.summary,
    });
  }

  try {
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "client not found" });

    // Serve cached snapshot if fresh enough and caller didn't ask for fresh
    let report = null;
    if (!fresh) {
      const cached = await loadCachedReport(clientId);
      if (cached && isFreshEnough(cached)) report = cached;
    }
    if (!report) {
      report = await generateClientReport(client, { topN: parseInt(topN) || 200 });
    }

    if (format === "json") {
      return res.status(200).json({ report });
    }
    if (format === "csv") {
      const safeName = (client.lastName || client.id).replace(/[^A-Za-z0-9_-]/g, "_");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tcpa-report-${safeName}.csv"`);
      return res.status(200).send(renderCsv(report));
    }
    // Default: HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(renderHtml(report));
  } catch (e) {
    return res.status(500).json({ error: e.message || "client-report failed" });
  }
}
