#!/usr/bin/env node
// One-time ingestion script for the credit.com Azure blob dataset.
//
// Reads the locally-downloaded CSV files, joins identity + tradelines on ucid,
// applies case-type matching signals, writes matched clients directly to
// Vercel KV, and prints a full recovery estimate summary.
//
// Usage:
//   node tools/credit-ingest.js
//
// Prerequisites:
//   1. Files downloaded from Azure:
//        /tmp/credit-identity-sample.csv   (CCOM_EV_Identity.csv, first 50MB)
//        /tmp/credit-tradelines-sample.csv (CCOM_EV_Tradelines.csv, first 100MB)
//   2. KV env vars in .env.local (run `vercel env pull .env.local` if missing)
//
// To process the FULL dataset (1.4M people), download the complete files:
//   az storage blob download --account-name creditdatadd480c \
//     --container-name credit-com-data --name CCOM_EV_Identity.csv \
//     --file /tmp/credit-identity-full.csv --auth-mode login
//   Then update IDENTITY_FILE and TRADELINE_FILE below.

import fs from "fs";
import readline from "readline";
import path from "path";
import { createHash } from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────

const IDENTITY_FILE   = "/tmp/credit-identity-sample.csv";
const TRADELINE_FILE  = "/tmp/credit-tradelines-sample.csv";
const RESULTS_FILE    = "/Users/stef/MDL Business/data/credit-matches/ingest-results.json";

const BATCH_SIZE      = 500;   // KV pipeline batch
const MAX_RECORDS     = 300000; // safety cap; remove for full run

// Recovery estimates (conservative class-action averages per matched person)
const RECOVERY = {
  TCPA:         { low: 50,   mid: 300,  high: 1500, label: "TCPA — autodialed calls/texts" },
  FDCPA:        { low: 300,  mid: 500,  high: 1000, label: "FDCPA — illegal debt collection" },
  FCRA:         { low: 100,  mid: 300,  high: 1000, label: "FCRA — credit report errors" },
  RESPA:        { low: 500,  mid: 1500, high: 5000, label: "RESPA — mortgage servicing abuse" },
  StudentLoan:  { low: 500,  mid: 2000, high: 10000,label: "Student Loan — servicer misconduct" },
  AutoLending:  { low: 300,  mid: 1000, high: 5000, label: "Auto Lending — predatory origination" },
  DataBreach:   { low: 50,   mid: 150,  high: 500,  label: "Data Breach — class settlement" },
  UDAP_Payday:  { low: 200,  mid: 500,  high: 2000, label: "UDAP — predatory payday/installment" },
};

// ── Load env ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required.");
  console.error("Run:  vercel env pull .env.local");
  process.exit(1);
}

// ── KV REST helpers ───────────────────────────────────────────────────────────

async function kvPipeline(commands) {
  if (!commands.length) return [];
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`KV pipeline ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).map?.(x => x.result) ?? [];
}

async function kvSet(key, value) {
  await kvPipeline([["SET", key, JSON.stringify(value)]]);
}

// ── CSV streaming reader ──────────────────────────────────────────────────────

async function readCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    let headers = null;
    let count = 0;
    rl.on("line", (line) => {
      if (!line.trim()) return;
      // Strip BOM
      const cleaned = line.replace(/^﻿/, "");
      const vals = tokenise(cleaned);
      if (!headers) {
        headers = vals.map(h => h.trim().toLowerCase()
          .replace(/^line_[12]\s+/, "")  // "Line_1 address_line1" → "address_line1"
          .replace(/^balance\s+/, "")    // "Balance balance" → "balance"
          .replace(/\s+/g, "_"));
        return;
      }
      const row = {};
      headers.forEach((h, i) => { row[h] = (vals[i] || "").trim() || null; });
      onRow(row);
      count++;
    });
    rl.on("close", () => resolve(count));
    rl.on("error", reject);
  });
}

function tokenise(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      result.push(cur); cur = "";
    } else cur += c;
  }
  result.push(cur);
  return result;
}

// ── Matching patterns ─────────────────────────────────────────────────────────

const FDCPA_COLLECTORS = [
  "portfolio recovery","midland credit","midland funding","encore capital",
  "lvnv funding","resurgent capital","convergent outsourcing","ic system",
  "amsher collection","cbe group","diversified consultants","enhanced recovery",
  "firstsource advantage","national credit adjusters","radius global",
  "unifin","transworld systems","national enterprise systems",
  "credit corp solutions","southwest credit","credit collection services",
  "asset acceptance","cavalry portfolio","cach llc","sherman financial",
  "velocity investments","atlas acquisitions","jefferson capital",
  "hunter warfield","first collection","coast professional",
  "nco financial","account control","collection bureau",
  "united collection","phoenix financial","professional recovery",
  "receivables management","absolute resolutions","financial recovery",
  "world acceptance","pioneer credit recovery","continental service",
  "fair collections","security credit",
];

const TCPA_DEFENDANTS = [
  "navient","sallie mae","capital one","synchrony","citibank","citi bank",
  "wells fargo","jpmorgan","jp morgan","chase","bank of america",
  "discover","american express","amex","ally financial","ally bank",
  "portfolio recovery","midland credit","midland funding","encore capital",
  "lvnv","convergent","ic system","amsher","diversified consultants",
  "enhanced recovery","transworld","southwest credit","jefferson capital",
  "ditech","nationstar","mr. cooper","ocwen","phh mortgage",
  "newrez","shellpoint","caliber","specialized loan","cenlar",
  "at&t","verizon","sprint","t-mobile","comcast","xfinity",
  "dish network","directv","time warner","charter","spectrum",
  "great lakes","fedloan","mohela","nelnet","aidvantage","pheaa",
];

const RESPA_SERVICERS = [
  "ocwen","phh mortgage","nationstar","mr. cooper","ditech","greentree",
  "green tree","caliber home","bsi financial","shellpoint","newrez",
  "specialized loan","cenlar","rushmore","roundpoint","home point",
  "lakeview loan","select portfolio","sps mortgage","seterus",
  "wells fargo","bank of america","jpmorgan","chase",
];

const STUDENT_LOAN_SERVICERS = [
  "navient","sallie mae","great lakes","fedloan","mohela",
  "nelnet","aidvantage","ecmc","pheaa",
];

const PREDATORY_AUTO = [
  "credit acceptance","westlake financial","driveime","drivetime",
  "consumer portfolio services","santander consumer",
  "american credit acceptance","exeter finance","car hop","jd byrider",
];

const PREDATORY_PAYDAY = [
  "ace cash express","speedy cash","advance america","check into cash",
  "qc holdings","dollar financial","community choice financial",
  "first cash","check n go","world acceptance","regional management",
  "republic finance","heights finance","onemain financial",
  "springleaf financial","mariner finance",
];

const DATA_BREACH_COMPANIES = {
  "national public data": { year: 2024, note: "2.9B records; class actions active" },
  "change healthcare":    { year: 2024, note: "Largest US healthcare breach; suits filed" },
  "at&t":                 { year: 2024, note: "110M customers; class actions filed" },
  "t-mobile":             { year: 2023, note: "Ongoing class action settlement" },
  "equifax":              { year: 2017, note: "Settlement paid; document only" },
  "experian":             { year: 2020, note: "Class actions filed" },
  "transunion":           { year: 2022, note: "Class actions filed" },
  "capital one":          { year: 2019, note: "Settlement largely paid; document" },
};

function creditorHits(name, patterns) {
  if (!name) return null;
  const n = name.toLowerCase();
  return patterns.find(p => n.includes(p)) || null;
}

function mapToLoanType(expType = "", itemType = "") {
  const t = (expType + " " + itemType).toLowerCase();
  if (/mortgage|home equity|real estate/.test(t)) return "mortgage";
  if (/auto|vehicle|car/.test(t)) return "auto";
  if (/student|education/.test(t)) return "student";
  if (/collection/.test(t)) return "collection";
  return "other";
}

function normPhone(raw) {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 10 ? d.slice(-10) : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("CREDIT.COM → PLATFORM INGEST");
  console.log("=".repeat(60));

  fs.mkdirSync("/Users/stef/MDL Business/data/credit-matches", { recursive: true });

  // ── Step 1: Load tradelines into memory (grouped by ucid) ──────────────────
  console.log("\nStep 1: Loading tradelines...");
  const tradelinesByUcid = new Map();
  let tlCount = 0;

  await readCsv(TRADELINE_FILE, (row) => {
    const ucid = row.ucid;
    if (!ucid) return;
    if (!tradelinesByUcid.has(ucid)) tradelinesByUcid.set(ucid, []);
    tradelinesByUcid.get(ucid).push(row);
    tlCount++;
  });

  console.log(`  Loaded ${tlCount.toLocaleString()} tradelines for ${tradelinesByUcid.size.toLocaleString()} people`);

  // ── Step 2: Process identity rows + match ─────────────────────────────────
  console.log("\nStep 2: Processing identity + matching...");

  const stats = {
    total: 0, excluded_dnc: 0, excluded_no_contact: 0,
    matched: 0, intake_ready: 0,
    by_case_type: {},
    by_defendant: {},
    recovery: { low: 0, mid: 0, high: 0 },
  };

  const kvBatch = [];   // buffered KV pipeline commands
  const topLeads = [];  // top 200 for the summary file
  let processed = 0;

  async function flushBatch(force = false) {
    if (kvBatch.length >= BATCH_SIZE || (force && kvBatch.length > 0)) {
      await kvPipeline(kvBatch);
      kvBatch.length = 0;
    }
  }

  await readCsv(IDENTITY_FILE, async (row) => {
    if (processed >= MAX_RECORDS) return;

    const ucid = row.ucid;
    if (!ucid) return;

    processed++;
    stats.total++;

    // ── DNC / consent filtering ──────────────────────────────────────────────
    if (row.dnc_date) { stats.excluded_dnc++; return; }
    if (row.consent?.toLowerCase() === "no") { stats.excluded_dnc++; return; }

    const phoneAuth = row.phone_contact_auth?.toLowerCase() === "true";
    const phone     = phoneAuth ? normPhone(row.phone_number) : null;
    const email     = row.email?.toLowerCase().trim() || null;

    if (!phone && !email) { stats.excluded_no_contact++; return; }

    // ── Build base client ────────────────────────────────────────────────────
    const firstName = (row.first_name || "").trim();
    const lastName  = (row.last_name  || "").trim();
    const fullName  = `${firstName} ${lastName}`.trim();

    const clientId = `cc_${ucid}`;
    const hashId   = createHash("md5").update(clientId).digest("hex").slice(0, 12);

    const client = {
      id:            clientId,
      hashId,
      firstName,
      lastName,
      name:          fullName,
      email:         email || null,
      phones:        phone ? [phone] : [],
      phone:         phone || null,
      phoneAuth,
      address:       {
        line1:  row.address_line1 || null,
        line2:  row.address_line2 || null,
        city:   row.city         || null,
        state:  row.state        || null,
        zip:    row.postal_code  || null,
      },
      state:         row.state || null,
      bureau:        row.bureau || null,
      reportDate:    row.processdt || null,
      activatedAt:   row.activation_date || null,
      ingestSource:  "credit_com_blob",
      partnerId:     "credit_com",
      ingestedAt:    new Date().toISOString(),

      // will be populated below
      creditAccounts:      [],
      collectionsHistory:  [],
      creditInquiries:     [],
      caseSignals:         [],   // [{ caseType, defendant, strength, evidence }]
      massTortSignals:     {},
    };

    // ── Tradeline analysis ───────────────────────────────────────────────────
    const tradelines = tradelinesByUcid.get(ucid) || [];
    const matchedCaseTypes = new Set();

    for (const tl of tradelines) {
      const ah        = (tl.account_holder || tl.accountholder || "").trim();
      const origCred  = (tl.original_creditor || tl.originalcreditor || "").trim();
      const itemType  = (tl.internal_item_type || "").toLowerCase();
      const itemStatus = (tl.internal_item_status || "").toLowerCase();
      const expType   = (tl.experian_item_type || "").toLowerCase();
      const dateOpened = tl.date_opened || tl.dateopened || null;
      const balance   = parseFloat(tl.balance) || 0;
      const loanType  = mapToLoanType(expType, itemType);
      const isClosed  = tl.closedacctflag === "1";
      const payHist   = tl.payment_profile || tl.paymentprofile || "";

      // Build creditAccounts entry
      client.creditAccounts.push({
        creditor:        ah,
        originalCreditor: origCred || null,
        type:            loanType,
        status:          itemStatus,
        dateOpened,
        balance,
        paymentHistory:  payHist,
        isClosed,
        isCollection:    loanType === "collection" || itemType === "collection" || !!origCred,
      });

      if (loanType === "collection" || !!origCred) {
        client.collectionsHistory.push({ creditor: ah, originalCreditor: origCred, balance, dateOpened });
      }

      // ── FDCPA ──────────────────────────────────────────────────────────────
      const fdcpaHit = creditorHits(ah, FDCPA_COLLECTORS);
      if (fdcpaHit && origCred) {
        client.caseSignals.push({
          caseType:   "FDCPA",
          defendant:  ah,
          strength:   ["portfolio recovery","midland credit","lvnv funding","encore capital"].some(p => ah.toLowerCase().includes(p)) ? "high" : "medium",
          evidence:   [`Collection account: ${ah}`, `Original creditor: ${origCred}`],
          recoveryKey: "FDCPA",
        });
        matchedCaseTypes.add("FDCPA");
        stats.by_defendant[ah] = (stats.by_defendant[ah] || 0) + 1;
      }

      // ── TCPA ───────────────────────────────────────────────────────────────
      if (phone) {
        const tcpaHit = creditorHits(ah, TCPA_DEFENDANTS);
        if (tcpaHit) {
          client.caseSignals.push({
            caseType:   "TCPA",
            defendant:  ah,
            strength:   "medium",
            evidence:   [`Account with TCPA defendant: ${ah}`, `Phone on file`, `Status: ${itemStatus}`],
            recoveryKey: "TCPA",
          });
          matchedCaseTypes.add("TCPA");
          stats.by_defendant[ah] = (stats.by_defendant[ah] || 0) + 1;
        }
      }

      // ── RESPA ──────────────────────────────────────────────────────────────
      if (loanType === "mortgage") {
        const respaHit = creditorHits(ah, RESPA_SERVICERS);
        if (respaHit) {
          client.caseSignals.push({
            caseType:   "RESPA",
            defendant:  ah,
            strength:   "medium",
            evidence:   [`Mortgage with ${ah}`, `Opened: ${dateOpened}`],
            recoveryKey: "RESPA",
          });
          matchedCaseTypes.add("RESPA");
        }
      }

      // ── Student Loan ───────────────────────────────────────────────────────
      if (loanType === "student") {
        const slHit = creditorHits(ah, STUDENT_LOAN_SERVICERS);
        if (slHit) {
          client.caseSignals.push({
            caseType:   "StudentLoan",
            defendant:  ah,
            strength:   ah.toLowerCase().includes("navient") ? "high" : "medium",
            evidence:   [`Student loan with ${ah}`, `Status: ${itemStatus}`],
            recoveryKey: "StudentLoan",
          });
          matchedCaseTypes.add("StudentLoan");
        }
      }

      // ── Auto Predatory ─────────────────────────────────────────────────────
      if (loanType === "auto") {
        const autoHit = creditorHits(ah, PREDATORY_AUTO);
        if (autoHit) {
          client.caseSignals.push({
            caseType:   "AutoLending",
            defendant:  ah,
            strength:   ["credit acceptance","santander consumer"].some(p => ah.toLowerCase().includes(p)) ? "high" : "medium",
            evidence:   [`Auto loan with predatory lender: ${ah}`, `Status: ${itemStatus}`],
            recoveryKey: "AutoLending",
          });
          matchedCaseTypes.add("AutoLending");
        }
      }

      // ── Payday ─────────────────────────────────────────────────────────────
      const paydayHit = creditorHits(ah, PREDATORY_PAYDAY);
      if (paydayHit) {
        client.caseSignals.push({
          caseType:   "UDAP_Payday",
          defendant:  ah,
          strength:   "medium",
          evidence:   [`Account with predatory lender: ${ah}`, `Balance: $${balance}`],
          recoveryKey: "UDAP_Payday",
        });
        matchedCaseTypes.add("UDAP_Payday");
      }

      // ── Data Breach ────────────────────────────────────────────────────────
      for (const [kw, info] of Object.entries(DATA_BREACH_COMPANIES)) {
        if (ah.toLowerCase().includes(kw)) {
          client.caseSignals.push({
            caseType:   "DataBreach",
            defendant:  ah,
            strength:   info.year >= 2024 ? "high" : "medium",
            evidence:   [`Account with ${ah}`, `Breach year: ${info.year}`, info.note],
            recoveryKey: "DataBreach",
          });
          matchedCaseTypes.add("DataBreach");
        }
      }
    }

    // Skip people with no case signals
    if (matchedCaseTypes.size === 0) return;

    stats.matched++;

    // ── Dedup signals (one per case_type+defendant combo) ───────────────────
    const seen = new Set();
    client.caseSignals = client.caseSignals.filter(s => {
      const key = `${s.caseType}|${s.defendant}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Priority score ───────────────────────────────────────────────────────
    let score = 0;
    const sWeights = { high: 40, medium: 20, low: 10 };
    for (const s of client.caseSignals) score += sWeights[s.strength] || 10;
    if (phone)  score += 15;
    if (email)  score += 10;
    if (matchedCaseTypes.size > 1) score += 10;
    client.priorityScore  = Math.min(score, 100);
    client.matchedCases   = [...matchedCaseTypes];
    client.intakeReady    = score >= 50 && (!!phone || !!email);

    if (client.intakeReady) stats.intake_ready++;

    // ── Recovery estimate ────────────────────────────────────────────────────
    let recLow = 0, recMid = 0, recHigh = 0;
    for (const ct of matchedCaseTypes) {
      const r = RECOVERY[ct];
      if (r) { recLow += r.low; recMid += r.mid; recHigh += r.high; }
    }
    client.recoveryEstimate = { low: recLow, mid: recMid, high: recHigh };
    stats.recovery.low  += recLow;
    stats.recovery.mid  += recMid;
    stats.recovery.high += recHigh;

    for (const ct of matchedCaseTypes) {
      stats.by_case_type[ct] = (stats.by_case_type[ct] || 0) + 1;
    }

    // ── Buffer KV writes ─────────────────────────────────────────────────────
    const now = Date.now();
    kvBatch.push(["SET", `client:${clientId}`, JSON.stringify(client)]);
    kvBatch.push(["ZADD", "clients_by_date", now, clientId]);
    kvBatch.push(["ZADD", "credit_portfolio:by_score", client.priorityScore, clientId]);
    kvBatch.push(["SADD", "tcpa:clients_pending_match", clientId]);

    if (kvBatch.length >= BATCH_SIZE) {
      await flushBatch(true);
    }

    // Keep top 200 for summary
    if (topLeads.length < 200) {
      topLeads.push({
        id: clientId, name: fullName, phone, email,
        state: client.state,
        score: client.priorityScore,
        cases: client.matchedCases,
        recovery: client.recoveryEstimate,
      });
    }

    if (stats.matched % 1000 === 0) {
      process.stdout.write(`\r  Matched: ${stats.matched.toLocaleString()} / ${stats.total.toLocaleString()} processed...`);
    }
  });

  // Flush remaining
  await flushBatch(true);
  console.log();

  // ── Step 3: Write portfolio stats to KV ───────────────────────────────────
  console.log("\nStep 3: Writing portfolio stats to KV...");

  const portfolioStats = {
    ingestedAt:      new Date().toISOString(),
    totalInDataset:  1400000, // full credit.com file has 1.4M
    sampleProcessed: stats.total,
    excluded:        { dnc: stats.excluded_dnc, noContact: stats.excluded_no_contact },
    matched:         stats.matched,
    intakeReady:     stats.intake_ready,
    matchRate:       +((stats.matched / stats.total * 100).toFixed(1)),
    byCaseType:      stats.by_case_type,
    byDefendant:     Object.entries(stats.by_defendant)
                       .sort((a,b) => b[1]-a[1]).slice(0, 25)
                       .map(([d,c]) => ({ defendant: d, count: c })),
    recovery: {
      sampleLow:   stats.recovery.low,
      sampleMid:   stats.recovery.mid,
      sampleHigh:  stats.recovery.high,
      // Extrapolate to full 1.4M dataset based on sample match rate
      extrapolatedFactor: +(1400000 / Math.max(stats.total, 1)).toFixed(2),
      fullDatasetLow:     Math.round(stats.recovery.low  * (1400000 / Math.max(stats.total, 1))),
      fullDatasetMid:     Math.round(stats.recovery.mid  * (1400000 / Math.max(stats.total, 1))),
      fullDatasetHigh:    Math.round(stats.recovery.high * (1400000 / Math.max(stats.total, 1))),
    },
    topLeads: topLeads.sort((a,b) => b.score - a.score).slice(0, 50),
  };

  await kvSet("credit_portfolio:stats", portfolioStats);
  console.log("  Portfolio stats written to KV.");

  // ── Step 4: Write local results file ──────────────────────────────────────
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ ...portfolioStats, topLeads }, null, 2));

  // ── Summary ───────────────────────────────────────────────────────────────
  const factor = portfolioStats.recovery.extrapolatedFactor;
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`\nPeople processed (sample):   ${stats.total.toLocaleString()}`);
  console.log(`  Excluded (DNC/no consent): ${stats.excluded_dnc.toLocaleString()}`);
  console.log(`  Excluded (no contact):     ${stats.excluded_no_contact.toLocaleString()}`);
  console.log(`  Matched to a case:         ${stats.matched.toLocaleString()} (${portfolioStats.matchRate}%)`);
  console.log(`  Intake-ready:              ${stats.intake_ready.toLocaleString()}`);
  console.log(`\nCASE TYPE BREAKDOWN (sample):`);
  const sortedTypes = Object.entries(stats.by_case_type).sort((a,b) => b[1]-a[1]);
  for (const [ct, n] of sortedTypes) {
    const r = RECOVERY[ct] || {};
    console.log(`  ${ct.padEnd(14)} ${String(n).padStart(7)} people  |  $${r.mid||0}/person avg  =  $${(n*(r.mid||0)).toLocaleString()}`);
  }
  console.log(`\nTOTAL SAMPLE RECOVERY ESTIMATE:`);
  console.log(`  Conservative: $${stats.recovery.low.toLocaleString()}`);
  console.log(`  Mid:          $${stats.recovery.mid.toLocaleString()}`);
  console.log(`  Aggressive:   $${stats.recovery.high.toLocaleString()}`);
  console.log(`\nFULL DATASET (1.4M people) EXTRAPOLATED:`);
  console.log(`  Conservative: $${portfolioStats.recovery.fullDatasetLow.toLocaleString()}`);
  console.log(`  Mid:          $${portfolioStats.recovery.fullDatasetMid.toLocaleString()}`);
  console.log(`  Aggressive:   $${portfolioStats.recovery.fullDatasetHigh.toLocaleString()}`);
  console.log(`\nResults written to: ${RESULTS_FILE}`);
  console.log(`Clients written to Vercel KV: ${stats.matched.toLocaleString()}`);
  console.log(`\nNext step: run match-batch to score clients against TCPA cases:`);
  console.log(`  curl -X POST https://your-app.vercel.app/api/match-batch?mode=all`);
  console.log("=".repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
