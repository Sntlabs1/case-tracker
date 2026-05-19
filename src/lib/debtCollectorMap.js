// Creditor ↔ Debt-Buyer/Collector relationship map.
//
// PURPOSE: Credit reports name the ORIGINAL CREDITOR (e.g. "Visa / Chase").
// TCPA/FDCPA lawsuits name the DEBT BUYER who purchased the charged-off
// account and then autodialed the consumer (e.g. "Midland Funding LLC").
// Without this map the matcher misses the link entirely.
//
// DATA SOURCES: SEC filings (Encore Capital 10-K, PRA Group 10-K, Sherman
// Financial prospectuses), CFPB enforcement orders, PACER class-action
// dockets, FDIC call reports, FTC debt-buyer studies (2013, 2022).
//
// STRUCTURE:
//   CREDITOR_TO_BUYERS   — original creditor → debt buyers that typically
//                          purchase their charged-off paper
//   BUYER_TO_CREDITORS   — debt buyer/collector → original creditors they
//                          most commonly collect for (auto-built reverse)
//   CREDITOR_ALIASES     — common abbreviations/brand names → canonical key
//   BUYER_ALIASES        — collector trade names → canonical key
//
// SCORING (used by tcpaMatchRubric.js):
//   +30  Creditor on report is the case defendant's known "source creditor"
//        (i.e. the buyer definitely buys from this creditor)
//   +20  Creditor on report feeds one of the case defendant's typical pools
//        (i.e. the buyer commonly buys from this creditor's category)

// ── Canonical creditor keys → typical debt buyers ───────────────────────────
// Keys are lowercase, no punctuation. Values are canonical buyer names
// (matched against case defendants via the buyer aliases table below).

export const CREDITOR_TO_BUYERS = {

  // ── MAJOR BANKS — CREDIT CARDS ───────────────────────────────────────────

  "bank of america": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "cavalry portfolio services",
    "cavalry spv i",
    "asset acceptance",
    "unifin",
    "ars national services",
    "alltran financial",
    "firstsource advantage",
  ],

  "capital one": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "asset acceptance",
    "unifin",
    "convergent outsourcing",
    "jefferson capital systems",
    "crown asset management",
  ],

  "citibank": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "cavalry portfolio services",
    "cavalry spv i",
    "convergent outsourcing",
    "firstsource advantage",
    "unifin",
    "asset acceptance",
    "ars national services",
    "national enterprise systems",
  ],

  "chase": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "cavalry portfolio services",
    "cavalry spv i",
    "unifin",
    "convergent outsourcing",
    "firstsource advantage",
  ],

  "wells fargo": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "cavalry portfolio services",
    "asset acceptance",
  ],

  "discover": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "cavalry portfolio services",
    "convergent outsourcing",
    "unifin",
  ],

  "american express": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "cavalry portfolio services",
    "jefferson capital systems",
    "asset acceptance",
    "unifin",
  ],

  "hsbc": [
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "portfolio recovery associates",
    "asset acceptance",
    "cavalry portfolio services",
  ],

  "barclays": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],

  "us bank": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "convergent outsourcing",
    "unifin",
  ],

  "regions bank": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
  ],

  "suntrust": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
  ],

  "truist": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
  ],

  "bbt": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
  ],

  "td bank": [
    "portfolio recovery associates",
    "midland credit management",
    "jefferson capital systems",
    "lvnv funding",
  ],

  "fifth third bank": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
    "convergent outsourcing",
  ],

  "pnc bank": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
  ],

  "key bank": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
  ],

  "citizens bank": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
  ],

  "ally financial": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "convergent outsourcing",
  ],

  // Ally Financial as a TCPA / FDCPA defendant — auto loan servicer with high
  // call volume on delinquent accounts. Also sells charged-off auto debt.
  // (Ally appears in CREDITOR_ALIASES: "ally" → "ally financial" above)

  // Barclays Bank Delaware — credit card issuer; TCPA defendant in autodialer
  // cases. Charged-off accounts go to the buyers listed under "barclays" above.
  // (Barclays already in CREDITOR_TO_BUYERS above at line ~124)

  "household finance": [
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "cavalry portfolio services",
    "asset acceptance",
  ],

  "household bank": [
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "portfolio recovery associates",
  ],

  "ge capital": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "cavalry portfolio services",
    "asset acceptance",
    "lvnv funding",
  ],

  "ge money bank": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
    "jefferson capital systems",
  ],

  "providian": [
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "lvnv funding",
    "cavalry portfolio services",
  ],

  "first premier bank": [
    "lvnv funding",
    "resurgent capital services",
    "midland credit management",
    "jefferson capital systems",
  ],

  "compucredit": [
    "portfolio recovery associates",
    "midland credit management",
    "lvnv funding",
    "asset acceptance",
  ],

  "aspire financial": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],

  "fingerhut": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],

  "beneficial finance": [
    "lvnv funding",
    "midland credit management",
    "portfolio recovery associates",
  ],

  // ── STORE CARDS — SYNCHRONY BANK ─────────────────────────────────────────
  // Synchrony issues store cards under dozens of retail brands. After
  // charge-off Synchrony sells portfolios in bulk to the buyers below.
  // The credit report will say the store name (e.g. "Amazon") OR "Synchrony Bank".

  "synchrony bank": [
    "lvnv funding",
    "resurgent capital services",
    "midland credit management",
    "midland funding",
    "jefferson capital systems",
    "portfolio recovery associates",
    "crown asset management",
    "credit corp solutions",
  ],

  // Synchrony-issued retail brands
  "amazon": [
    "lvnv funding",
    "midland credit management",
    "midland funding",
    "jefferson capital systems",
    "portfolio recovery associates",
  ],
  "amazon store card": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "paypal credit": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
    "portfolio recovery associates",
  ],
  "lowes": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
    "portfolio recovery associates",
  ],
  "sams club": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "gap": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "old navy": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "banana republic": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "tjx": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "marshalls": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "tj maxx": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "jcpenney": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
    "portfolio recovery associates",
  ],
  "carecredit": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "ashley furniture": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "guitar center": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "chevron": [
    "lvnv funding",
    "midland credit management",
  ],
  "bp": [
    "lvnv funding",
    "midland credit management",
  ],
  "rooms to go": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "hsn": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
    "comenity bank",
  ],
  "sweetwater": [
    "lvnv funding",
    "midland credit management",
  ],

  // ── STORE CARDS — COMENITY BANK / BREAD FINANCIAL ────────────────────────
  // Comenity issues for 100+ retailers. Charged-off accounts → LVNV, Midland,
  // Jefferson Capital. The report may show store name OR "Comenity Bank".

  "comenity bank": [
    "lvnv funding",
    "resurgent capital services",
    "midland credit management",
    "midland funding",
    "jefferson capital systems",
    "crown asset management",
    "portfolio recovery associates",
  ],
  "comenity capital": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "bread financial": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  // Comenity-issued retail brands
  "victorias secret": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "lane bryant": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "express": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "torrid": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "ann taylor": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "loft": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "jcrew": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "abercrombie": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "talbots": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "pier 1": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "ulta": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "buckle": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "world market": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "cost plus": [
    "lvnv funding",
    "midland credit management",
  ],
  "overstock": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "wayfair": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "zales": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "kay jewelers": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "jared": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "sportsmans guide": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "blair": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "childrens place": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],
  "coldwater creek": [
    "lvnv funding",
    "midland credit management",
  ],
  "qvc": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  // ── STORE CARDS — OTHER ISSUERS ──────────────────────────────────────────

  "target": [   // Target/RedCard issued by TD Bank, then various buyers
    "portfolio recovery associates",
    "midland credit management",
    "midland funding",
    "jefferson capital systems",
    "lvnv funding",
  ],
  "walmart": [  // Walmart Mastercard: Capital One (since 2019) before was Synchrony
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],
  "home depot": [  // Citibank-issued
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "cavalry portfolio services",
  ],
  "best buy": [  // Citibank/CBNA-issued
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],
  "costco": [   // Citi (since 2016, was AmEx before)
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],
  "kohls": [    // Capital One-issued
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],
  "macys": [    // Citibank-issued
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "cavalry portfolio services",
  ],
  "bloomingdales": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],
  "sears": [    // Citibank → Midland/PRA
    "midland credit management",
    "midland funding",
    "portfolio recovery associates",
    "lvnv funding",
    "cavalry portfolio services",
  ],
  "kmart": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],
  "jcpenney credit": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  // ── TELECOM — AT&T FAMILY ─────────────────────────────────────────────────

  "att": [
    "enhanced recovery company",
    "convergent outsourcing",
    "ic system",
    "nco group",
    "ars national services",
    "firstsource advantage",
    "alltran financial",
    "national enterprise systems",
    "progressive management systems",
    "portfolio recovery associates",   // AT&T sells aged debt to PRA
  ],

  "directv": [
    "enhanced recovery company",
    "convergent outsourcing",
    "ic system",
    "nco group",
    "firstsource advantage",
  ],

  "att mobility": [
    "enhanced recovery company",
    "convergent outsourcing",
    "ic system",
    "nco group",
    "ars national services",
  ],

  // ── TELECOM — VERIZON FAMILY ──────────────────────────────────────────────

  "verizon": [
    "enhanced recovery company",
    "ic system",
    "convergent outsourcing",
    "nco group",
    "firstsource advantage",
    "ars national services",
    "portfolio recovery associates",
  ],

  "verizon wireless": [
    "enhanced recovery company",
    "ic system",
    "convergent outsourcing",
    "nco group",
    "firstsource advantage",
  ],

  // ── TELECOM — T-MOBILE / SPRINT ───────────────────────────────────────────

  "tmobile": [
    "ic system",
    "convergent outsourcing",
    "enhanced recovery company",
    "jefferson capital systems",
    "portfolio recovery associates",
    "nco group",
    "firstsource advantage",
  ],

  "sprint": [
    "ic system",
    "convergent outsourcing",
    "enhanced recovery company",
    "jefferson capital systems",
    "portfolio recovery associates",
    "nco group",
  ],

  "metro pcs": [
    "ic system",
    "convergent outsourcing",
    "jefferson capital systems",
  ],

  "boost mobile": [
    "ic system",
    "convergent outsourcing",
    "jefferson capital systems",
  ],

  // ── CABLE / INTERNET ──────────────────────────────────────────────────────

  "comcast": [
    "enhanced recovery company",
    "nco group",
    "convergent outsourcing",
    "ic system",
    "firstsource advantage",
    "ars national services",
    "progressive management systems",
  ],

  "xfinity": [
    "enhanced recovery company",
    "nco group",
    "convergent outsourcing",
    "ic system",
  ],

  "charter": [
    "enhanced recovery company",
    "ic system",
    "nco group",
    "convergent outsourcing",
    "progressive management systems",
  ],

  "spectrum": [
    "enhanced recovery company",
    "ic system",
    "nco group",
    "convergent outsourcing",
  ],

  "cox communications": [
    "enhanced recovery company",
    "nco group",
    "ic system",
    "convergent outsourcing",
    "firstsource advantage",
  ],

  "dish network": [
    "enhanced recovery company",
    "ic system",
    "nco group",
    "convergent outsourcing",
    "firstsource advantage",
  ],

  "time warner cable": [
    "enhanced recovery company",
    "nco group",
    "ic system",
    "convergent outsourcing",
  ],

  "altice": [
    "enhanced recovery company",
    "ic system",
    "nco group",
  ],

  "centurylink": [
    "enhanced recovery company",
    "ic system",
    "convergent outsourcing",
  ],

  "lumen": [
    "enhanced recovery company",
    "ic system",
    "convergent outsourcing",
  ],

  "frontier communications": [
    "enhanced recovery company",
    "ic system",
    "convergent outsourcing",
    "nco group",
  ],

  // ── AUTO FINANCE ──────────────────────────────────────────────────────────

  "santander consumer usa": [
    "midland credit management",
    "portfolio recovery associates",
    "convergent outsourcing",
    "firstsource advantage",
  ],

  "gm financial": [
    "midland credit management",
    "portfolio recovery associates",
    "convergent outsourcing",
  ],

  "americredit": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],

  "ford motor credit": [
    "dcm services",
    "ars national services",
    "convergent outsourcing",
    "portfolio recovery associates",
  ],

  "chrysler capital": [
    "midland credit management",
    "portfolio recovery associates",
    "convergent outsourcing",
  ],

  "toyota financial services": [
    "convergent outsourcing",
    "firstsource advantage",
    "portfolio recovery associates",
  ],

  "honda financial services": [
    "convergent outsourcing",
    "firstsource advantage",
    "portfolio recovery associates",
  ],

  "credit acceptance corp": [
    "convergent outsourcing",
    "firstsource advantage",
    "united collection bureau",
  ],

  "westlake financial": [
    "convergent outsourcing",
    "portfolio recovery associates",
  ],

  "drivetime": [
    "convergent outsourcing",
    "portfolio recovery associates",
  ],

  "carmax auto finance": [
    "convergent outsourcing",
    "portfolio recovery associates",
  ],

  // ── STUDENT LOANS ─────────────────────────────────────────────────────────

  "navient": [
    "convergent outsourcing",
    "firstsource advantage",
    "alltran financial",
    "pioneer credit recovery",
    "national recoveries",
    "gc services",
  ],

  "sallie mae": [
    "convergent outsourcing",
    "pioneer credit recovery",
    "national recoveries",
    "firstsource advantage",
  ],

  "nelnet": [
    "convergent outsourcing",
    "pioneer credit recovery",
    "firstsource advantage",
  ],

  "great lakes educational loan": [
    "convergent outsourcing",
    "pioneer credit recovery",
  ],

  "pheaa": [
    "pioneer credit recovery",
    "convergent outsourcing",
  ],

  "edfinancial": [
    "convergent outsourcing",
    "pioneer credit recovery",
  ],

  "fedloan": [
    "pioneer credit recovery",
    "convergent outsourcing",
  ],

  // ── MEDICAL / HEALTHCARE ──────────────────────────────────────────────────

  "medical": [
    "amsher collection services",
    "pinnacle credit services",
    "national recovery agency",
    "ic system",
    "cbe group",
    "capio partners",
    "medical data systems",
    "account resolution services",
    "receivable management services",
    "tsi healthcare",
    "nco group",
    "portfolio recovery associates",
  ],

  "hospital": [
    "amsher collection services",
    "pinnacle credit services",
    "national recovery agency",
    "ic system",
    "capio partners",
    "medical data systems",
    "receivable management services",
    "cbe group",
  ],

  "emergency": [
    "amsher collection services",
    "pinnacle credit services",
    "medical data systems",
    "nco group",
    "cbe group",
  ],

  // ── UTILITIES ─────────────────────────────────────────────────────────────

  "utility": [
    "ic system",
    "enhanced recovery company",
    "convergent outsourcing",
    "national recovery agency",
    "nco group",
    "progressive management systems",
  ],

  "electric": [
    "ic system",
    "convergent outsourcing",
    "nco group",
    "progressive management systems",
  ],

  "gas": [
    "ic system",
    "convergent outsourcing",
    "nco group",
  ],

  "water": [
    "ic system",
    "convergent outsourcing",
    "nco group",
  ],

  // ── MORTGAGE SERVICERS (TCPA calls from servicers) ────────────────────────

  "nationstar mortgage": [
    "midland credit management",  // ancillary debt
    "convergent outsourcing",
  ],
  "mr cooper": [
    "convergent outsourcing",
    "firstsource advantage",
  ],
  "ocwen financial": [
    "convergent outsourcing",
    "firstsource advantage",
  ],
  "phh mortgage": [
    "convergent outsourcing",
    "firstsource advantage",
  ],
  "shellpoint mortgage": [
    "convergent outsourcing",
    "firstsource advantage",
  ],
  "select portfolio servicing": [
    "convergent outsourcing",
  ],
  "specialized loan servicing": [
    "convergent outsourcing",
  ],
  "caliber home loans": [
    "convergent outsourcing",
  ],
  "quicken loans": [
    "convergent outsourcing",
  ],
  "rocket mortgage": [
    "convergent outsourcing",
  ],

  // ── FINTECH / PERSONAL LOANS ──────────────────────────────────────────────

  "webbank": [  // WebBank issues for LendingClub, Prosper, Avant, etc.
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],

  "lendingclub": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
    "jefferson capital systems",
  ],

  "prosper": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],

  "avant": [
    "midland credit management",
    "jefferson capital systems",
    "lvnv funding",
  ],

  "onemain financial": [
    "convergent outsourcing",
    "firstsource advantage",
    "united collection bureau",
  ],

  // OneMain Financial (formerly Springleaf Financial) — high-volume personal loans;
  // Springleaf→OneMain merger (2015) means accounts transferred, likely violating
  // FDCPA § 1692g notice requirements. Appears 3x on Stretto joint reports.
  "springleaf financial": [
    "onemain financial",      // same company post-merger; cross-reference
    "convergent outsourcing",
    "firstsource advantage",
    "united collection bureau",
  ],

  "world acceptance": [
    "convergent outsourcing",
    "firstsource advantage",
  ],

  "marlin business": [
    "convergent outsourcing",
    "portfolio recovery associates",
  ],

  "upstart": [
    "midland credit management",
    "jefferson capital systems",
    "lvnv funding",
  ],

  "sofi": [
    "midland credit management",
    "jefferson capital systems",
    "portfolio recovery associates",
  ],

  // ── PAYDAY / HIGH-RATE LENDERS ────────────────────────────────────────────

  "cashnetusa": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
    "cbe group",
  ],

  "check into cash": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  "ace cash express": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  "moneykey": [
    "midland credit management",
    "portfolio recovery associates",
    "lvnv funding",
  ],

  "speedy cash": [
    "lvnv funding",
    "midland credit management",
  ],

  "advance america": [
    "lvnv funding",
    "midland credit management",
    "jefferson capital systems",
  ],

  "check n go": [
    "lvnv funding",
    "midland credit management",
  ],
};

// ── Buyer aliases (trade names → canonical key) ──────────────────────────────
// Many buyers operate under multiple legal entities. Map all to one canonical name
// so `isBuyer()` lookups work regardless of which entity name appears in a case.

export const BUYER_ALIASES = {
  // Encore Capital Group family
  "encore capital":                      "midland credit management",
  "encore capital group":                "midland credit management",
  "midland credit management":           "midland credit management",
  "midland credit management inc":       "midland credit management",
  "midland funding":                     "midland credit management",
  "midland funding llc":                 "midland credit management",
  "midland funding ncc":                 "midland credit management",
  "mcm":                                 "midland credit management",

  // PRA Group family
  "portfolio recovery associates":       "portfolio recovery associates",
  "portfolio recovery associates llc":   "portfolio recovery associates",
  "pra group":                           "portfolio recovery associates",
  "pra":                                 "portfolio recovery associates",
  "asset acceptance":                    "portfolio recovery associates",
  "asset acceptance llc":                "portfolio recovery associates",
  "asset acceptance capital":            "portfolio recovery associates",

  // Sherman Financial / LVNV family
  "lvnv funding":                        "lvnv funding",
  "lvnv funding llc":                    "lvnv funding",
  "resurgent capital services":          "lvnv funding",
  "resurgent capital services lp":       "lvnv funding",
  "alegis group":                        "lvnv funding",
  "sherman financial":                   "lvnv funding",
  "tributech":                           "lvnv funding",

  // Cavalry Portfolio family
  "cavalry portfolio services":          "cavalry portfolio services",
  "cavalry portfolio services llc":      "cavalry portfolio services",
  "cavalry spv i":                       "cavalry portfolio services",
  "cavalry spv i llc":                   "cavalry portfolio services",
  "cavalry spv":                         "cavalry portfolio services",

  // Jefferson Capital
  "jefferson capital systems":           "jefferson capital systems",
  "jefferson capital systems llc":       "jefferson capital systems",
  "jefferson capital":                   "jefferson capital systems",

  // Crown Asset Management
  "crown asset management":              "crown asset management",
  "crown asset management llc":          "crown asset management",
  "cam ix":                              "crown asset management",

  // Unifin
  "unifin":                              "unifin",
  "unifin inc":                          "unifin",
  "unifin receivables":                  "unifin",

  // Convergent Outsourcing
  "convergent outsourcing":              "convergent outsourcing",
  "convergent outsourcing inc":          "convergent outsourcing",
  "convergent":                          "convergent outsourcing",

  // Enhanced Recovery Company
  "enhanced recovery company":           "enhanced recovery company",
  "enhanced recovery company llc":       "enhanced recovery company",
  "erc":                                 "enhanced recovery company",
  "enhanced recovery":                   "enhanced recovery company",
  "enhanced resource centers":           "enhanced recovery company",

  // IC System
  "ic system":                           "ic system",
  "ic system inc":                       "ic system",
  "i c system":                          "ic system",

  // NCO Group / Alorica
  "nco group":                           "nco group",
  "nco group inc":                       "nco group",
  "nco financial systems":               "nco group",
  "alorica":                             "nco group",

  // ARS National Services
  "ars national services":               "ars national services",
  "ars national services inc":           "ars national services",
  "ars":                                 "ars national services",
  "account resolution services":         "ars national services",

  // Alltran Financial (formerly United Recovery Systems)
  "alltran financial":                   "alltran financial",
  "united recovery systems":             "alltran financial",
  "urs":                                 "alltran financial",

  // Firstsource Advantage
  "firstsource advantage":               "firstsource advantage",
  "firstsource advantage llc":           "firstsource advantage",
  "firstsource solutions":               "firstsource advantage",

  // National Enterprise Systems
  "national enterprise systems":         "national enterprise systems",
  "nes":                                 "national enterprise systems",

  // Credit Corp Solutions
  "credit corp solutions":               "credit corp solutions",
  "credit corp":                         "credit corp solutions",

  // CBE Group
  "cbe group":                           "cbe group",
  "cbe group inc":                       "cbe group",

  // AMSHER Collection Services
  "amsher collection services":          "amsher collection services",
  "amsher":                              "amsher collection services",

  // Pinnacle Credit Services
  "pinnacle credit services":            "pinnacle credit services",
  "pinnacle credit":                     "pinnacle credit services",

  // National Recovery Agency
  "national recovery agency":            "national recovery agency",
  "nra":                                 "national recovery agency",

  // Capio Partners
  "capio partners":                      "capio partners",
  "capio":                               "capio partners",

  // Medical Data Systems
  "medical data systems":                "medical data systems",
  "mds":                                 "medical data systems",

  // DCM Services
  "dcm services":                        "dcm services",
  "dcm services llc":                    "dcm services",

  // Pioneer Credit Recovery
  "pioneer credit recovery":             "pioneer credit recovery",
  "pioneer credit":                      "pioneer credit recovery",

  // GC Services
  "gc services":                         "gc services",
  "gc services lp":                      "gc services",

  // Progressive Management Systems
  "progressive management systems":      "progressive management systems",
  "pms":                                 "progressive management systems",

  // United Collection Bureau
  "united collection bureau":            "united collection bureau",
  "ucb":                                 "united collection bureau",

  // National Recoveries
  "national recoveries":                 "national recoveries",
  "national recoveries inc":             "national recoveries",

  // OneMain Financial / Springleaf Financial (same company, post-merger aliases)
  "onemain financial":                   "onemain financial",
  "onemain financial inc":               "onemain financial",
  "onemain":                             "onemain financial",
  "one main financial":                  "onemain financial",
  "springleaf financial":                "onemain financial",   // rebranded 2015
  "springleaf financial services":       "onemain financial",
  "springleaf":                          "onemain financial",

  // Ally Financial (auto loans — TCPA + FDCPA collection calls)
  "ally financial":                      "ally financial",
  "ally financial inc":                  "ally financial",
  "ally bank":                           "ally financial",

  // Barclays Bank Delaware (credit cards)
  "barclays bank delaware":              "barclays",
  "barclays bank":                       "barclays",
  "barclays":                            "barclays",
  "barclays us":                         "barclays",
  "barclaycard us":                      "barclays",
};

// ── Creditor aliases (common names / abbreviations → canonical key) ─────────

export const CREDITOR_ALIASES = {
  // Banks
  "boa":                          "bank of america",
  "bofa":                         "bank of america",
  "b of a":                       "bank of america",
  "bank of america na":           "bank of america",
  "fia card services":            "bank of america",   // BofA credit card subsidiary
  "fia":                          "bank of america",
  "bac":                          "bank of america",
  "merrill lynch":                "bank of america",

  "cap one":                      "capital one",
  "capital one bank":             "capital one",
  "capital one bank usa":         "capital one",
  "capital one na":               "capital one",
  "capital one financial":        "capital one",

  "citi":                         "citibank",
  "citibank na":                  "citibank",
  "citibank sd na":               "citibank",
  "citicorp":                     "citibank",
  "citicorp credit services":     "citibank",
  "citifinancial":                "citibank",
  "citi cards":                   "citibank",
  "dsnb":                         "citibank",          // dept store national bank (Macy's)

  "jpmorgan chase":               "chase",
  "jp morgan chase":              "chase",
  "jpmcb":                        "chase",
  "chase bank":                   "chase",
  "chase bank usa":               "chase",
  "chase bank na":                "chase",
  "wamu":                         "chase",             // WaMu acquired by Chase
  "washington mutual":            "chase",

  "wf":                           "wells fargo",
  "wells fargo bank":             "wells fargo",
  "wells fargo bank na":          "wells fargo",
  "wells fargo card services":    "wells fargo",
  "wachovia":                     "wells fargo",       // acquired by WF

  "discover financial":           "discover",
  "discover bank":                "discover",
  "discover card":                "discover",
  "dm":                           "discover",

  "amex":                         "american express",
  "american express centurion":   "american express",
  "american express bank":        "american express",
  "american express bank fsb":    "american express",

  "hsbc bank":                    "hsbc",
  "hsbc bank usa":                "hsbc",
  "hsbc bank nevada":             "hsbc",
  "hfc":                          "hsbc",             // Household Finance/HSBC
  "beneficial":                   "household finance",

  "barclays bank":                "barclays",
  "barclays bank delaware":       "barclays",
  "barclays us":                  "barclays",
  "barclaycard":                  "barclays",
  "juniper bank":                 "barclays",         // now Barclays

  "usbank":                       "us bank",
  "usb":                          "us bank",
  "us bancorp":                   "us bank",
  "us bank na":                   "us bank",

  "pnc":                          "pnc bank",
  "pnc financial":                "pnc bank",
  "national city":                "pnc bank",         // acquired by PNC

  "suntrust bank":                "suntrust",
  "truist bank":                  "truist",

  "td":                           "td bank",
  "td bank na":                   "td bank",
  "td bank usa":                  "td bank",
  "target national bank":         "td bank",          // Target credit card

  "fifth third":                  "fifth third bank",
  "53":                           "fifth third bank",

  "key":                          "key bank",
  "keybank":                      "key bank",
  "keycorp":                      "key bank",

  "regions":                      "regions bank",
  "amsouth":                      "regions bank",     // acquired by Regions

  "ally":                         "ally financial",
  "gmac":                         "ally financial",   // renamed to Ally

  "ge capital financial":         "ge capital",
  "ge money":                     "ge money bank",
  "gecaf":                        "ge capital",
  "ge capital retail bank":       "synchrony bank",   // GE Capital retail → Synchrony 2014

  // Store cards / Synchrony
  "synchrony":                    "synchrony bank",
  "synchrony financial":          "synchrony bank",
  "ge capital retail":            "synchrony bank",
  "care credit":                  "carecredit",
  "paypal":                       "paypal credit",
  "paypal credit card":           "paypal credit",
  "lowe's":                       "lowes",
  "sam's club":                   "sams club",
  "t.j. maxx":                    "tj maxx",
  "t.j.maxx":                     "tj maxx",
  "j.c. penney":                  "jcpenney",
  "jc penney":                    "jcpenney",

  // Comenity / Bread
  "comenity":                     "comenity bank",
  "comenitybank":                 "comenity bank",    // Stretto format: no space
  "comenity bank na":             "comenity bank",
  "alliance data":                "comenity bank",
  "bread":                        "bread financial",
  "wb":                           "comenity bank",
  "world bank":                   "comenity bank",
  "victoria's secret":            "victorias secret",
  "children's place":             "childrens place",
  "ann taylor loft":              "loft",
  "j. crew":                      "jcrew",

  // Telecom
  "at&t":                         "att",
  "at & t":                       "att",
  "at&t wireless":                "att mobility",
  "at&t services":                "att",
  "at&t mobility":                "att mobility",
  "cingular":                     "att mobility",
  "direct tv":                    "directv",
  "at&t u-verse":                 "att",
  "t mobile":                     "tmobile",
  "t-mobile":                     "tmobile",
  "t-mobile usa":                 "tmobile",
  "sprint nextel":                "sprint",
  "nextel":                       "sprint",
  "metropcs":                     "metro pcs",
  "charter communications":       "charter",
  "charter comm":                 "charter",
  "spectrum":                     "spectrum",
  "time warner":                  "time warner cable",
  "twc":                          "time warner cable",
  "cox":                          "cox communications",

  // Auto
  "santander":                    "santander consumer usa",
  "chrysler financial":           "chrysler capital",
  "td auto finance":              "td bank",
  "gm":                           "gm financial",
  "fmcc":                         "ford motor credit",
  "ford credit":                  "ford motor credit",
  "toyota":                       "toyota financial services",
  "tfs":                          "toyota financial services",
  "hca":                          "honda financial services",
  "honda finance":                "honda financial services",
  "cac":                          "credit acceptance corp",
  "westlake":                     "westlake financial",

  // Student loans
  "navient solutions":            "navient",
  "sallie mae bank":              "sallie mae",
  "pheaa":                        "pheaa",
  "american education services":  "pheaa",
  "aes":                          "pheaa",
  "great lakes":                  "great lakes educational loan",
  "gl":                           "great lakes educational loan",

  // Fintech
  "lending club":                 "lendingclub",
  "lc":                           "lendingclub",
  "upgrade":                      "webbank",
  "best egg":                     "webbank",
  "one main":                     "onemain financial",
  "onemain":                      "onemain financial",
  "springleaf":                   "onemain financial",   // OneMain acquired Springleaf brand
  "springleaf financial":         "onemain financial",
  "springleaf financial s":       "onemain financial",   // Stretto format
  "world acceptance corporation": "world acceptance",

  // Payday
  "cash net usa":                 "cashnetusa",
  "check into cash inc":          "check into cash",
  "ace cash":                     "ace cash express",
  "ace":                          "ace cash express",
  "speedy":                       "speedy cash",
  "advance":                      "advance america",
};

// ── Auto-build reverse index (buyer → set of creditors it buys from) ─────────

export const BUYER_TO_CREDITORS = (() => {
  const map = {};
  for (const [creditor, buyers] of Object.entries(CREDITOR_TO_BUYERS)) {
    for (const buyer of buyers) {
      const canon = BUYER_ALIASES[buyer] || buyer;
      if (!map[canon]) map[canon] = new Set();
      map[canon].add(creditor);
    }
  }
  // Convert Sets to Arrays for serialisability
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
})();

// ── Lookup helpers ────────────────────────────────────────────────────────────

function normaliseKey(raw) {
  return String(raw || "")
    .toLowerCase()
    // Collapse & into nothing (AT&T → att, not "at t")
    .replace(/\s*&\s*/g, "")
    // Remove everything after / (Comenitybank/caesars → comenitybank)
    .replace(/\/.*/g, "")
    .replace(/[^a-z0-9\s]/g, " ")   // strip remaining punctuation
    .replace(/\s+/g, " ")
    .trim()
    // Strip common legal / descriptive suffixes that cause lookup misses.
    // The \b word-boundary ensures we don't mangle mid-word substrings.
    .replace(/\b(n\.?a\.?|na|bank|financial|corp|inc|llc|lp|ltd|usa|national|services?|solutions?|group|holdings?|capital|federal|credit union|cu|fcu|savings|card|cards|auto|mortgage)\b/g, "")
    // Strip isolated single letters left over (e.g. "Capital One Bank USA N" → "N")
    .replace(/\b[a-z]\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Build a normalised lookup table from the alias map (applied once at load).
// This ensures alias keys survive the same normalisation as incoming names.
function buildNormalisedAliasMap(aliasMap) {
  const out = {};
  for (const [k, v] of Object.entries(aliasMap)) {
    const normKey = normaliseKey(k);
    if (normKey) out[normKey] = v;
    // Also store the original key in case normalisation over-strips
    if (k !== normKey) out[k] = v;
  }
  return out;
}

const CREDITOR_ALIASES_NORM = buildNormalisedAliasMap(CREDITOR_ALIASES);
const BUYER_ALIASES_NORM    = buildNormalisedAliasMap(BUYER_ALIASES);

// Resolve a creditor name to its canonical key (checking aliases first).
export function resolveCreditorKey(raw) {
  const norm = normaliseKey(raw);
  // Try normalised alias, then raw alias, then direct lookup
  return CREDITOR_ALIASES_NORM[norm]
      || CREDITOR_ALIASES[norm]
      || (CREDITOR_TO_BUYERS[norm] ? norm : null);
}

// Resolve a collector/buyer name to its canonical key.
export function resolveBuyerKey(raw) {
  const norm = normaliseKey(raw);
  return BUYER_ALIASES_NORM[norm]
      || BUYER_ALIASES[norm]
      || (BUYER_TO_CREDITORS[norm] ? norm : null);
}

// Given a creditor name from a credit report, return the canonical buyer names
// that typically collect on that debt. Empty array if unknown.
export function getTypicalCollectors(creditorName) {
  const key = resolveCreditorKey(creditorName);
  if (!key) return [];
  return [...new Set((CREDITOR_TO_BUYERS[key] || []).map(b => BUYER_ALIASES[b] || b))];
}

// Given a debt buyer / collector name (from a case defendant), return the
// original creditors it typically buys from. Empty array if unknown.
export function getTypicalCreditors(buyerName) {
  const key = resolveBuyerKey(buyerName);
  if (!key) return [];
  return BUYER_TO_CREDITORS[key] || [];
}

// Check whether a creditor name feeds a given buyer's typical portfolio.
// Returns "direct" (mapped explicitly), "category" (same buyer group), or null.
export function chainMatch(creditorName, buyerName) {
  const credKey   = resolveCreditorKey(creditorName);
  const buyerKey  = resolveBuyerKey(buyerName);
  if (!credKey || !buyerKey) return null;

  const buyers = [...new Set((CREDITOR_TO_BUYERS[credKey] || []).map(b => BUYER_ALIASES[b] || b))];
  if (buyers.includes(buyerKey)) return "direct";

  // Category match: same buyer family even if not explicitly listed for this creditor
  // (e.g. any bank's charged-off account can end up at Midland if the dollar amount fits)
  const BUYER_FAMILIES = {
    "midland credit management": ["midland credit management", "portfolio recovery associates", "lvnv funding", "cavalry portfolio services"],
    "portfolio recovery associates": ["midland credit management", "portfolio recovery associates", "lvnv funding", "cavalry portfolio services"],
    "lvnv funding": ["midland credit management", "portfolio recovery associates", "lvnv funding", "cavalry portfolio services"],
    "cavalry portfolio services": ["midland credit management", "portfolio recovery associates", "lvnv funding"],
    "enhanced recovery company": ["enhanced recovery company", "convergent outsourcing", "ic system", "nco group"],
    "ic system": ["enhanced recovery company", "convergent outsourcing", "ic system", "nco group"],
    "convergent outsourcing": ["enhanced recovery company", "convergent outsourcing", "ic system", "nco group"],
  };
  const family = BUYER_FAMILIES[buyerKey] || [];
  if (buyers.some(b => family.includes(b))) return "category";

  return null;
}
