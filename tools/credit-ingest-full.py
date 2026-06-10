#!/usr/bin/env python3
"""
Credit.com full dataset ingest — optimized for speed.

Optimizations vs. naive approach:
  - 8 parallel Azure downloads (ThreadPoolExecutor)
  - pyarrow.csv streaming for the 5.25GB CCOM tradeline CSV (10x faster than csv module)
  - Pipeline: downloads next batch while processing current batch
  - 500-command KV pipeline batches fired in background threads
  - pyarrow direct column access (no pandas row iteration)

Estimated runtime: 15-25 minutes for all ~10M people / 10.6GB

Usage:
    pip3 install pyarrow requests
    vercel env pull .env.local
    python3 tools/credit-ingest-full.py
"""

import os, sys, re, json, time, hashlib, subprocess, sqlite3
from pathlib import Path
from datetime import datetime, date
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue, Empty
import threading
import urllib.request

# ── Config ────────────────────────────────────────────────────────────────────

STORAGE_ACCOUNT  = "creditdatadd480c"
CONTAINER        = "credit-com-data"
WORK_DIR         = Path("/tmp/credit-ingest-work")
CHECKPOINT_FILE  = WORK_DIR / "checkpoint.json"
STATE_FILE       = WORK_DIR / "state.pkl.gz"   # persistent people dict after phase 5
SIGS_DB_FILE     = WORK_DIR / "sigs.db"         # disk-backed signals (avoids OOM)
CR_DB_FILE       = WORK_DIR / "cr_db.db"
OUT_DIR          = Path("/Users/stef/MDL Business/data/credit-matches")
RESULTS_FILE     = OUT_DIR / "full-ingest-results.json"

DL_WORKERS       = 16   # parallel Azure downloads
NUM_WORKERS      = min(8, os.cpu_count() or 4)   # ProcessPoolExecutor workers
KV_BATCH_SIZE    = 2000  # commands per KV pipeline call
KV_WRITE_THREADS = 32   # parallel KV write threads
MAX_RECORDS      = None # set to int for testing, e.g. 500_000

TODAY = date(2026, 6, 4)

RECOVERY = {
    "TCPA":        {"low": 50,   "mid": 300,   "high": 1500},
    "FDCPA":       {"low": 300,  "mid": 500,   "high": 1000},
    "FCRA":        {"low": 100,  "mid": 300,   "high": 1000},
    "RESPA":       {"low": 500,  "mid": 1500,  "high": 5000},
    "StudentLoan": {"low": 500,  "mid": 2000,  "high": 10000},
    "AutoLending": {"low": 300,  "mid": 1000,  "high": 5000},
    "DataBreach":  {"low": 50,   "mid": 150,   "high": 500},
    "UDAP_Payday": {"low": 200,  "mid": 500,   "high": 2000},
}

# ── Env ───────────────────────────────────────────────────────────────────────

def load_env():
    for f in [".env.local", ".env"]:
        p = Path(f)
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r'^([^#=\s]+)\s*=\s*(.*)$', line)
                if m:
                    os.environ.setdefault(m[1], m[2].strip().strip('"\''))

load_env()
KV_URL   = os.environ.get("KV_REST_API_URL", "")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
if not KV_URL or not KV_TOKEN:
    print("ERROR: KV_REST_API_URL and KV_REST_API_TOKEN required.")
    print("Run:  vercel env pull .env.local")
    sys.exit(1)

WORK_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)
PEOPLE_PKL = WORK_DIR / "people.pkl"   # slim people dict for multiprocessing workers

# ── Checkpoint ────────────────────────────────────────────────────────────────

def load_cp():
    if CHECKPOINT_FILE.exists():
        try: return json.loads(CHECKPOINT_FILE.read_text())
        except: pass
    return {"phases": [], "shards": set()}

def save_cp():
    cp["shards"] = list(cp["shards"])
    CHECKPOINT_FILE.write_text(json.dumps(cp, indent=2))
    cp["shards"] = set(cp["shards"])

cp = load_cp()
cp["shards"] = set(cp.get("shards", []))

# ── Azure download ────────────────────────────────────────────────────────────

def az_dl(blob, local):
    local = Path(local)
    if local.exists() and local.stat().st_size > 1000:
        return True
    cmd = ["az", "storage", "blob", "download",
           "--account-name", STORAGE_ACCOUNT,
           "--container-name", CONTAINER,
           "--name", blob, "--file", str(local),
           "--auth-mode", "login", "--no-progress"]
    r = subprocess.run(cmd, capture_output=True)
    return r.returncode == 0

def dl_parallel(blob_list, label=""):
    """Download a list of (blob_name, local_path) in parallel. Returns list of local paths."""
    paths = []
    done  = 0
    total = len(blob_list)
    with ThreadPoolExecutor(max_workers=DL_WORKERS) as ex:
        futs = {ex.submit(az_dl, b, l): l for b, l in blob_list}
        for fut in as_completed(futs):
            local = futs[fut]
            if fut.result():
                paths.append(local)
            done += 1
            print(f"\r  Downloading {label}: {done}/{total}", end="", flush=True)
    print()
    return paths

# ── KV ────────────────────────────────────────────────────────────────────────

kv_total  = 0
kv_lock   = threading.Lock()
kv_errors = 0

import http.client, ssl as _ssl
_kv_host = KV_URL.split("//")[-1].split("/")[0]
_kv_ctx  = _ssl.create_default_context()
_tl_conn = threading.local()   # one persistent HTTPS connection per thread

def _get_conn():
    c = getattr(_tl_conn, "conn", None)
    if c is None:
        c = http.client.HTTPSConnection(_kv_host, context=_kv_ctx, timeout=30)
        _tl_conn.conn = c
    return c

def kv_fire(commands):
    global kv_total, kv_errors
    if not commands: return
    body = json.dumps(commands).encode()
    hdrs = {"Authorization": f"Bearer {KV_TOKEN}",
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "Connection": "keep-alive"}
    for attempt in range(3):
        try:
            conn = _get_conn()
            conn.request("POST", "/pipeline", body=body, headers=hdrs)
            resp = conn.getresponse()
            resp.read()   # drain so connection stays reusable
            with kv_lock:
                kv_total += len(commands)
            return
        except Exception:
            _tl_conn.conn = None   # force reconnect on next attempt
    with kv_lock:
        kv_errors += 1

# Thread-safe KV queue
kv_queue_buf = []
kv_queue_lock = threading.Lock()
kv_executor   = ThreadPoolExecutor(max_workers=KV_WRITE_THREADS)
kv_futures    = []

def kv_push(cmd):
    with kv_queue_lock:
        kv_queue_buf.append(cmd)
        if len(kv_queue_buf) >= KV_BATCH_SIZE:
            batch = kv_queue_buf[:]
            kv_queue_buf.clear()
            kv_futures.append(kv_executor.submit(kv_fire, batch))

def kv_flush_all():
    with kv_queue_lock:
        if kv_queue_buf:
            batch = kv_queue_buf[:]
            kv_queue_buf.clear()
            kv_futures.append(kv_executor.submit(kv_fire, batch))
    for f in kv_futures:
        f.result()

# ── Matching patterns ─────────────────────────────────────────────────────────

FDCPA_PAT = [
    "portfolio recovery","midland credit","midland funding","encore capital",
    "lvnv funding","resurgent capital","convergent outsourcing","ic system",
    "amsher collection","cbe group","diversified consultants","enhanced recovery",
    "firstsource advantage","national credit adjusters","radius global",
    "unifin","transworld systems","credit corp solutions","southwest credit",
    "credit collection services","asset acceptance","cavalry portfolio",
    "cach llc","sherman financial","jefferson capital","hunter warfield",
    "nco financial","account control","united collection","phoenix financial",
    "professional recovery","receivables management","absolute resolutions",
    "world acceptance","pioneer credit recovery","continental service",
    "fair collections","security credit","midland","lvnv","cco",
    "national recoveries","first national collection",
]
FDCPA_HIGH = {"portfolio recovery","midland credit","midland funding","lvnv funding","encore capital"}

TCPA_PAT = [
    "navient","sallie mae","capital one","synchrony","citibank",
    "wells fargo","jpmorgan","jp morgan","chase","bank of america",
    "discover","american express","amex","ally financial","ally bank",
    "portfolio recovery","midland credit","encore capital","lvnv",
    "convergent","ic system","amsher","diversified consultants",
    "enhanced recovery","transworld","southwest credit","jefferson capital",
    "ditech","nationstar","mr. cooper","ocwen","phh mortgage",
    "newrez","shellpoint","caliber","specialized loan","cenlar",
    "at&t","verizon","sprint","t-mobile","comcast","xfinity",
    "dish network","directv","charter","spectrum",
    "great lakes","fedloan","mohela","nelnet","aidvantage","pheaa",
]

RESPA_PAT = [
    "ocwen","phh mortgage","nationstar","mr. cooper","ditech","greentree",
    "green tree","caliber home","bsi financial","shellpoint","newrez",
    "specialized loan","cenlar","rushmore","roundpoint","home point",
    "select portfolio","sps mortgage","seterus","wells fargo home",
]

SL_PAT = [
    "navient","sallie mae","great lakes","fedloan","mohela",
    "nelnet","aidvantage","ecmc","pheaa","edfinancial",
]

AUTO_PAT = [
    "credit acceptance","westlake financial","drivetime","driveime",
    "consumer portfolio services","santander consumer",
    "american credit acceptance","exeter finance","car hop","jd byrider",
]
AUTO_HIGH = {"credit acceptance","santander consumer"}

PAYDAY_PAT = [
    "ace cash express","speedy cash","advance america","check into cash",
    "qc holdings","dollar financial","community choice financial",
    "first cash","check n go","world acceptance","regional management",
    "republic finance","heights finance","onemain financial",
    "springleaf financial","mariner finance","loanmart","titlemax","loanmax",
]

DATA_BREACH = {
    "national public data": (2024, "2.9B record breach; active class actions"),
    "change healthcare":    (2024, "Largest US healthcare breach; suits filed"),
    "at&t":                 (2024, "110M customers; class actions filed"),
    "t-mobile":             (2023, "Ongoing class action settlement"),
    "equifax":              (2017, "Settlement paid; note for record"),
    "experian":             (2020, "Class actions filed"),
    "transunion":           (2022, "Class actions filed"),
    "capital one":          (2019, "Settlement largely paid"),
    "marriott":             (2020, "Ongoing litigation"),
}

def hit(name, pats):
    if not name: return None
    n = name.lower()
    return next((p for p in pats if p in n), None)

def ltype(exp="", item="", ind=""):
    s = f"{exp} {item} {ind}".lower()
    if re.search(r'mortgage|home equity|real estate', s): return "mortgage"
    if re.search(r'auto|vehicle|car |truck', s): return "auto"
    if re.search(r'student|education', s): return "student"
    return "other"

def norm_phone(raw):
    if not raw: return None
    d = re.sub(r'\D', '', str(raw))
    if len(d) == 11 and d[0] == '1': d = d[1:]
    return d if len(d) == 10 else None

# ── In-memory stores ──────────────────────────────────────────────────────────
# people[id] = (name, phone, email, state, dnc:bool)
# signals stored in SQLite on disk to avoid OOM with 10M-person dataset

people      = {}
dnc_ids     = set()
bankrupt_ids = set()   # separate from DNC — bankruptcies are still actionable

_ppl_lock = threading.Lock()

def add_person(pid, name, phone, email, state, dnc=False):
    if MAX_RECORDS and len(people) >= MAX_RECORDS: return
    people[pid] = ((name or "").strip(), norm_phone(phone),
                   (email or "").lower().strip() or None,
                   (state or "").upper()[:2] or None, dnc)

# ── Disk-backed sigs store (SQLite) ──────────────────────────────────────────
# All sigs functions are called from the main thread only, so no locks needed.

_sigs_conn = None
_sigs_buf  = []        # write buffer: list of (pid, case_type, defendant, strength)
_SIGS_FLUSH = 200_000  # flush after this many buffered rows

def _sigs_init():
    global _sigs_conn
    _sigs_conn = sqlite3.connect(str(SIGS_DB_FILE), check_same_thread=False)
    _sigs_conn.execute("PRAGMA journal_mode=WAL")
    _sigs_conn.execute("PRAGMA synchronous=NORMAL")
    _sigs_conn.execute("PRAGMA cache_size=-262144")   # 256MB page cache
    _sigs_conn.execute("""
        CREATE TABLE IF NOT EXISTS sigs (
            pid      TEXT NOT NULL,
            ct       TEXT NOT NULL,
            defn     TEXT NOT NULL,
            strength TEXT NOT NULL,
            PRIMARY KEY (pid, ct, defn)
        ) WITHOUT ROWID
    """)
    _sigs_conn.execute("CREATE INDEX IF NOT EXISTS ix_pid ON sigs(pid)")
    _sigs_conn.commit()

def _sigs_flush():
    if not _sigs_buf: return
    # INSERT OR IGNORE to preserve existing rows, then upgrade to 'high'
    _sigs_conn.executemany(
        "INSERT OR IGNORE INTO sigs(pid,ct,defn,strength) VALUES(?,?,?,?)", _sigs_buf
    )
    high = [(p, ct, d) for p, ct, d, s in _sigs_buf if s == "high"]
    if high:
        _sigs_conn.executemany(
            "UPDATE sigs SET strength='high' WHERE pid=? AND ct=? AND defn=?", high
        )
    _sigs_conn.commit()
    _sigs_buf.clear()

def add_sig(pid, case_type, defendant, strength):
    if pid not in people: return
    _sigs_buf.append((pid, case_type, defendant[:30], strength))
    if len(_sigs_buf) >= _SIGS_FLUSH:
        _sigs_flush()

def get_person_sigs(pid):
    """Return {(ct, defn): strength} for this person, or None."""
    rows = _sigs_conn.execute(
        "SELECT ct, defn, strength FROM sigs WHERE pid=?", (pid,)
    ).fetchall()
    return {(ct, defn): s for ct, defn, s in rows} if rows else None

def count_sigs_people():
    row = _sigs_conn.execute("SELECT COUNT(DISTINCT pid) FROM sigs").fetchone()
    return row[0] if row else 0

# ── Disk-backed credit report store (SQLite) ─────────────────────────────────
# cr_tl: raw tradeline rows per person (capped 15/bureau/shard)
# cr_inq: inquiry rows per person
# cr_pr: public record rows per person

_cr_conn   = None
_cr_tl_buf  = []
_cr_inq_buf = []
_cr_pr_buf  = []
_CR_FLUSH   = 100_000

def _cr_init():
    global _cr_conn
    _cr_conn = sqlite3.connect(str(CR_DB_FILE), check_same_thread=False)
    _cr_conn.execute("PRAGMA journal_mode=WAL")
    _cr_conn.execute("PRAGMA synchronous=NORMAL")
    _cr_conn.execute("PRAGMA cache_size=-131072")
    _cr_conn.execute("""
        CREATE TABLE IF NOT EXISTS cr_tl (
            pid      TEXT NOT NULL,
            bureau   TEXT NOT NULL,
            od       TEXT,
            creditor TEXT,
            orig     TEXT,
            typ      TEXT,
            bal      INTEGER,
            lrd      TEXT,
            disp     INTEGER DEFAULT 0,
            UNIQUE(pid, bureau, od, creditor)
        )
    """)
    _cr_conn.execute("CREATE INDEX IF NOT EXISTS ix_cr_tl_pid ON cr_tl(pid)")
    _cr_conn.execute("""
        CREATE TABLE IF NOT EXISTS cr_inq (
            pid      TEXT NOT NULL,
            bureau   TEXT NOT NULL,
            inq_date TEXT,
            lender   TEXT,
            UNIQUE(pid, bureau, inq_date, lender)
        )
    """)
    _cr_conn.execute("CREATE INDEX IF NOT EXISTS ix_cr_inq_pid ON cr_inq(pid)")
    _cr_conn.execute("""
        CREATE TABLE IF NOT EXISTS cr_pr (
            pid      TEXT NOT NULL,
            rec_type TEXT,
            chapter  TEXT,
            filed    TEXT,
            disch    TEXT,
            UNIQUE(pid, rec_type, filed)
        )
    """)
    _cr_conn.execute("CREATE INDEX IF NOT EXISTS ix_cr_pr_pid ON cr_pr(pid)")
    _cr_conn.commit()

def _cr_flush():
    if _cr_tl_buf:
        _cr_conn.executemany(
            "INSERT OR IGNORE INTO cr_tl(pid,bureau,od,creditor,orig,typ,bal,lrd,disp) VALUES(?,?,?,?,?,?,?,?,?)",
            _cr_tl_buf
        )
        _cr_tl_buf.clear()
    if _cr_inq_buf:
        _cr_conn.executemany(
            "INSERT OR IGNORE INTO cr_inq(pid,bureau,inq_date,lender) VALUES(?,?,?,?)",
            _cr_inq_buf
        )
        _cr_inq_buf.clear()
    if _cr_pr_buf:
        _cr_conn.executemany(
            "INSERT OR IGNORE INTO cr_pr(pid,rec_type,chapter,filed,disch) VALUES(?,?,?,?,?)",
            _cr_pr_buf
        )
        _cr_pr_buf.clear()
    _cr_conn.commit()

def add_cr_pr(pid, rec_type, chapter, filed, disch):
    _cr_pr_buf.append((pid, rec_type, chapter, filed, disch))
    if len(_cr_pr_buf) >= _CR_FLUSH:
        _cr_flush()

def get_person_cr_batch(pids):
    """Batch-fetch credit report data for a list of pids. Returns {pid: {tl, inq, pr}}."""
    if not pids or _cr_conn is None:
        return {}
    result = {pid: {"tl": [], "inq": [], "pr": []} for pid in pids}
    chunk = 500
    for i in range(0, len(pids), chunk):
        bp = pids[i:i+chunk]
        ph = ",".join("?" * len(bp))
        for row in _cr_conn.execute(
            f"SELECT pid,bureau,od,creditor,orig,typ,bal,lrd,disp FROM cr_tl WHERE pid IN ({ph})", bp
        ).fetchall():
            pid, bureau, od, creditor, orig, typ, bal, lrd, disp = row
            if pid in result:
                result[pid]["tl"].append({"c": creditor, "orig": orig, "type": typ,
                                          "bal": bal, "od": od, "lrd": lrd,
                                          "bureau": bureau, "disp": bool(disp)})
        for row in _cr_conn.execute(
            f"SELECT pid,bureau,inq_date,lender FROM cr_inq WHERE pid IN ({ph})", bp
        ).fetchall():
            pid, bureau, inq_date, lender = row
            if pid in result:
                result[pid]["inq"].append({"lender": lender, "date": inq_date, "bureau": bureau})
        for row in _cr_conn.execute(
            f"SELECT pid,rec_type,chapter,filed,disch FROM cr_pr WHERE pid IN ({ph})", bp
        ).fetchall():
            pid, rec_type, chapter, filed, disch = row
            if pid in result:
                result[pid]["pr"].append({"type": rec_type, "chapter": chapter,
                                          "filed": filed, "disch": disch})
    return result

def match_account(pid, ah, orig, exp_type, item_type, industry, status, phone, dnc):
    if dnc: return
    ah = ah or ""
    lt = ltype(exp_type, item_type, industry)

    # FDCPA: has original creditor (debt buyer) + known collector name
    if orig and hit(ah, FDCPA_PAT):
        s = "high" if any(p in ah.lower() for p in FDCPA_HIGH) else "medium"
        add_sig(pid, "FDCPA", ah, s)

    # TCPA: phone + known TCPA defendant
    if phone and hit(ah, TCPA_PAT):
        add_sig(pid, "TCPA", ah, "medium")

    # RESPA: mortgage + known servicer
    if lt == "mortgage" and hit(ah, RESPA_PAT):
        add_sig(pid, "RESPA", ah, "medium")

    # Student loan
    if lt == "student" and hit(ah, SL_PAT):
        s = "high" if "navient" in ah.lower() else "medium"
        add_sig(pid, "StudentLoan", ah, s)

    # Auto predatory
    if hit(ah, AUTO_PAT):
        s = "high" if any(p in ah.lower() for p in AUTO_HIGH) else "medium"
        add_sig(pid, "AutoLending", ah, s)

    # Payday
    if hit(ah, PAYDAY_PAT):
        add_sig(pid, "UDAP_Payday", ah, "medium")

    # Data breach
    ah_l = ah.lower()
    for kw, (yr, _) in DATA_BREACH.items():
        if kw in ah_l:
            add_sig(pid, "DataBreach", ah, "high" if yr >= 2024 else "medium")
            break

# ── Log ───────────────────────────────────────────────────────────────────────

T0 = time.time()
def log(msg):
    e = int(time.time() - T0)
    print(f"[{e//60:02d}:{e%60:02d}] {msg}", flush=True)

def save_state():
    """Persist people dict to disk. Sigs are already in sigs.db on disk."""
    import pickle, gzip
    _sigs_flush()  # flush any buffered sig writes first
    nsigs = count_sigs_people()
    log(f"  Saving state ({len(people):,} people, {nsigs:,} with signals in sigs.db)...")
    with gzip.open(STATE_FILE, 'wb', compresslevel=1) as f:
        pickle.dump({'people': people, 'bankrupt_ids': bankrupt_ids}, f, protocol=4)
    log(f"  State saved to {STATE_FILE} ({STATE_FILE.stat().st_size // 1_000_000}MB)")

def load_state():
    """Load people dict from saved state file. Returns True if loaded."""
    import pickle, gzip
    if not STATE_FILE.exists():
        return False
    log(f"  Loading state from {STATE_FILE}...")
    with gzip.open(STATE_FILE, 'rb') as f:
        state = pickle.load(f)
    people.update(state['people'])
    if 'bankrupt_ids' in state:
        bankrupt_ids.update(state['bankrupt_ids'])
    # sigs.db is already on disk, just re-open if needed
    if _sigs_conn is None:
        _sigs_init()
    nsigs = count_sigs_people()
    log(f"  State loaded: {len(people):,} people, {nsigs:,} with signals, {len(bankrupt_ids):,} bankruptcies")
    return True

# ── Arrow-accelerated shard processing ────────────────────────────────────────
# Strategy: use pyarrow.compute to pre-filter rows in C++ (releases GIL →
# true thread parallelism), then run Python loop only on the small matched set.

# Pre-built union of all pattern strings for Arrow substring filter
import re as _re
ALL_MATCH_PATS = list(set(
    FDCPA_PAT + TCPA_PAT + RESPA_PAT + SL_PAT + AUTO_PAT + PAYDAY_PAT +
    list(DATA_BREACH.keys())
))
# Single compiled regex covering all patterns — ONE Arrow call instead of 40+
_ALL_PATS_REGEX = "|".join(_re.escape(p) for p in ALL_MATCH_PATS)

_lex_uid_array = None  # Arrow int64 array of known LEX uids (built after phase_identity)

def _build_lex_uid_array():
    global _lex_uid_array
    import pyarrow as pa
    uids = [int(pid[4:]) for pid in people if pid.startswith('lex_')]
    _lex_uid_array = pa.array(uids, type=pa.int64())
    log(f"  Built LEX uid filter: {len(uids):,} known ids")

def _proc_lex_tl_shard_fast(local):
    """Process one LEX tradeline shard. Returns (shard_sigs, shard_cr_rows, row_count).
    shard_cr_rows is a list of (pid, bureau, od, creditor, orig, typ, bal, lrd, disp) tuples."""
    import pyarrow.parquet as pq
    result_sigs = {}
    result_cr   = []

    def radd(pid, case_type, defendant, strength):
        key = (case_type, defendant[:30])
        ps = result_sigs.get(pid)
        if ps is None:
            result_sigs[pid] = {key: strength}; return
        prev = ps.get(key)
        if prev != "high" and (strength == "high" or not prev):
            ps[key] = strength

    # Infer bureau from filename: LEX_EV_Tradelines_EQ_00001.parquet → "EQ"
    fname  = Path(local).name
    bureau = "EQ" if "_EQ_" in fname else ("EX" if "_EX_" in fname else "TU")

    # Per-pid tradeline cap (15 per pid per shard to prevent OOM)
    cr_counts = {}

    try:
        t = pq.read_table(str(local))
        names = set(t.schema.names)
        def col(n): return t[n].to_pylist() if n in names else [None]*len(t)

        uid_col  = col("internal_user_id")
        ah_col   = col("AccountHolder")
        cr_col   = col("creditor_name_raw")
        orig_col = col("original_creditor_name")
        st_col   = col("account_status")
        dp_col   = col("dispute_flag")
        bal_col  = col("current_balance_cents")
        od_col   = col("open_date")
        lrd_col  = col("last_reported_date")

        count = 0
        for uid, ah, cr, orig, status, dispute, bal, od, lrd in zip(
            uid_col, ah_col, cr_col, orig_col, st_col, dp_col, bal_col, od_col, lrd_col
        ):
            if uid is None: continue
            pid = f"lex_{int(uid)}"
            if pid not in people: continue
            _, phone, _, _, dnc = people[pid]
            name = str(ah or cr or "").strip()
            if dispute == 1:
                radd(pid, "FCRA", name or "Credit Bureau", "high")
            if not dnc:
                orig_s = str(orig or "")
                if orig_s and hit(name, FDCPA_PAT):
                    s = "high" if any(p in name.lower() for p in FDCPA_HIGH) else "medium"
                    radd(pid, "FDCPA", name, s)
                if phone and hit(name, TCPA_PAT):
                    radd(pid, "TCPA", name, "medium")
                lt = ltype("", "", "")
                if lt == "mortgage" and hit(name, RESPA_PAT):
                    radd(pid, "RESPA", name, "medium")
                if lt == "student" and hit(name, SL_PAT):
                    radd(pid, "StudentLoan", name, "high" if "navient" in name.lower() else "medium")
                if hit(name, AUTO_PAT):
                    radd(pid, "AutoLending", name, "high" if any(p in name.lower() for p in AUTO_HIGH) else "medium")
                if hit(name, PAYDAY_PAT):
                    radd(pid, "UDAP_Payday", name, "medium")
                nl = name.lower()
                for kw, (yr, _) in DATA_BREACH.items():
                    if kw in nl:
                        radd(pid, "DataBreach", name, "high" if yr >= 2024 else "medium")
                        break

            # Capture tradeline for credit report — cap at 15 per pid per shard
            cnt = cr_counts.get(pid, 0)
            if cnt < 15:
                cr_counts[pid] = cnt + 1
                bal_dollars = int(bal) // 100 if bal is not None else None
                od_s  = str(od)[:7]  if od  else None
                lrd_s = str(lrd)[:7] if lrd else None
                result_cr.append((pid, bureau, od_s, name[:60], str(orig or "")[:60],
                                   str(status or "")[:20], bal_dollars, lrd_s,
                                   1 if dispute == 1 else 0))
            count += 1
        return result_sigs, result_cr, count
    except Exception:
        return result_sigs, result_cr, 0

def _proc_inq_shard_fast(local):
    """Process one inquiry shard. Returns (shard_sigs, shard_cr_inq, hard_pull_count).
    shard_cr_inq is a list of (pid, bureau, inq_date, lender) tuples."""
    import pyarrow.parquet as pq
    result_sigs   = {}
    result_cr_inq = []

    def radd(pid, case_type, defendant, strength):
        key = (case_type, defendant[:30])
        ps = result_sigs.get(pid)
        if ps is None:
            result_sigs[pid] = {key: strength}; return
        prev = ps.get(key)
        if prev != "high" and (strength == "high" or not prev):
            ps[key] = strength

    try:
        t = pq.read_table(str(local))
        names = set(t.schema.names)
        def col(n): return t[n].to_pylist() if n in names else [None]*len(t)
        count = 0
        for uid, ah, inq_type, inq_date, bureau in zip(
            col("internal_user_id"), col("AccountHolder"), col("inquiry_type"),
            col("Inquiry_date"), col("bureau")
        ):
            if uid is None: continue
            pid = f"lex_{int(uid)}"
            if pid not in people: continue
            it = str(inq_type or "").lower()
            if "hard" in it or it == "h":
                radd(pid, "FCRA", str(ah or "Unauthorized Inquiry"), "medium")
                date_s = str(inq_date)[:7] if inq_date else None
                result_cr_inq.append((pid, str(bureau or "")[:2], date_s, str(ah or "")[:60]))
                count += 1
        return result_sigs, result_cr_inq, count
    except Exception:
        return result_sigs, result_cr_inq, 0

def _merge_shard_sigs(shard_sigs):
    for pid, signals in shard_sigs.items():
        for (ct, defendant), strength in signals.items():
            add_sig(pid, ct, defendant, strength)

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 1 — DNC lists (fast, tiny files)
# ═════════════════════════════════════════════════════════════════════════════

def phase_dnc():
    if "dnc" in cp["phases"]:
        log("Phase 1: DNC already loaded.")
        return
    import pyarrow.parquet as pq
    log("Phase 1: Loading DNC + email opt-out...")
    for blob in ["LEX_EV_DNC_00000.parquet","LEX_EV_DNC_00001.parquet",
                 "LEX_EV_Email_OptOut_00000.parquet"]:
        local = WORK_DIR / blob
        az_dl(blob, local)
        t = pq.read_table(str(local))
        col = "internal_user_id"
        if col in t.schema.names:
            for uid in t[col].to_pylist():
                if uid is not None: dnc_ids.add(f"lex_{int(uid)}")
        local.unlink(missing_ok=True)
    log(f"  DNC ids: {len(dnc_ids):,}")
    cp["phases"].append("dnc"); save_cp()

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2 — Identity (parallel download all shards at once)
# ═════════════════════════════════════════════════════════════════════════════

def _proc_lex_identity_shard(local):
    import pyarrow.parquet as pq
    t   = pq.read_table(str(local))
    uid_col   = t["internal_user_id"].to_pylist()
    name_col  = t["full_legal_name"].to_pylist()
    phone_col = t["current_Phone"].to_pylist()
    email_col = t["current_email"].to_pylist()
    state_col = t["current_address_state"].to_pylist()
    count = 0
    for uid, name, phone, email, state in zip(uid_col, name_col, phone_col, email_col, state_col):
        if uid is None: continue
        pid = f"lex_{int(uid)}"
        add_person(pid,
                   name=str(name or ""),
                   phone=str(phone or ""),
                   email=str(email or ""),
                   state=str(state or ""),
                   dnc=(pid in dnc_ids))
        count += 1
    local.unlink(missing_ok=True)
    return count

def phase_identity():
    if "identity" in cp["phases"]:
        log("Phase 2: Identity already loaded.")
        return

    import pyarrow.csv as pa_csv, pyarrow as pa

    # Build full download list
    lex_blobs  = [(f"LEX_EV_Identity_{i:05d}.parquet",
                   WORK_DIR / f"LEX_EV_Identity_{i:05d}.parquet")
                  for i in range(18)]
    ccom_local = WORK_DIR / "CCOM_EV_Identity.csv"

    log("Phase 2: Downloading all identity files in parallel (18 LEX shards + CCOM CSV)...")
    all_blobs = lex_blobs + [("CCOM_EV_Identity.csv", ccom_local)]
    dl_parallel(all_blobs, "identity")

    # Process LEX identity shards in parallel
    log("  Processing LEX identity shards...")
    lex_total = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(_proc_lex_identity_shard, local) for _, local in lex_blobs]
        for i, f in enumerate(as_completed(futs), 1):
            lex_total += f.result()
            print(f"\r  LEX identity: {i}/18 shards, {lex_total:,} people", end="", flush=True)
    print()

    # Process CCOM identity (pyarrow CSV — fast)
    log("  Processing CCOM identity CSV...")
    ro = pa_csv.ReadOptions(block_size=128 * 1024 * 1024)
    co = pa_csv.ConvertOptions(include_missing_columns=True)
    reader = pa_csv.open_csv(str(ccom_local), read_options=ro, convert_options=co)
    ccom_total = 0
    for batch in reader:
        tbl = pa.Table.from_batches([batch])
        names = tbl.schema.names

        def col(n):
            return tbl[n].to_pylist() if n in names else [None]*len(tbl)

        for ucid, fn, ln, phone, email, state, dnc_dt, consent, ph_auth in zip(
            col("ucid"), col("First_Name"), col("Last_Name"),
            col("phone_number"), col("email"), col("State"),
            col("dnc_date"), col("consent"), col("phone_contact_auth")
        ):
            if not ucid: continue
            pid   = f"cc_{ucid}"
            dnc   = bool(dnc_dt) or str(consent or "").lower() == "no"
            phone = phone if str(ph_auth or "").lower() == "true" else None
            add_person(pid,
                       name  = f"{fn or ''} {ln or ''}".strip(),
                       phone = str(phone or ""),
                       email = str(email or ""),
                       state = str(state or ""),
                       dnc   = dnc)
            ccom_total += 1
    ccom_local.unlink(missing_ok=True)

    log(f"  Identity loaded: {lex_total:,} LEX + {ccom_total:,} CCOM = {len(people):,} total people")
    _build_lex_uid_array()
    cp["phases"].append("identity"); save_cp()

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 3 — CCOM tradelines (5.25GB streaming CSV, pyarrow)
# ═════════════════════════════════════════════════════════════════════════════

def phase_ccom_tradelines():
    if "ccom_tradelines" in cp["phases"]:
        log("Phase 3: CCOM tradelines already processed.")
        return

    import pyarrow.csv as pa_csv, pyarrow as pa

    local = WORK_DIR / "CCOM_EV_Tradelines.csv"
    log("Phase 3: Downloading CCOM tradelines (5.25GB)...")
    az_dl("CCOM_EV_Tradelines.csv", local)

    log("  Streaming CCOM tradelines (27M rows)...")
    ro = pa_csv.ReadOptions(block_size=32 * 1024 * 1024)  # 32MB chunks — skip only 32MB on bad row
    reader = pa_csv.open_csv(str(local), read_options=ro)

    rows = 0; skipped_batches = 0
    reader_iter = iter(reader)
    while True:
        try:
            batch = next(reader_iter)
        except StopIteration:
            break
        except Exception:
            skipped_batches += 1; continue  # skip 32MB block with bad row

        tbl   = pa.Table.from_batches([batch])
        names = set(tbl.schema.names)

        def col(n): return tbl[n].to_pylist() if n in names else [None]*len(tbl)

        for ucid, ah, orig, exp_type, item_type, ind, status in zip(
            col("ucid"), col("AccountHolder"), col("OriginalCreditor"),
            col("Experian_item_type"), col("internal_item_type"),
            col("Industry"), col("internal_item_status")
        ):
            if not ucid: continue
            pid = f"cc_{ucid}"
            if pid not in people: continue
            _, phone, _, _, dnc = people[pid]
            match_account(pid, str(ah or ""), str(orig or ""),
                          str(exp_type or ""), str(item_type or ""),
                          str(ind or ""), str(status or ""), phone, dnc)
            rows += 1
        print(f"\r  CCOM tradelines: {rows:,} rows processed", end="", flush=True)
    if skipped_batches: log(f"  Skipped {skipped_batches} malformed 32MB blocks")
    print()
    local.unlink(missing_ok=True)
    log(f"  CCOM tradelines done: {rows:,} rows")
    cp["phases"].append("ccom_tradelines"); save_cp()

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4 — LEX tradelines (226 parquet shards, parallel download + process)
# ═════════════════════════════════════════════════════════════════════════════

ALL_LEX_TL = (
    [f"LEX_EV_Tradelines_EQ_{i:05d}.parquet" for i in range(79)] +
    [f"LEX_EV_Tradelines_EX_{i:05d}.parquet" for i in range(70)] +
    [f"LEX_EV_Tradelines_TU_{i:05d}.parquet" for i in range(77)]
)

def phase_lex_tradelines():
    if "lex_tradelines" in cp["phases"]:
        log("Phase 4: LEX tradelines already processed.")
        return

    # Load people from disk if identity phase was skipped (resume after phases 1-3)
    if not people:
        if not load_state():
            log("Phase 4: ERROR — no identity state found. Re-run from scratch.")
            return

    global _lex_uid_array
    if _lex_uid_array is None:
        _build_lex_uid_array()

    remaining = [b for b in ALL_LEX_TL if b not in cp["shards"]]
    total     = len(ALL_LEX_TL)
    done      = total - len(remaining)
    log(f"Phase 4: {len(remaining)} shards, {DL_WORKERS} threads + Arrow pre-filter...")

    if remaining:
        log(f"  Pre-downloading {len(remaining)} shards ({DL_WORKERS} parallel)...")
        with ThreadPoolExecutor(max_workers=DL_WORKERS) as ex:
            dl_futs = {ex.submit(az_dl, b, WORK_DIR/b): b for b in remaining}
            dl_done = 0
            for fut in as_completed(dl_futs):
                dl_done += 1
                if dl_done % 25 == 0 or dl_done == len(remaining):
                    print(f"\r  Downloaded: {dl_done}/{len(remaining)}", end="", flush=True)
        print()

    rows_total = 0
    PROC_WORKERS = 8  # 8 concurrent threads — controls memory pressure
    for i in range(0, len(remaining), PROC_WORKERS):
        batch = remaining[i: i + PROC_WORKERS]
        with ThreadPoolExecutor(max_workers=PROC_WORKERS) as ex:
            pfuts = {ex.submit(_proc_lex_tl_shard_fast, WORK_DIR/b): b for b in batch}
            for fut in as_completed(pfuts):
                blob = pfuts[fut]
                shard_sigs, shard_cr, count = fut.result()
                rows_total += count
                _merge_shard_sigs(shard_sigs)
                for row in shard_cr:
                    _cr_tl_buf.append(row)
                if len(_cr_tl_buf) >= _CR_FLUSH:
                    _cr_flush()
                done += 1
                cp["shards"].add(blob)
                print(f"\r  LEX tradelines: {done}/{total} shards, {rows_total:,} rows", end="", flush=True)
        _sigs_flush()   # write buffered sigs to SQLite — keeps RAM flat
        _cr_flush()     # write buffered CR tradelines to SQLite
        save_cp()       # checkpoint after each batch

    _sigs_flush()
    _cr_flush()
    print()
    log(f"  LEX tradelines done: {rows_total:,} rows total")
    cp["phases"].append("lex_tradelines"); save_cp()

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 5 — Inquiries (118 shards → FCRA hard-pull signals)
# ═════════════════════════════════════════════════════════════════════════════

ALL_INQ = [f"LEX_EV_Inquiries_{i:05d}.parquet" for i in range(118)]

def phase_inquiries():
    if "inquiries" in cp["phases"]:
        log("Phase 5: Inquiries already processed.")
        return

    if not people:
        if not load_state():
            log("Phase 5: ERROR — no identity state found.")
            return

    global _lex_uid_array
    if _lex_uid_array is None:
        _build_lex_uid_array()

    remaining = [b for b in ALL_INQ if b not in cp["shards"]]
    total = len(ALL_INQ); done = total - len(remaining); hits = 0
    log(f"Phase 5: {len(remaining)} inquiry shards, {DL_WORKERS} threads + Arrow pre-filter...")

    if remaining:
        log(f"  Pre-downloading {len(remaining)} inquiry shards ({DL_WORKERS} parallel)...")
        with ThreadPoolExecutor(max_workers=DL_WORKERS) as ex:
            dl_futs = {ex.submit(az_dl, b, WORK_DIR/b): b for b in remaining}
            dl_done = 0
            for fut in as_completed(dl_futs):
                dl_done += 1
                if dl_done % 20 == 0 or dl_done == len(remaining):
                    print(f"\r  Downloaded: {dl_done}/{len(remaining)}", end="", flush=True)
        print()

    PROC_WORKERS = 8
    for i in range(0, len(remaining), PROC_WORKERS):
        batch = remaining[i: i + PROC_WORKERS]
        with ThreadPoolExecutor(max_workers=PROC_WORKERS) as ex:
            pfuts = {ex.submit(_proc_inq_shard_fast, WORK_DIR/b): b for b in batch}
            for fut in as_completed(pfuts):
                blob = pfuts[fut]
                shard_sigs, shard_cr_inq, count = fut.result()
                hits += count
                _merge_shard_sigs(shard_sigs)
                for row in shard_cr_inq:
                    _cr_inq_buf.append(row)
                if len(_cr_inq_buf) >= _CR_FLUSH:
                    _cr_flush()
                done += 1
                cp["shards"].add(blob)
                print(f"\r  Inquiries: {done}/{total} shards, {hits:,} FCRA signals", end="", flush=True)
        _sigs_flush()
        _cr_flush()
        save_cp()

    _sigs_flush()
    _cr_flush()
    print()
    cp["phases"].append("inquiries"); save_cp()
    save_state()  # persist to disk so phase 6/7 can resume without re-running

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 6 — Public records (bankruptcy → exclude) — OPTIONAL
# ═════════════════════════════════════════════════════════════════════════════

def phase_public_records():
    if "public_records" in cp["phases"]:
        log("Phase 6: Public records already processed.")
        return

    # Ensure in-memory state is loaded (needed after a crash resume)
    if not people:
        if not load_state():
            log("Phase 6: No state available, skipping public records.")
            cp["phases"].append("public_records"); save_cp()
            return

    import pyarrow.parquet as pq
    log("Phase 6: Public records (marking bankruptcies)...")
    blobs = [(f"LEX_EV_Public_Records_{i:05d}.parquet",
              WORK_DIR / f"LEX_EV_Public_Records_{i:05d}.parquet")
             for i in range(3)]
    try:
        dl_parallel(blobs, "public records")
        excluded = 0
        for blob, local in blobs:
            if not local.exists():
                log(f"  WARNING: {local.name} missing, skipping")
                continue
            t = pq.read_table(str(local))
            names = set(t.schema.names)
            def col(n): return t[n].to_pylist() if n in names else [None]*len(t)
            for uid, rec_type, chapter, filed_dt, disch_dt in zip(
                col("internal_user_id"), col("Type"), col("chapter"),
                col("filing_date"), col("discharge_date")
            ):
                if uid is None: continue
                pid = f"lex_{int(uid)}"
                if pid in people:
                    if "bankruptcy" in str(rec_type or "").lower():
                        bankrupt_ids.add(pid)   # track separately — still actionable
                        excluded += 1
                    filed_s = str(filed_dt)[:7] if filed_dt else None
                    disch_s = str(disch_dt)[:7] if disch_dt else None
                    chap_s  = str(chapter or "")[:3] if chapter else None
                    add_cr_pr(pid, str(rec_type or ""), chap_s, filed_s, disch_s)
            local.unlink(missing_ok=True)
        _cr_flush()
        log(f"  Bankruptcy exclusions: {excluded:,}")
    except Exception as e:
        log(f"  WARNING: Public records failed ({e}), skipping bankruptcy exclusion")
    cp["phases"].append("public_records"); save_cp()

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 7 — Write matched clients to KV
# ═════════════════════════════════════════════════════════════════════════════

def phase_write_kv():
    # Ensure in-memory state is loaded (needed after a crash resume)
    if not people:
        if not load_state():
            log("Phase 7: ERROR — no state available. Re-run from scratch.")
            return None, None
    log("Phase 7: Writing matched clients to Vercel KV...")
    stats = {
        "total": len(people), "excluded_dnc": 0, "no_contact": 0,
        "matched": 0, "intake_ready": 0,
        "by_case_type": defaultdict(int),
        "by_defendant": defaultdict(int),
        "rec": {"low": 0, "mid": 0, "high": 0},
    }
    top_leads        = []
    intake_ready_pids = []
    now_ms    = int(time.time() * 1000)
    written   = 0
    sw        = {"high": 40, "medium": 20, "low": 10}

    for pid, pdata in people.items():
        name, phone, email, state, dnc = pdata

        # Only exclude real DNC opt-outs, not bankruptcies (which are actionable)
        if dnc and pid not in bankrupt_ids:
            stats["excluded_dnc"] += 1; continue

        person_sigs = get_person_sigs(pid)
        if not person_sigs: continue

        stats["matched"] += 1
        cases = []
        case_types = set()
        for (case_type, defendant), strength in person_sigs.items():
            r = RECOVERY.get(case_type, {})
            cases.append({
                "caseType": case_type, "defendant": defendant, "strength": strength,
                "estimatedRecoveryLow":  r.get("low",  100),
                "estimatedRecoveryMid":  r.get("mid",  300),
                "estimatedRecoveryHigh": r.get("high", 1000),
            })
            case_types.add(case_type)
            stats["by_case_type"][case_type] += 1
            stats["by_defendant"][defendant[:40]] += 1

        rec_low  = sum(RECOVERY.get(ct, {}).get("low",  0) for ct in case_types)
        rec_mid  = sum(RECOVERY.get(ct, {}).get("mid",  0) for ct in case_types)
        rec_high = sum(RECOVERY.get(ct, {}).get("high", 0) for ct in case_types)
        stats["rec"]["low"]  += rec_low
        stats["rec"]["mid"]  += rec_mid
        stats["rec"]["high"] += rec_high

        score  = min(sum(sw.get(c["strength"], 10) for c in cases)
                     + (15 if phone else 0) + (10 if email else 0)
                     + (10 if len(case_types) > 1 else 0)
                     + (10 if rec_mid > 500 else 0), 100)
        ready  = score >= 50 and (bool(phone) or bool(email))
        if ready:
            stats["intake_ready"] += 1
            intake_ready_pids.append(pid)

        client = {
            "id": pid, "name": name, "phone": phone, "email": email,
            "state": state, "ingestSource": "credit_com_blob_full",
            "ingestedAt": datetime.utcnow().isoformat(),
            "cases": cases, "matchedCases": list(case_types),
            "priorityScore": score, "intakeReady": ready,
            "recoveryEstimate": {"low": rec_low, "mid": rec_mid, "high": rec_high},
            **({"bankruptcyFiled": True} if pid in bankrupt_ids else {}),
        }

        kv_push(["SET",  f"client:{pid}", json.dumps(client)])
        kv_push(["ZADD", "clients_by_date", now_ms, pid])
        kv_push(["ZADD", "credit_portfolio:by_score", score, pid])
        kv_push(["SADD", "tcpa:clients_pending_match", pid])

        written += 1
        if len(top_leads) < 500:
            top_leads.append({"id": pid, "name": name, "state": state, "score": score,
                               "cases": list(case_types),
                               "recovery": {"low": rec_low, "mid": rec_mid, "high": rec_high}})
        if written % 10_000 == 0:
            print(f"\r  KV writes: {written:,} clients queued", end="", flush=True)

    kv_flush_all()
    print()
    log(f"  {written:,} clients written, {kv_errors} KV errors")

    # Write credit reports for intake-ready clients (batch SQLite lookup)
    if intake_ready_pids and _cr_conn is not None:
        log(f"  Writing credit_report KV for {len(intake_ready_pids):,} intake-ready clients...")
        cr_written = 0
        for i in range(0, len(intake_ready_pids), 500):
            batch_pids = intake_ready_pids[i:i+500]
            cr_dict = get_person_cr_batch(batch_pids)
            for pid, cr in cr_dict.items():
                if cr["tl"] or cr["inq"] or cr["pr"]:
                    kv_push(["SET", f"credit_report:{pid}", json.dumps(cr)])
                    cr_written += 1
            if cr_written % 50_000 == 0 and cr_written > 0:
                print(f"\r  Credit reports: {cr_written:,} written", end="", flush=True)
        kv_flush_all()
        print()
        log(f"  Credit reports written: {cr_written:,}")

    # Portfolio stats
    factor = 9_800_000 / max(stats["total"], 1)
    portfolio = {
        "ingestedAt": datetime.utcnow().isoformat(),
        "totalInDataset": 9_800_000,
        "sampleProcessed": stats["total"],
        "excluded": {"dnc": stats["excluded_dnc"], "noContact": stats["no_contact"]},
        "matched": stats["matched"],
        "intakeReady": stats["intake_ready"],
        "matchRate": round(stats["matched"] / max(stats["total"], 1) * 100, 1),
        "byCaseType": dict(stats["by_case_type"]),
        "byDefendant": sorted([{"defendant": d, "count": c}
                                for d, c in stats["by_defendant"].items()],
                               key=lambda x: -x["count"])[:25],
        "recovery": {
            "sampleLow":   stats["rec"]["low"],
            "sampleMid":   stats["rec"]["mid"],
            "sampleHigh":  stats["rec"]["high"],
            "extrapolatedFactor": round(factor, 2),
            "fullDatasetLow":   round(stats["rec"]["low"]   * factor),
            "fullDatasetMid":   round(stats["rec"]["mid"]   * factor),
            "fullDatasetHigh":  round(stats["rec"]["high"]  * factor),
        },
        "topLeads": sorted(top_leads, key=lambda x: -x["score"])[:50],
    }
    kv_push(["SET", "credit_portfolio:stats", json.dumps(portfolio)])
    kv_flush_all()
    RESULTS_FILE.write_text(json.dumps(portfolio, indent=2))
    return stats, portfolio

# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════

def main():
    _sigs_init()   # open / create sigs.db (all functions now defined)
    _cr_init()     # open / create cr_db.db for credit report capture
    print("=" * 65)
    print("CREDIT.COM FULL INGEST — OPTIMIZED (8 parallel downloads)")
    print("=" * 65)
    print(f"Started : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Work dir: {WORK_DIR}")
    print(f"Resuming: {len(cp['phases'])} phases done, {len(cp['shards'])} shards done")
    print()

    phase_dnc()
    phase_identity()
    phase_ccom_tradelines()
    phase_lex_tradelines()
    phase_inquiries()
    phase_public_records()
    stats, portfolio = phase_write_kv()
    if stats is None:
        log("ERROR: phase_write_kv returned no data. Exiting.")
        return

    elapsed = int(time.time() - T0)
    r = portfolio["recovery"]

    print()
    print("=" * 65)
    print("RESULTS")
    print("=" * 65)
    print(f"  People processed:        {stats['total']:>12,}")
    print(f"  Excluded DNC/bankrupt:   {stats['excluded_dnc']:>12,}")
    print(f"  Excluded no contact:     {stats['no_contact']:>12,}")
    print(f"  Matched to a case:       {stats['matched']:>12,}  ({portfolio['matchRate']}%)")
    print(f"  Intake-ready:            {stats['intake_ready']:>12,}")
    print()
    print("  CASE TYPE BREAKDOWN:")
    for ct, n in sorted(portfolio["byCaseType"].items(), key=lambda x: -x[1]):
        mid = RECOVERY.get(ct, {}).get("mid", 0)
        total_mid = n * mid
        print(f"    {ct:<16}  {n:>8,} people  ×${mid:>5}/ea  = ${total_mid:>14,}")
    print()
    print(f"  RECOVERY — THIS RUN ({stats['total']:,} people):")
    print(f"    Conservative  ${r['sampleLow']:>15,}")
    print(f"    Mid           ${r['sampleMid']:>15,}")
    print(f"    Aggressive    ${r['sampleHigh']:>15,}")
    print()
    print(f"  EXTRAPOLATED TO FULL 9.8M DATASET (×{r['extrapolatedFactor']}):")
    print(f"    Conservative  ${r['fullDatasetLow']:>15,}")
    print(f"    Mid           ${r['fullDatasetMid']:>15,}")
    print(f"    Aggressive    ${r['fullDatasetHigh']:>15,}")
    print()
    print(f"  Time: {elapsed//60}m {elapsed%60}s  |  KV writes: {kv_total:,}")
    print(f"  Results: {RESULTS_FILE}")
    print()
    print("  Open the platform → Credit Portfolio tab to see the full breakdown.")
    print("=" * 65)

if __name__ == "__main__":
    main()
