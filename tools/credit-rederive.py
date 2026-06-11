#!/usr/bin/env python3
"""
Credit.com re-derivation — CORRECTED matching, SOL flagging, honest scoring.

Rebuilds the KV client:* records from the intact local source
(/tmp/credit-ingest-work/cr_db.db for LEX + state.pkl.gz for identity), fixing
every data defect the audit found:

  - Removes fabricated caseTypes (TCPA-from-phone, DataBreach-from-ownership).
  - Token/word-aware defendant matching (no "cco"->account, "chase"->purchase).
  - One canonical defendant token (tools/defendant_token.py) for the casepeople join.
  - Real statute-of-limitations status per claim, from actual tradeline dates.
  - The §524 discharge-violation cohort (the only genuinely-live theory in this
    2017-2018 vintage data) computed from bankruptcy filing dates.
  - DNC opt-outs always excluded (no bankruptcy override).
  - intakeReady = actionable (a live/ongoing claim) AND reachable AND not DNC.
  - Honest recovery: statutory maximums over ACTIONABLE claims only, clearly labelled.
  - KV writes CHECK Upstash pipeline results and dead-letter failures (the bug that
    silently pinned the old indexes at the 100MB limit).
  - Sharded by_score:{0..15} indexes (no single oversized zset).

Modes:
  python3 tools/credit-rederive.py lex            # rederive LEX from cr_db.db
  python3 tools/credit-rederive.py lex --limit 50000 --dry-run   # validate, no writes
  python3 tools/credit-rederive.py ccom           # stage CCOM CSV -> cc_tl, rederive (dated)
  python3 tools/credit-rederive.py flip           # RENAME by_score:new:* -> by_score:* + stats

Resumable: checkpoint at WORK_DIR/rederive_ckpt.json (people offset).
"""

import os, sys, re, json, time, gzip, pickle, sqlite3, argparse, http.client, ssl, math
from pathlib import Path
from datetime import date
from collections import defaultdict
import threading
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from defendant_token import canonical_token

# ── Config ──────────────────────────────────────────────────────────────────
WORK_DIR    = Path("/tmp/credit-ingest-work")
CR_DB_FILE  = WORK_DIR / "cr_db.db"
STATE_FILE  = WORK_DIR / "state.pkl.gz"
CKPT_FILE   = WORK_DIR / "rederive_ckpt.json"
DEADLETTER  = WORK_DIR / "rederive_deadletter.jsonl"
PROJECT     = Path("/Users/stef/MDL Business")
PACER_DIR   = PROJECT / "data" / "pacer-cases"

TODAY       = date(2026, 6, 11)
N_SHARDS    = 16
KV_BATCH    = 2000
KV_THREADS  = 32

# Statutory recovery (per-claim statutory ranges — NOT expected value).
RECOVERY = {
    "FDCPA":             {"low": 300,  "mid": 500,   "high": 1000},
    "FCRA":              {"low": 100,  "mid": 300,   "high": 1000},
    "DischargeViolation":{"low": 1000, "mid": 5000,  "high": 15000},
    "RESPA":             {"low": 500,  "mid": 1500,  "high": 5000},
    "StudentLoan":       {"low": 500,  "mid": 2000,  "high": 10000},
    "AutoLending":       {"low": 300,  "mid": 1000,  "high": 5000},
    "UDAP_Payday":       {"low": 200,  "mid": 500,   "high": 2000},
    "DataBreach":        {"low": 75,   "mid": 250,   "high": 3500},
    "OpenSettlement":    {"low": 100,  "mid": 400,   "high": 2500},
}

STATUTE_REF = {
    "FDCPA": "15 USC 1692k — 1yr SOL",
    "FCRA": "15 USC 1681p — 2yr from discovery / 5yr repose",
    "DischargeViolation": "11 USC 524 — discharge injunction, no SOL while reporting",
    "RESPA": "12 USC 2614 — 3yr servicing / 1yr kickback",
    "StudentLoan": "servicing/ongoing; discharge contempt no SOL",
    "AutoLending": "TILA 1-3yr; state UDAP 4-7yr",
    "UDAP_Payday": "state UDAP 3-7yr",
    "DataBreach": "state breach statute; open settlement claim window",
    "OpenSettlement": "Rule 23 class settlement — open claim window / rolling program",
}

# Strong state-UDAP jurisdictions (longer windows, plaintiff-favorable).
STRONG_UDAP = {"CA","IL","NY","TX","FL","NJ","MA","WA","CT","NC"}

# ── Pattern lists (matched with word/token awareness, not bare substring) ────
FDCPA_PAT = [
    "portfolio recovery","midland credit","midland funding","encore capital",
    "lvnv funding","resurgent capital","convergent outsourcing","ic system",
    "i.c. system","amsher","cbe group","diversified consultants","enhanced recovery",
    "firstsource","national credit adjusters","radius global","unifin",
    "transworld","credit corp solutions","southwest credit","credit collection services",
    "cavalry portfolio","cach llc","sherman financial","jefferson capital","hunter warfield",
    "nco financial","united collection","phoenix financial","professional recovery",
    "receivables management","absolute resolutions","pioneer credit recovery",
    "fair collections","security credit","commonwealth financial","wakefield",
    "medical data systems","caine","ad astra","americollect","account resolution",
    "united revenue","national recoveries","first national collection",
]
FDCPA_HIGH = {"portfolio recovery","midland credit","midland funding","lvnv funding","encore capital"}

RESPA_PAT = [
    "ocwen","phh mortgage","nationstar","mr. cooper","mr cooper","ditech","greentree",
    "green tree","caliber home","bsi financial","shellpoint","newrez","specialized loan",
    "cenlar","rushmore","roundpoint","select portfolio","sps mortgage","seterus",
    "wells fargo home",
]
SL_PAT = [
    "navient","sallie mae","great lakes","fedloan","mohela","nelnet","aidvantage",
    "ecmc","pheaa","edfinancial",
]
AUTO_PAT = [
    "credit acceptance","westlake financial","drivetime","consumer portfolio services",
    "santander consumer","american credit acceptance","exeter finance","car hop",
    "jd byrider","gm financial","chrysler capital","regional acceptance",
]
AUTO_HIGH = {"credit acceptance","santander consumer","exeter finance"}
PAYDAY_PAT = [
    "ace cash express","speedy cash","advance america","check into cash","qc holdings",
    "community choice financial","first cash","check n go","world acceptance","world finance",
    "regional management","republic finance","heights finance","onemain financial",
    "springleaf","mariner finance","loanmart","titlemax","loanmax","lendmark",
]

COLLECTION_STATUS = {"collection","charge off","charge-off","repossession","settlement accepted",
                     "incl. in bankruptcy","foreclosure"}

def word_hit(name, pats):
    """Return the matched pattern if it appears as a token-boundary substring."""
    if not name:
        return None
    n = " " + re.sub(r"[^a-z0-9]+", " ", name.lower()).strip() + " "
    for p in pats:
        pp = " " + re.sub(r"[^a-z0-9]+", " ", p.lower()).strip() + " "
        # allow the pattern to appear bounded by non-alnum on both sides
        if pp in n:
            return p
    return None

def parse_ym(s):
    """Parse 'YYYY-MM' or 'YYYY' -> date; messy/implausible formats -> None."""
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})", s)
    if m:
        y, mo = int(m.group(1)), max(1, min(12, int(m.group(2))))
        return date(y, mo, 1) if 1950 <= y <= 2035 else None
    m = re.match(r"^(\d{4})$", s)
    if m:
        y = int(m.group(1))
        return date(y, 1, 1) if 1950 <= y <= 2035 else None
    return None

def parse_mmyy(s):
    """LEX cr_pr.filed / cr_tl.od are MMYY strings ('1213' = Dec 2013)."""
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r"^(\d{2})(\d{2})$", s)
    if not m:
        return None
    mo, yy = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        return None
    y = 2000 + yy if yy <= 26 else 1900 + yy
    return date(y, mo, 1)

def parse_date_any(s):
    return parse_ym(s) or parse_mmyy(s)

def years_old(d):
    if d is None:
        return None
    return (TODAY - d).days / 365.25

# ── SOL classification ──────────────────────────────────────────────────────
def sol_status(case_type, lrd, state, discharge_ongoing):
    """Return one of: discharge_ongoing | live | live_state_udap | time_barred | undated."""
    if discharge_ongoing:
        return "discharge_ongoing"          # 11 USC 524 — no SOL while still reporting
    if case_type in ("DataBreach", "OpenSettlement"):
        return "live"                        # only tagged when an OPEN settlement window matched
    age = years_old(lrd)
    if age is None:
        return "undated"
    if case_type == "FDCPA":
        return "live" if age <= 1 else "time_barred"
    if case_type == "FCRA":
        return "live" if age <= 2 else "time_barred"
    if case_type in ("AutoLending", "UDAP_Payday", "RESPA", "StudentLoan"):
        win = 7 if state in STRONG_UDAP else 4
        return "live_state_udap" if age <= win else "time_barred"
    return "time_barred"

ACTIONABLE = {"live", "live_state_udap", "discharge_ongoing"}

# ── Open-settlement cross-reference (replaces ownership tagging) ─────────────
# Tier-1 tradeline-matchable settlement windows from the wave-1/wave-2 catalogs
# (data/settlements/). Only settlements where the tradeline IS the eligibility
# proxy (financed the vehicle / holds the account / has the collection) are
# tagged at person level; attestation-population plays (beef, Prime, Google)
# are NOT — those stay defendant/base-level only. Deadlines checked vs TODAY.
SETTLEMENT_XREF = [
    dict(defendant="Toyota Motor Credit", needles=["toyota"],
         name="Toyota airbag control unit (ACU) settlement", deadline="2026-12-16",
         windowType="open_claim_window", verified=False, strength="medium",
         odLo="2009-01", odHi="2021-12", source="wave2:auto",
         note="2011-2019 Toyota owners/lessees; financing tradeline is an eligibility proxy — verify model/VIN"),
    dict(defendant="Hyundai Capital America", needles=["hyundai"],
         name="Hyundai/Kia ACU settlement + multistate immobilizer-theft settlement",
         deadline="2027-03-29", windowType="open_claim_window", verified=False,
         strength="medium", source="wave2:auto+wave1",
         note="Affected-model owners/lessees as of Apr 2025; theft settlement runs to 2027-03-31; verify model"),
    dict(defendant="Kia Finance America", needles=["kia"],
         name="Kia ACU / Theta II engine / immobilizer-theft settlements",
         deadline="2027-03-29", windowType="open_claim_window", verified=False,
         strength="medium", source="wave2:auto+wave1",
         note="Affected-model owners/lessees; engine settlement ongoing; verify model/VIN"),
    dict(defendant="Mercedes-Benz Financial", needles=["mercedes"],
         name="Mercedes BlueTEC diesel AEM settlement", deadline="2026-09-30",
         windowType="open_claim_window", verified=False, strength="medium",
         odLo="2008-01", odHi="2018-12", source="wave2:auto",
         note="2009-2016 BlueTEC diesel owners/lessees; $2,000 + software fix; verify model"),
    dict(defendant="Nissan Motor Acceptance", needles=["nissan", "infiniti"],
         name="Nissan CVT transmission settlement", deadline=None,
         windowType="rolling", verified=False, strength="medium",
         odLo="2013-01", odHi="2020-12", source="wave2:auto",
         note="2014-2018 Rogue/Pathfinder/QX60 CVT failures; $1,500-$5,000; rolling (30 days after repair); repair docs needed"),
    dict(defendant="Ford Motor Credit", needles=["ford motor", "ford credit", "ford cred", "ford mtr", "fordcredit"],
         name="Ford PowerShift transmission settlement (Focus/Fiesta)", deadline=None,
         windowType="rolling", verified=False, strength="medium",
         odLo="2010-01", odHi="2018-12", source="wave2:auto",
         note="2011-2016 Focus/Fiesta transmission problems; up to $2,325; verify model"),
    dict(defendant="GM Financial", needles=["gm financial", "americredit"],
         name="GM Duramax CP4 fuel pump settlement", deadline=None,
         windowType="rolling", verified=False, strength="medium", source="wave2:auto",
         note="Duramax diesel truck buyers in specified states; verify model/state"),
    dict(defendant="BMO Bank", needles=["bmo", "bank of the west"],
         name="BMO repossession-notice settlement (Wisconsin)", deadline="2026-06-17",
         windowType="open_claim_window", verified=False, strength="high",
         states={"WI"}, requireCollection=True, source="wave2:banking",
         note="WI consumers with BMO/Bank of the West repossession notices 2021-2026; direct tradeline+state match"),
    dict(defendant="Sarasota Memorial Health", needles=["sarasota mem", "sarasota memorial"],
         name="Sarasota Memorial debt-collection settlement (Florida)", deadline="2026-07-10",
         windowType="open_claim_window", verified=False, strength="high",
         states={"FL"}, source="wave2:banking",
         note="FL residents contacted about Sarasota Memorial debts 2017-2026; direct tradeline+state match"),
    dict(defendant="Genesis Financial Solutions (Concora)", needles=["concora", "genesis financial", "genesis fs", "milestone", "indigo"],
         name="Ford v. Genesis — Maryland unlicensed-lending settlement", deadline="2026-06-29",
         windowType="open_claim_window", verified=True, strength="high",
         states={"MD"}, source="wave1:claim_filing",
         note="MD consumers with Genesis-serviced accounts (Milestone/Indigo); claim form + mailed PIN"),
]

def _window_live(ent):
    """A settlement is taggable only while its window is live as of TODAY."""
    if ent.get("windowType") in ("rolling", "automatic_payment"):
        return True
    dl = ent.get("deadline")
    if not dl:
        return True
    try:
        return date.fromisoformat(dl) >= TODAY
    except ValueError:
        return True

def load_xref_entities():
    """Combined settlement xref: open breach settlements (DataBreach, as in the
    v2 run) + tier-1 tradeline-matchable settlement windows (OpenSettlement).
    Returns a list of dicts: {needles, caseType, defendant, name, deadline,
    verified, strength, states, requireCollection, odLo, odHi, note}."""
    ents = []
    try:
        data = json.loads((PACER_DIR / "_breach_settlements_open.json").read_text())
        for s in data.get("settlements", []):
            nm = (s.get("name") or "").strip()
            if nm:
                core = re.sub(r"[^a-z0-9 ]", " ", nm.lower()).strip()
                ents.append(dict(needles=[core], caseType="DataBreach",
                                 defendant=s.get("name"), name=f"{s.get('name')} data breach settlement",
                                 deadline=s.get("deadline"), verified=True, strength="high",
                                 windowType="open_claim_window",
                                 note=s.get("note") or "Open data-breach settlement; class = notice recipients"))
    except Exception as e:
        print(f"  WARN: breach settlements not loaded: {e}")
    covered = {e["needles"][0].split()[0] for e in ents if e["needles"]}
    try:
        w2 = json.loads((PROJECT / "data" / "settlements" / "open-settlements-wave2-2026-06.json").read_text())
        for s in w2.get("data_breach_consumer_financial", []):
            nm = (s.get("defendant") or "").strip()
            core = re.sub(r"[^a-z0-9 ]", " ", nm.lower()).strip()
            if not core or core.split()[0] in covered:
                continue
            ents.append(dict(needles=[core], caseType="DataBreach",
                             defendant=nm, name=f"{nm} data breach settlement",
                             deadline=s.get("deadline"), verified=False, strength="medium",
                             windowType="open_claim_window",
                             note=s.get("note") or "Aggregator-sourced breach settlement; verify admin site before outreach"))
    except Exception as e:
        print(f"  WARN: wave-2 breach settlements not loaded: {e}")
    for ent in SETTLEMENT_XREF:
        ents.append(dict(ent, caseType="OpenSettlement"))
    live = [e for e in ents if _window_live(e)]
    print(f"  xref entities: {len(live)} live settlement windows ({len(ents) - len(live)} expired dropped)")
    return live

# ── State (identity) ─────────────────────────────────────────────────────────
def load_state():
    with gzip.open(STATE_FILE, "rb") as f:
        st = pickle.load(f)
    return st["people"], set(st.get("bankrupt_ids", set()))

# ── KV writer with RESULT CHECKING + dead-letter ────────────────────────────
def load_env():
    for fn in (".env.local", ".env"):
        p = PROJECT / fn
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r"^([^#=\s]+)\s*=\s*(.*)$", line)
                if m:
                    os.environ.setdefault(m.group(1), m.group(2).strip().strip("\"'"))

load_env()
KV_URL   = os.environ.get("KV_REST_API_URL", "")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
if not KV_URL or not KV_TOKEN:
    print("ERROR: KV_REST_API_URL / KV_REST_API_TOKEN required (vercel env pull .env.local)")
    sys.exit(1)
_KV_HOST = KV_URL.split("//")[-1].split("/")[0]
_KV_CTX  = ssl.create_default_context()
_tl      = threading.local()

kv_lock = threading.Lock()
kv_ok = 0
kv_cmd_errors = 0
kv_http_errors = 0

def _conn():
    c = getattr(_tl, "c", None)
    if c is None:
        c = http.client.HTTPSConnection(_KV_HOST, context=_KV_CTX, timeout=40)
        _tl.c = c
    return c

def kv_fire(commands):
    """POST a pipeline batch and PARSE the per-command results. Dead-letter failures."""
    global kv_ok, kv_cmd_errors, kv_http_errors
    if not commands:
        return
    body = json.dumps(commands).encode()
    hdrs = {"Authorization": f"Bearer {KV_TOKEN}", "Content-Type": "application/json",
            "Content-Length": str(len(body)), "Connection": "keep-alive"}
    for attempt in range(4):
        try:
            c = _conn()
            c.request("POST", "/pipeline", body=body, headers=hdrs)
            r = c.getresponse()
            raw = r.read()
            if r.status != 200:
                if attempt < 3:
                    _tl.c = None; time.sleep(0.5 * (attempt + 1)); continue
                with kv_lock:
                    kv_http_errors += 1
                _deadletter(commands, f"http {r.status}: {raw[:200]!r}")
                return
            results = json.loads(raw)
            errs = 0
            failed = []
            for cmd, res in zip(commands, results if isinstance(results, list) else []):
                if isinstance(res, dict) and res.get("error"):
                    errs += 1
                    failed.append((cmd, res["error"]))
            with kv_lock:
                kv_ok += len(commands) - errs
                kv_cmd_errors += errs
            if failed:
                _deadletter([c for c, _ in failed], failed[0][1])
            return
        except Exception as e:
            _tl.c = None
            if attempt < 3:
                time.sleep(0.5 * (attempt + 1)); continue
            with kv_lock:
                kv_http_errors += 1
            _deadletter(commands, f"exc: {e}")

def kv_get_one(key):
    """Synchronous single GET (for catalog loading / flip helpers)."""
    c = http.client.HTTPSConnection(_KV_HOST, context=_KV_CTX, timeout=40)
    body = json.dumps([["GET", key]]).encode()
    c.request("POST", "/pipeline", body=body, headers={
        "Authorization": f"Bearer {KV_TOKEN}", "Content-Type": "application/json",
        "Content-Length": str(len(body))})
    r = c.getresponse()
    res = json.loads(r.read())
    return (res[0] or {}).get("result")

def kv_scan_keys(match):
    """SCAN all keys matching a glob via the REST scan endpoint."""
    keys, cursor = [], "0"
    while True:
        c = http.client.HTTPSConnection(_KV_HOST, context=_KV_CTX, timeout=40)
        body = json.dumps([["SCAN", cursor, "MATCH", match, "COUNT", "1000"]]).encode()
        c.request("POST", "/pipeline", body=body, headers={
            "Authorization": f"Bearer {KV_TOKEN}", "Content-Type": "application/json",
            "Content-Length": str(len(body))})
        r = c.getresponse()
        res = json.loads(r.read())
        cursor, batch = res[0]["result"]
        keys.extend(batch)
        if cursor == "0":
            break
    return keys

def load_catalog_tokens():
    """Canonical tokens of every catalog defendant (PACER evidence + TCPA marketers)."""
    toks = set()
    ev = kv_get_one("match:defendant_evidence")
    if ev:
        ev = json.loads(ev)
        for name in (ev.get("clusters") or {}):
            t = canonical_token(name)
            if t: toks.add(t)
    tc = kv_get_one("pacer:tcpa_marketers")
    if tc:
        tc = json.loads(tc)
        for d in (tc.get("defendants") or []):
            t = canonical_token(d.get("defendant") or d.get("defendantQ") or "")
            if t: toks.add(t)
    return toks

_dl_lock = threading.Lock()
def _deadletter(commands, reason):
    with _dl_lock:
        with open(DEADLETTER, "a") as f:
            f.write(json.dumps({"reason": str(reason)[:300], "n": len(commands),
                                "sample": commands[0] if commands else None}) + "\n")

# Async write queue
_buf = []
_buf_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=KV_THREADS)
_futs = []

def kv_push(cmd):
    global _futs
    with _buf_lock:
        _buf.append(cmd)
        if len(_buf) >= KV_BATCH:
            batch = _buf[:]; _buf.clear()
            _futs.append(_pool.submit(kv_fire, batch))
            if len(_futs) > KV_THREADS * 4:
                done = [f for f in _futs if f.done()]
                for f in done: _futs.remove(f)

def kv_drain():
    global _futs
    with _buf_lock:
        if _buf:
            batch = _buf[:]; _buf.clear()
            _futs.append(_pool.submit(kv_fire, batch))
    for f in _futs:
        f.result()
    _futs = []

# ── Credit-report batch fetch (LEX, from cr_db.db) ──────────────────────────
_cr = None
def cr_init():
    global _cr
    _cr = sqlite3.connect(f"file:{CR_DB_FILE}?mode=ro", uri=True, check_same_thread=False)
    _cr.execute("PRAGMA query_only=1")

def fetch_cr(pids):
    out = {pid: {"tl": [], "pr": []} for pid in pids}
    ph = ",".join("?" * len(pids))
    for pid, bureau, od, creditor, orig, typ, bal, lrd, disp in _cr.execute(
        f"SELECT pid,bureau,od,creditor,orig,typ,bal,lrd,disp FROM cr_tl WHERE pid IN ({ph})", pids):
        if pid in out:
            out[pid]["tl"].append(dict(bureau=bureau, od=od, c=creditor, orig=orig,
                                       typ=typ, bal=bal, lrd=lrd, disp=disp))
    for pid, rec_type, chapter, filed, disch in _cr.execute(
        f"SELECT pid,rec_type,chapter,filed,disch FROM cr_pr WHERE pid IN ({ph})", pids):
        if pid in out:
            out[pid]["pr"].append(dict(type=rec_type, chapter=chapter, filed=filed, disch=disch))
    return out

# ── Priority score (v3, 2026-06-11) ─────────────────────────────────────────
# v2 formula (sum of 30/15 strength weights over actionable cases + flat 40 +
# multi-type 10 + contact 13, clamped to 100) pinned ~16% of the index in a
# single tie at 100 (~810K people) — ranking inside the range every reader
# paginates was arbitrary, live_state_udap weighed the same as federal live,
# and an open settlement closing in days got no urgency boost.
#
# v3 (0-100, one decimal, max attainable ~96 so the cap never creates a tie):
#   base      strongest actionable SOL tier: discharge_ongoing 52 > live 48
#             > live_state_udap 40   (replaces the flat +40)
#   signals   per-actionable-case value = strength{high 10, medium 5, low 3}
#             x tier-mult{discharge/live 1.0, udap 0.5}, sorted desc with
#             geometric 0.5^i decay  (bounded ~20; count alone can't dominate)
#   urgency   live settlement window: deadline <=45d +7, <=120d +5, <=365d +3,
#             rolling/undated +1, expired 0
#   breadth   min(4, distinct actionable caseTypes); time-barred-only people
#             get min(4, distinct caseTypes) for class-membership breadth
#   contact   phone +5, email +3
#   recovery  min(5, 1.25*log10(1 + mid/100)) — continuous tiebreak, so equal-
#             profile leads separate by actionable statutory midpoint
# Non-actionable ceiling is 12; actionable floor is ~44 — the bands cannot
# overlap, so a single live signal always outranks any stack of time-barred.
_TIER_BASE = {"discharge_ongoing": 52, "live": 48, "live_state_udap": 40}
_TIER_MULT = {"discharge_ongoing": 1.0, "live": 1.0, "live_state_udap": 0.5}
_STR_W     = {"high": 10, "medium": 5, "low": 3}

def priority_score(cases, act_cases, rec_mid, phone, email):
    base = max((_TIER_BASE.get(c["solStatus"], 0) for c in act_cases), default=0)
    contribs = sorted((_STR_W.get(c["strength"], 3) * _TIER_MULT.get(c["solStatus"], 0.5)
                       for c in act_cases), reverse=True)
    sig = sum(v * (0.5 ** i) for i, v in enumerate(contribs))
    urg = 0
    for c in act_cases:
        s = c.get("settlement")
        if not s:
            continue
        dl = s.get("settlementDeadline")
        days = None
        if dl:
            try:
                days = (date.fromisoformat(dl) - TODAY).days
            except ValueError:
                days = None
        if days is None:
            urg = max(urg, 1)               # rolling / undated open window
        elif days >= 0:
            urg = max(urg, 7 if days <= 45 else 5 if days <= 120 else 3 if days <= 365 else 1)
        # expired window: no boost
    breadth = min(4, len({c["caseType"] for c in (act_cases or cases)}))
    contact = (5 if phone else 0) + (3 if email else 0)
    tie = min(5.0, 1.25 * math.log10(1 + rec_mid / 100.0)) if rec_mid > 0 else 0.0
    return round(min(100.0, max(0.0, base + sig + urg + breadth + contact + tie)), 1)

# ── Per-person derivation ───────────────────────────────────────────────────
def derive_person(pid, ident, cr, bankrupt, xref_ents):
    """Return a client dict (or None to skip)."""
    name, phone, email, state, dnc = ident
    if dnc:
        return ("dnc", None)            # always exclude DNC

    tls = cr.get("tl", [])
    prs = cr.get("pr", [])

    # Bankruptcy filing dates for the §524 overlay.
    bk_filed = []
    for pr in prs:
        if "ankrupt" in str(pr.get("type", "")).lower():
            # LEX cr_pr.filed is an MMYY string; CCOM is staged as YYYY-MM.
            d = parse_date_any(pr.get("filed"))
            if d:
                bk_filed.append((d, str(pr.get("chapter") or "")))
    earliest_bk = min((d for d, _ in bk_filed), default=None)

    # signals[(caseType, token)] = dict(defendant, strength, sol, lrd, meta)
    signals = {}
    def add(ct, defendant, strength, lrd, discharge_ongoing=False, meta=None):
        tok = canonical_token(defendant)
        if not tok:
            return
        sol = sol_status(ct, lrd, state, discharge_ongoing)
        key = (ct, tok)
        prev = signals.get(key)
        better_sol = prev is None or _sol_rank(sol) > _sol_rank(prev["sol"])
        better_str = prev is None or _str_rank(strength) > _str_rank(prev["strength"])
        if prev is None or better_sol or better_str:
            signals[key] = dict(defendant=defendant[:80], token=tok,
                                 strength=strength if (prev is None or better_str) else prev["strength"],
                                 sol=sol if (prev is None or better_sol) else prev["sol"],
                                 lrd=(lrd.isoformat()[:7] if lrd else (prev or {}).get("lrd")),
                                 meta=meta or (prev or {}).get("meta"))

    for tl in tls:
        cname = str(tl.get("c") or "").strip()
        orig  = str(tl.get("orig") or "").strip()
        typ   = str(tl.get("typ") or "").strip().lower()
        disp  = bool(tl.get("disp"))
        bal   = tl.get("bal") or 0
        lrd   = parse_ym(tl.get("lrd"))
        is_collection = any(s in typ for s in COLLECTION_STATUS)

        # §524 discharge-violation overlay: a PRE-PETITION debt (opened before the
        # bankruptcy filing) still reporting a live balance / collection AFTER it.
        od_d = parse_date_any(tl.get("od"))
        if (earliest_bk and lrd and lrd > earliest_bk
                and od_d and od_d < earliest_bk
                and ((bal and bal > 0) or is_collection)):
            add("DischargeViolation", cname or orig or "Furnisher", "high", lrd, discharge_ongoing=True)

        # FCRA — only on a real dispute flag.
        if disp:
            add("FCRA", cname or "Credit Bureau/Furnisher", "high", lrd)

        # FDCPA — collector name + original creditor present + collection/charge-off status.
        if word_hit(cname, FDCPA_PAT) and orig and is_collection:
            strength = "high" if word_hit(cname, list(FDCPA_HIGH)) else "medium"
            add("FDCPA", cname, strength, lrd)

        # AutoLending — predatory subprime auto lenders (stronger when repossession).
        if word_hit(cname, AUTO_PAT):
            strength = "high" if (word_hit(cname, list(AUTO_HIGH)) or "repossession" in typ) else "medium"
            add("AutoLending", cname, strength, lrd)

        # Student loan / RESPA — classify from the creditor name itself.
        if word_hit(cname, SL_PAT):
            add("StudentLoan", cname, "high" if "navient" in cname.lower() else "medium", lrd)
        if word_hit(cname, RESPA_PAT):
            add("RESPA", cname, "medium", lrd)

        # Payday / high-cost installment.
        if word_hit(cname, PAYDAY_PAT):
            add("UDAP_Payday", cname, "medium", lrd)

        # Settlement xref — DataBreach + OpenSettlement, only via a LIVE
        # settlement window whose tradeline match is the eligibility proxy.
        nl = cname + " " + orig
        for ent in xref_ents:
            if not any(word_hit(nl, [n]) for n in ent["needles"]):
                continue
            if ent.get("states") and state not in ent["states"]:
                continue
            if ent.get("requireCollection") and not (is_collection or (bal and bal > 0)):
                continue
            if ent.get("odLo") and od_d:
                if not (date.fromisoformat(ent["odLo"] + "-01") <= od_d
                        <= date.fromisoformat(ent["odHi"] + "-28")):
                    continue
            add(ent["caseType"], ent["defendant"], ent.get("strength", "medium"), lrd,
                meta=dict(settlementName=ent["name"], settlementDeadline=ent.get("deadline"),
                          windowType=ent.get("windowType"), verified=bool(ent.get("verified")),
                          note=ent.get("note")))

    if not signals:
        return ("nosig", None)

    cases = []
    case_types = set()
    sol_counts = defaultdict(int)
    for (ct, tok), s in signals.items():
        r = RECOVERY.get(ct, {})
        sol_counts[s["sol"]] += 1
        case = dict(caseType=ct, defendant=s["defendant"], defendantToken=tok,
                    strength=s["strength"], solStatus=s["sol"], lastReported=s.get("lrd"),
                    statuteRef=STATUTE_REF.get(ct, ""),
                    estRecoveryLow=r.get("low", 0), estRecoveryMid=r.get("mid", 0),
                    estRecoveryHigh=r.get("high", 0))
        if s.get("meta"):
            case["settlement"] = s["meta"]
        cases.append(case)
        case_types.add(ct)

    actionable = any(c["solStatus"] in ACTIONABLE for c in cases)

    # Recovery over ACTIONABLE claims only (statutory maximum, not expected value).
    act_cases = [c for c in cases if c["solStatus"] in ACTIONABLE]
    rec_low = sum(c["estRecoveryLow"] for c in act_cases)
    rec_mid = sum(c["estRecoveryMid"] for c in act_cases)
    rec_high = sum(c["estRecoveryHigh"] for c in act_cases)

    score = priority_score(cases, act_cases, rec_mid, phone, email)

    intake_ready = actionable and (bool(phone) or bool(email))

    lrds = [parse_ym(t.get("lrd")) for t in tls if t.get("lrd")]
    lrds = [d for d in lrds if d]

    client = dict(
        id=pid, name=name, phone=phone, email=email, state=state,
        ingestSource="credit_rederive_v2", ingestedAt=TODAY.isoformat(),
        cases=cases, matchedCases=sorted(case_types),
        actionable=actionable, priorityScore=score, intakeReady=intake_ready,
        recoveryEstimate=dict(low=rec_low, mid=rec_mid, high=rec_high,
                              basis="statutory maximum over actionable claims; not expected value"),
        solSummary=dict(sol_counts),
        dataVintage=dict(oldestReported=min(lrds).isoformat()[:7] if lrds else None,
                         newestReported=max(lrds).isoformat()[:7] if lrds else None),
    )
    if earliest_bk:
        client["bankruptcyFiled"] = earliest_bk.isoformat()[:7]
    return ("ok", client)

def _sol_rank(s):
    return {"discharge_ongoing": 4, "live": 3, "live_state_udap": 2, "undated": 1, "time_barred": 0}.get(s, 0)
def _str_rank(s):
    return {"high": 3, "medium": 2, "low": 1}.get(s, 0)

def shard_of(pid):
    h = 0
    for ch in pid:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % N_SHARDS

# ── LEX phase ────────────────────────────────────────────────────────────────
def run_lex(limit=None, dry=False, batch_pids=1000):
    # NOTE (2026-06-10): writes directly to the LIVE by_score:{shard} zsets
    # (the new->flip flow predates CCOM sharing those shards; flipping now
    # would wipe cc_ members). casepeople is no longer written here — delete
    # casepeople:* + caseindex:stats and force api/build-case-index after.
    print(f"Loading identity state from {STATE_FILE} ...", flush=True)
    people, bankrupt = load_state()
    cr_init()
    xref_ents = load_xref_entities()
    lex_pids = sorted(p for p in people if p.startswith("lex_"))
    if limit:
        lex_pids = lex_pids[:limit]
    total = len(lex_pids)
    print(f"  {len(people):,} people; {total:,} LEX to process; {len(bankrupt):,} bankruptcies; "
          f"{len(xref_ents)} xref entities; dry={dry}", flush=True)

    ckpt = json.loads(CKPT_FILE.read_text()) if (CKPT_FILE.exists() and not dry) else {}
    start = ckpt.get("lex_offset", 0)
    stats = defaultdict(int)
    samples = []
    t0 = time.time()

    for i in range(start, total, batch_pids):
        chunk = lex_pids[i:i + batch_pids]
        crs = fetch_cr(chunk)
        for pid in chunk:
            outcome, client = derive_person(pid, people[pid], crs.get(pid, {}), bankrupt, xref_ents)
            stats[outcome] += 1
            if client is None:
                # No (longer a) signal: remove any record from a previous run.
                if not dry:
                    kv_push(["DEL", f"client:{pid}"])
                    kv_push(["DEL", f"credit_report:{pid}"])
                    kv_push(["ZREM", f"by_score:{shard_of(pid)}", pid])
                continue
            stats["matched"] += 1
            if client["actionable"]:
                stats["actionable"] += 1
            if client["intakeReady"]:
                stats["intakeReady"] += 1
            for c in client["cases"]:
                stats[f"ct:{c['caseType']}"] += 1
                stats[f"sol:{c['solStatus']}"] += 1
            if dry:
                if len(samples) < 8 and client["actionable"]:
                    samples.append(client)
                continue
            kv_push(["SET", f"client:{pid}", json.dumps(client)])
            kv_push(["ZADD", f"by_score:{shard_of(pid)}", client["priorityScore"], pid])
            if client["intakeReady"]:
                rep = {"tl": [dict(c=t.get("c"), orig=t.get("orig"), type=t.get("typ"),
                                   bal=t.get("bal"), od=t.get("od"), lrd=t.get("lrd"),
                                   bureau=t.get("bureau"), disp=bool(t.get("disp")))
                              for t in crs.get(pid, {}).get("tl", [])[:30]],
                       "pr": crs.get(pid, {}).get("pr", [])}
                kv_push(["SET", f"credit_report:{pid}", json.dumps(rep)])
            else:
                kv_push(["DEL", f"credit_report:{pid}"])

        if not dry and (i // batch_pids) % 50 == 0:
            ckpt["lex_offset"] = i
            CKPT_FILE.write_text(json.dumps(ckpt))
            rate = (i - start) / max(1e-9, time.time() - t0)
            print(f"\r  {i:,}/{total:,}  matched={stats['matched']:,} "
                  f"actionable={stats['actionable']:,} ready={stats['intakeReady']:,} "
                  f"ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors} "
                  f"{rate:.0f}/s", end="", flush=True)

    if not dry:
        kv_drain()
        ckpt["lex_offset"] = total
        ckpt["lex_done"] = True
        CKPT_FILE.write_text(json.dumps(ckpt))
    print()
    print("=== LEX rederive stats ===")
    for k in sorted(stats):
        print(f"  {k}: {stats[k]:,}")
    print(f"  kv_ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors}")
    if dry and samples:
        print("\n=== SAMPLE actionable clients ===")
        for s in samples[:4]:
            print(json.dumps(s, indent=2)[:1400])

# ── Flip indexes + write portfolio stats ─────────────────────────────────────
CAP = 200_000   # max members retained per casepeople index

def run_flip():
    print("Flip: by_score + casepeople new -> live; clear old pinned keys ...")
    # 1. Drop the old pinned global zsets.
    kv_fire([["DEL", "credit_portfolio:by_score"], ["DEL", "clients_by_date"]])
    # 2. by_score shards: RENAME new -> live (atomic replace).
    for s in range(N_SHARDS):
        kv_fire([["RENAME", f"by_score:new:{s}", f"by_score:{s}"]])
    # 3. casepeople: delete stale (non-new) keys, then cap + rename the new ones.
    old = [k for k in kv_scan_keys("casepeople:*") if not k.startswith("casepeople:new:")]
    print(f"  deleting {len(old)} stale casepeople keys ...")
    for i in range(0, len(old), 100):
        kv_fire([["DEL", k] for k in old[i:i+100]])
    new = kv_scan_keys("casepeople:new:*")
    print(f"  capping+renaming {len(new)} casepeople keys ...")
    for k in new:
        tok = k[len("casepeople:new:"):]
        kv_fire([["ZREMRANGEBYRANK", k, 0, -(CAP + 1)]])     # keep top CAP by score
        kv_fire([["RENAME", k, f"casepeople:{tok}"]])
    kv_drain()
    print(f"  done. cmd_err={kv_cmd_errors} http_err={kv_http_errors}")

# ── Portfolio stats (parsed from the run's own final tally in the log) ───────
def run_stats(log_path):
    text = Path(log_path).read_text()
    idx = text.rfind("=== LEX rederive stats ===")
    if idx < 0:
        print("No stats block found in log yet."); return
    block = text[idx:]
    vals = {}
    for line in block.splitlines():
        m = re.match(r"\s+([\w:]+):\s+([\d,]+)\s*$", line)
        if m:
            vals[m.group(1)] = int(m.group(2).replace(",", ""))
    by_case = {k.split(":", 1)[1]: v for k, v in vals.items() if k.startswith("ct:")}
    by_sol  = {k.split(":", 1)[1]: v for k, v in vals.items() if k.startswith("sol:")}
    processed = vals.get("matched", 0) + vals.get("nosig", 0) + vals.get("dnc", 0)
    stats = {
        "generatedAt": TODAY.isoformat(),
        "source": "credit_rederive_v2",
        "population": {
            "processed": processed,
            "matched": vals.get("matched", 0),
            "actionable": vals.get("actionable", 0),
            "intakeReady": vals.get("intakeReady", 0),
            "dncExcluded": vals.get("dnc", 0),
            "noSignal": vals.get("nosig", 0),
        },
        "byCaseType": by_case,
        "bySolStatus": by_sol,
        "matchRate": round(vals.get("matched", 0) / max(processed, 1) * 100, 1),
        "actionableRate": round(vals.get("actionable", 0) / max(processed, 1) * 100, 1),
        "note": ("Counts are claim signals after SOL flagging. Recovery figures elsewhere are "
                 "statutory maximums over actionable claims, not expected value. LEX population only "
                 "(dated); CCOM is undated. Source vintage 2017-2024."),
    }
    kv_fire([["SET", "credit_portfolio:stats", json.dumps(stats)]])
    kv_drain()
    print(json.dumps(stats, indent=2))
    print(f"\nwrote credit_portfolio:stats  (cmd_err={kv_cmd_errors} http_err={kv_http_errors})")

# ── CCOM phase ───────────────────────────────────────────────────────────────
# v1 streamed CCOM_EV_Tradelines.csv row-by-row into fabricated signals and
# DELETED the file. The CSV in fact carries DateOpened / BalanceDate /
# FilingDate ("undated" was wrong) — so CCOM gets the same dated SOL treatment
# as LEX. Stage normalizes dates to YYYY-MM in cr_db.db:cc_tl / cc_pr, then the
# derive pass reuses derive_person() unchanged.

CC_CSV = WORK_DIR / "CCOM_EV_Tradelines.csv"

CC_TYP = {
    "COLLECTION": "collection", "CHARGE_OFF": "charge off",
    "REPOSSESSION": "repossession", "FORECLOSURE": "foreclosure",
    "SETTLEMENT": "settlement accepted", "INCL_IN_BANKRUPTCY": "incl. in bankruptcy",
}

def norm_ym(v):
    """Normalize a CSV/pyarrow date value to 'YYYY-MM' or None."""
    import datetime as _dt
    if v is None:
        return None
    if isinstance(v, (_dt.datetime, _dt.date)):
        return f"{v.year:04d}-{v.month:02d}" if 1950 <= v.year <= 2035 else None
    s = str(v).strip()
    if not s or s.upper() in ("NULL", "NONE", "NAT"):
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})", s)
    if m:
        y, mo = int(m.group(1)), max(1, min(12, int(m.group(2))))
        return f"{y:04d}-{mo:02d}" if 1950 <= y <= 2035 else None
    return None

def stage_ccom():
    """One-time: stream the 27M-row CSV into cr_db.db (cc_tl + cc_pr)."""
    import pyarrow.csv as pa_csv

    if not CC_CSV.exists():
        print(f"ERROR: {CC_CSV} not found — download CCOM_EV_Tradelines.csv first.")
        sys.exit(1)

    db = sqlite3.connect(CR_DB_FILE)
    db.execute("PRAGMA synchronous=OFF")
    done = db.execute("SELECT name FROM sqlite_master WHERE name='cc_stage_done'").fetchone()
    if done:
        n = db.execute("SELECT COUNT(*) FROM cc_tl").fetchone()[0]
        print(f"Stage already complete ({n:,} cc_tl rows). DROP TABLE cc_stage_done to redo.")
        db.close()
        return
    db.execute("DROP TABLE IF EXISTS cc_tl")
    db.execute("DROP TABLE IF EXISTS cc_pr")
    db.execute("""CREATE TABLE cc_tl (pid TEXT NOT NULL, creditor TEXT, orig TEXT,
                  typ TEXT, bal INTEGER, od TEXT, lrd TEXT)""")
    db.execute("CREATE TABLE cc_pr (pid TEXT NOT NULL, rec_type TEXT, filed TEXT)")

    ro = pa_csv.ReadOptions(block_size=32 * 1024 * 1024)
    co = pa_csv.ConvertOptions(
        include_columns=["ucid", "AccountHolder", "internal_item_type", "DateOpened",
                         "balance", "internal_item_category", "Experian_item_type",
                         "BalanceDate", "ProcessDT", "FilingDate", "OriginalCreditor"],
        column_types={"ucid": "string", "balance": "string"},
        null_values=["NULL", ""], strings_can_be_null=True)
    reader = iter(pa_csv.open_csv(str(CC_CSV), read_options=ro, convert_options=co))

    rows = tl_n = pr_n = skipped = 0
    t0 = time.time()
    while True:
        try:
            batch = next(reader)
        except StopIteration:
            break
        except Exception:
            skipped += 1
            continue
        d = batch.to_pydict()
        tl_rows, pr_rows = [], []
        for ucid, ah, ityp, od, bal, cat, exp, bdate, pdt, fdate, orig in zip(
            d["ucid"], d["AccountHolder"], d["internal_item_type"], d["DateOpened"],
            d["balance"], d["internal_item_category"], d["Experian_item_type"],
            d["BalanceDate"], d["ProcessDT"], d["FilingDate"], d["OriginalCreditor"]
        ):
            rows += 1
            if not ucid:
                continue
            ityp = str(ityp or "").strip().upper()
            cat  = str(cat or "").strip().upper()
            if ityp == "INQUIRY" or cat == "INQUIRY":
                continue
            pid = f"cc_{ucid}"
            if ityp == "BANKRUPTCY":
                pr_rows.append((pid, "Bankruptcy", norm_ym(fdate) or norm_ym(od)))
                continue
            typ = CC_TYP.get(ityp, ityp.lower().replace("_", " "))
            if exp:
                typ = f"{typ} {exp}"
            try:
                bal_i = int(float(bal)) if bal not in (None, "") else None
            except ValueError:
                bal_i = None
            tl_rows.append((pid, str(ah or "").strip(), str(orig or "").strip(),
                            typ[:120], bal_i, norm_ym(od),
                            norm_ym(bdate) or norm_ym(pdt)))
        if tl_rows:
            db.executemany("INSERT INTO cc_tl VALUES (?,?,?,?,?,?,?)", tl_rows)
            tl_n += len(tl_rows)
        if pr_rows:
            db.executemany("INSERT INTO cc_pr VALUES (?,?,?)", pr_rows)
            pr_n += len(pr_rows)
        db.commit()
        print(f"\r  staged {rows:,} rows -> tl={tl_n:,} pr={pr_n:,} "
              f"({rows / max(1e-9, time.time() - t0):,.0f}/s)", end="", flush=True)
    print()
    if skipped:
        print(f"  skipped {skipped} malformed 32MB blocks")
    print("  indexing ...")
    db.execute("CREATE INDEX ix_cc_tl_pid ON cc_tl(pid)")
    db.execute("CREATE INDEX ix_cc_pr_pid ON cc_pr(pid)")
    db.execute("CREATE TABLE cc_stage_done (at TEXT)")
    db.execute("INSERT INTO cc_stage_done VALUES (?)", (TODAY.isoformat(),))
    db.commit()
    db.close()
    print(f"  stage complete: {tl_n:,} tradelines, {pr_n:,} bankruptcy records")

def fetch_cc(pids):
    out = {pid: {"tl": [], "pr": []} for pid in pids}
    ph = ",".join("?" * len(pids))
    for pid, creditor, orig, typ, bal, od, lrd in _cr.execute(
        f"SELECT pid,creditor,orig,typ,bal,od,lrd FROM cc_tl WHERE pid IN ({ph})", pids):
        if pid in out:
            out[pid]["tl"].append(dict(bureau="CC", od=od, c=creditor, orig=orig,
                                       typ=typ, bal=bal, lrd=lrd, disp=0))
    for pid, rec_type, filed in _cr.execute(
        f"SELECT pid,rec_type,filed FROM cc_pr WHERE pid IN ({ph})", pids):
        if pid in out:
            out[pid]["pr"].append(dict(type=rec_type, chapter="", filed=filed, disch=None))
    return out

def run_ccom(limit=None, dry=False, batch_pids=1000):
    stage_ccom()
    print(f"Loading identity state from {STATE_FILE} ...", flush=True)
    people, bankrupt = load_state()
    cr_init()
    xref_ents = load_xref_entities()
    cc_pids = sorted(p for p in people if p.startswith("cc_"))
    if limit:
        cc_pids = cc_pids[:limit]
    total = len(cc_pids)
    print(f"  {total:,} CCOM people to process; dry={dry}", flush=True)

    ckpt = json.loads(CKPT_FILE.read_text()) if (CKPT_FILE.exists() and not dry) else {}
    start = ckpt.get("ccom_offset", 0)
    stats = defaultdict(int)
    samples = []
    t0 = time.time()

    for i in range(start, total, batch_pids):
        chunk = cc_pids[i:i + batch_pids]
        crs = fetch_cc(chunk)
        for pid in chunk:
            outcome, client = derive_person(pid, people[pid], crs.get(pid, {}), bankrupt, xref_ents)
            stats[outcome] += 1
            if client is None:
                # v1 wrote fabricated client:cc_* records (TCPA-from-phone,
                # DataBreach-from-ownership) — remove them when v2 finds nothing.
                if not dry:
                    kv_push(["DEL", f"client:{pid}"])
                    kv_push(["DEL", f"credit_report:{pid}"])
                continue
            stats["matched"] += 1
            if client["actionable"]:
                stats["actionable"] += 1
            if client["intakeReady"]:
                stats["intakeReady"] += 1
            for c in client["cases"]:
                stats[f"ct:{c['caseType']}"] += 1
                stats[f"sol:{c['solStatus']}"] += 1
            if dry:
                if len(samples) < 8 and client["actionable"]:
                    samples.append(client)
                continue
            kv_push(["SET", f"client:{pid}", json.dumps(client)])
            # by_score shards are already live (post-flip) — write directly.
            kv_push(["ZADD", f"by_score:{shard_of(pid)}", client["priorityScore"], pid])
            if client["intakeReady"]:
                rep = {"tl": [dict(c=t.get("c"), orig=t.get("orig"), type=t.get("typ"),
                                   bal=t.get("bal"), od=t.get("od"), lrd=t.get("lrd"),
                                   bureau=t.get("bureau"), disp=bool(t.get("disp")))
                              for t in crs.get(pid, {}).get("tl", [])[:30]],
                       "pr": crs.get(pid, {}).get("pr", [])}
                kv_push(["SET", f"credit_report:{pid}", json.dumps(rep)])
            else:
                kv_push(["DEL", f"credit_report:{pid}"])

        if not dry and (i // batch_pids) % 50 == 0:
            ckpt["ccom_offset"] = i
            CKPT_FILE.write_text(json.dumps(ckpt))
            rate = (i - start) / max(1e-9, time.time() - t0)
            print(f"\r  {i:,}/{total:,}  matched={stats['matched']:,} "
                  f"actionable={stats['actionable']:,} ready={stats['intakeReady']:,} "
                  f"ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors} "
                  f"{rate:.0f}/s", end="", flush=True)

    if not dry:
        kv_drain()
        ckpt["ccom_offset"] = total
        ckpt["ccom_done"] = True
        CKPT_FILE.write_text(json.dumps(ckpt))
    print()
    print("=== CCOM rederive stats ===")
    for k in sorted(stats):
        print(f"  {k}: {stats[k]:,}")
    print(f"  kv_ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors}")
    if dry and samples:
        print("\n=== SAMPLE actionable clients ===")
        for s in samples[:4]:
            print(json.dumps(s, indent=2)[:1400])

    # Merge CCOM counts into the live portfolio stats (once).
    if not dry and not ckpt.get("ccom_stats_merged"):
        raw = kv_get_one("credit_portfolio:stats")
        if raw:
            ps = json.loads(raw)
            pop = ps.get("population", {})
            add_pop = {
                "processed": stats["matched"] + stats["nosig"] + stats["dnc"],
                "matched": stats["matched"], "actionable": stats["actionable"],
                "intakeReady": stats["intakeReady"], "dncExcluded": stats["dnc"],
                "noSignal": stats["nosig"],
            }
            for k, v in add_pop.items():
                pop[k] = pop.get(k, 0) + v
            ps["population"] = pop
            for k, v in stats.items():
                if k.startswith("ct:"):
                    ps.setdefault("byCaseType", {})
                    ps["byCaseType"][k[3:]] = ps["byCaseType"].get(k[3:], 0) + v
                if k.startswith("sol:"):
                    ps.setdefault("bySolStatus", {})
                    ps["bySolStatus"][k[4:]] = ps["bySolStatus"].get(k[4:], 0) + v
            ps["matchRate"] = round(pop["matched"] / max(pop["processed"], 1) * 100, 1)
            ps["actionableRate"] = round(pop["actionable"] / max(pop["processed"], 1) * 100, 1)
            ps["note"] = ("Counts are claim signals after SOL flagging. Recovery figures elsewhere "
                          "are statutory maximums over actionable claims, not expected value. "
                          "LEX + CCOM populations, both dated. Source vintage 2017-2024.")
            ps["ccomCompletedAt"] = TODAY.isoformat()
            kv_fire([["SET", "credit_portfolio:stats", json.dumps(ps)]])
            kv_drain()
            ckpt["ccom_stats_merged"] = True
            CKPT_FILE.write_text(json.dumps(ckpt))
            print("  merged CCOM counts into credit_portfolio:stats")

# ── Settlement xref phase ────────────────────────────────────────────────────
XREF_PIDS_FILE = WORK_DIR / "xref_pids.json"

def xref_candidate_pids(ents):
    """SQL prefilter: distinct pids holding any tradeline whose creditor/orig
    contains an xref needle. Superset of the real match — derive_person
    re-checks with word boundaries, state, status, and vintage filters."""
    if XREF_PIDS_FILE.exists():
        cached = json.loads(XREF_PIDS_FILE.read_text())
        print(f"  using cached candidate pids ({len(cached):,}) from {XREF_PIDS_FILE}")
        return cached
    needles = sorted({n.lower() for e in ents for n in e["needles"]})
    print(f"  SQL prefilter: {len(needles)} needles over cr_tl + cc_tl ...", flush=True)
    pids = set()
    for tbl in ("cr_tl", "cc_tl"):
        cond = " OR ".join(f"instr(lower(coalesce(creditor,'')||' '||coalesce(orig,'')), ?) > 0"
                           for _ in needles)
        t0 = time.time()
        for (pid,) in _cr.execute(f"SELECT DISTINCT pid FROM {tbl} WHERE {cond}", needles):
            pids.add(pid)
        print(f"    {tbl}: cumulative {len(pids):,} pids ({time.time()-t0:.0f}s)", flush=True)
    out = sorted(pids)
    XREF_PIDS_FILE.write_text(json.dumps(out))
    return out

def run_xref(limit=None, dry=False, batch_pids=1000):
    """Targeted re-derive of every person holding a tradeline that matches a
    live settlement window (SETTLEMENT_XREF + breach catalogs). Re-runs the
    FULL derive for those people, so existing records gain the new
    OpenSettlement/DataBreach signals and previously-nosig people get records."""
    print(f"Loading identity state from {STATE_FILE} ...", flush=True)
    people, bankrupt = load_state()
    cr_init()
    xref_ents = load_xref_entities()
    pids = [p for p in xref_candidate_pids(xref_ents) if p in people]
    if limit:
        pids = pids[:limit]
    total = len(pids)
    print(f"  {total:,} candidate people to re-derive; dry={dry}", flush=True)

    ckpt = json.loads(CKPT_FILE.read_text()) if (CKPT_FILE.exists() and not dry) else {}
    start = ckpt.get("xref_offset", 0)
    stats = defaultdict(int)
    samples = []
    t0 = time.time()

    for i in range(start, total, batch_pids):
        chunk = pids[i:i + batch_pids]
        lex_chunk = [p for p in chunk if p.startswith("lex_")]
        cc_chunk  = [p for p in chunk if p.startswith("cc_")]
        crs = {}
        if lex_chunk:
            crs.update(fetch_cr(lex_chunk))
        if cc_chunk:
            crs.update(fetch_cc(cc_chunk))
        for pid in chunk:
            outcome, client = derive_person(pid, people[pid], crs.get(pid, {}), bankrupt, xref_ents)
            stats[outcome] += 1
            if client is None:
                continue   # xref candidates: never delete here; full runs own deletions
            stats["matched"] += 1
            has_settlement = any(c.get("settlement") for c in client["cases"])
            if has_settlement:
                stats["settlementTagged"] += 1
            if client["actionable"]:
                stats["actionable"] += 1
            if client["intakeReady"]:
                stats["intakeReady"] += 1
            for c in client["cases"]:
                stats[f"ct:{c['caseType']}"] += 1
            if dry:
                if len(samples) < 8 and has_settlement:
                    samples.append(client)
                continue
            kv_push(["SET", f"client:{pid}", json.dumps(client)])
            kv_push(["ZADD", f"by_score:{shard_of(pid)}", client["priorityScore"], pid])
            if client["intakeReady"]:
                rep = {"tl": [dict(c=t.get("c"), orig=t.get("orig"), type=t.get("typ"),
                                   bal=t.get("bal"), od=t.get("od"), lrd=t.get("lrd"),
                                   bureau=t.get("bureau"), disp=bool(t.get("disp")))
                              for t in crs.get(pid, {}).get("tl", [])[:30]],
                       "pr": crs.get(pid, {}).get("pr", [])}
                kv_push(["SET", f"credit_report:{pid}", json.dumps(rep)])

        if not dry and (i // batch_pids) % 50 == 0:
            ckpt["xref_offset"] = i
            CKPT_FILE.write_text(json.dumps(ckpt))
            rate = (i - start) / max(1e-9, time.time() - t0)
            print(f"\r  {i:,}/{total:,}  settlementTagged={stats['settlementTagged']:,} "
                  f"matched={stats['matched']:,} ready={stats['intakeReady']:,} "
                  f"ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors} "
                  f"{rate:.0f}/s", end="", flush=True)

    if not dry:
        kv_drain()
        ckpt["xref_offset"] = total
        ckpt["xref_done"] = True
        CKPT_FILE.write_text(json.dumps(ckpt))
    print()
    print("=== Settlement xref stats ===")
    for k in sorted(stats):
        print(f"  {k}: {stats[k]:,}")
    print(f"  kv_ok={kv_ok:,} cmd_err={kv_cmd_errors} http_err={kv_http_errors}")
    if dry and samples:
        print("\n=== SAMPLE settlement-tagged clients ===")
        for s in samples[:4]:
            print(json.dumps(s, indent=2)[:1400])

    # Record the sweep on the live portfolio stats (idempotent overwrite).
    if not dry:
        raw = kv_get_one("credit_portfolio:stats")
        if raw:
            ps = json.loads(raw)
            ps["settlementXref"] = {
                "ranAt": TODAY.isoformat(),
                "candidates": total,
                "settlementTagged": stats["settlementTagged"],
                "openSettlementSignals": stats.get("ct:OpenSettlement", 0),
                "dataBreachSignals": stats.get("ct:DataBreach", 0),
                "note": ("Tier-1 tradeline-matchable open settlement windows (wave-1/wave-2 catalogs). "
                         "Tradeline is an eligibility proxy; verify class definition before outreach."),
            }
            kv_fire([["SET", "credit_portfolio:stats", json.dumps(ps)]])
            kv_drain()
            print("  recorded settlementXref summary in credit_portfolio:stats")

# ── CLI ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["lex", "ccom", "flip", "stats", "xref"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--log", default="/tmp/credit-ingest-work/rederive-lex.log")
    args = ap.parse_args()
    if args.mode == "lex":
        run_lex(limit=args.limit, dry=args.dry_run)
    elif args.mode == "flip":
        run_flip()
    elif args.mode == "stats":
        run_stats(args.log)
    elif args.mode == "ccom":
        run_ccom(limit=args.limit, dry=args.dry_run)
    elif args.mode == "xref":
        run_xref(limit=args.limit, dry=args.dry_run)
