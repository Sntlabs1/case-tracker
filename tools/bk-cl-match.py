#!/usr/bin/env python3
"""
bk-cl-match.py — Free CourtListener bankruptcy pass over the LEX client base.

Matches the 436K known-bankrupt LEX people (from bureau public records in
cr_db.db) against the CourtListener bulk docket dump, restricted to the 95
federal bankruptcy courts. Produces per-person docket matches with confidence
tiers so the residual (no CL hit) can later be sized for a paid PACER pass.

Phases (resumable, run in order):
  python3 tools/bk-cl-match.py filter   # stream 5GB bz2 -> cl_bk.db (BK dockets only)
  python3 tools/bk-cl-match.py people   # cr_pr bankruptcies + identity -> people_bk
  python3 tools/bk-cl-match.py match    # join on (last,first) + state + filing date
  python3 tools/bk-cl-match.py stats    # print summary

Inputs (all local, $0):
  /tmp/credit-ingest-work/cl-dockets-2026-03-31.csv.bz2   CourtListener bulk dockets
  /tmp/credit-ingest-work/courts-2026-03-31.csv           CourtListener courts (FB set)
  /tmp/credit-ingest-work/cr_db.db                        cr_pr bankruptcy records (MMYY)
  /tmp/credit-ingest-work/id*.parquet                     LEX identity (name/state/dob_year)

Output:
  /tmp/credit-ingest-work/cl_bk.db    tables: dockets, people_bk, matches
"""
import bz2, csv, json, re, sqlite3, subprocess, sys, time
from pathlib import Path

WORK = Path("/tmp/credit-ingest-work")
DOCKETS_BZ2 = WORK / "cl-dockets-2026-03-31.csv.bz2"
COURTS_CSV = WORK / "courts-2026-03-31.csv"
CR_DB = WORK / "cr_db.db"
OUT_DB = WORK / "cl_bk.db"

csv.field_size_limit(10**8)

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "jr.", "sr."}
RE_INRE = re.compile(r"^\s*(in\s+re:?|in\s+the\s+matter\s+of:?)\s*", re.I)
RE_CLEAN = re.compile(r"[^a-z\- ']")


def bk_courts():
    with open(COURTS_CSV, newline="") as f:
        return {r["id"] for r in csv.DictReader(f) if r["jurisdiction"] == "FB"}


def court_state(court_id):
    # All FB court ids start with the 2-letter state/territory code (ganb->ga, scb->sc)
    return court_id[:2].upper()


def norm_tokens(s):
    s = RE_CLEAN.sub(" ", s.lower())
    return [t for t in s.split() if t and t not in SUFFIXES]


def person_name_key(full_name):
    """LEX identity names are 'First [Middle] Last'."""
    toks = norm_tokens(full_name or "")
    if len(toks) < 2:
        return None
    return toks[-1], toks[0]  # (last, first)


def caption_name_keys(case_name):
    """Extract (last, first) pairs from a bankruptcy caption.

    Handles 'John A. Smith', 'Smith, John A.', 'In Re: John Smith',
    'John Smith and Jane Smith'. Returns a list of (last, first).
    """
    s = RE_INRE.sub("", case_name or "")
    keys = []
    for seg in re.split(r"\s+(?:and|&)\s+", s, flags=re.I):
        seg = seg.strip()
        if not seg:
            continue
        if "," in seg:
            last_part, _, first_part = seg.partition(",")
            lt, ft = norm_tokens(last_part), norm_tokens(first_part)
            if lt and ft:
                keys.append((lt[-1], ft[0]))
            continue
        toks = norm_tokens(seg)
        if len(toks) >= 2:
            keys.append((toks[-1], toks[0]))
    return keys


def parse_mmyy(s):
    """Bureau filing dates are MMYY strings: '0212' = Feb 2012. yy<=26 -> 20yy."""
    s = (s or "").strip()
    if len(s) != 4 or not s.isdigit():
        return None
    mm, yy = int(s[:2]), int(s[2:])
    if not 1 <= mm <= 12:
        return None
    year = 2000 + yy if yy <= 26 else 1900 + yy
    return year, mm


def month_index(y, m):
    return y * 12 + (m - 1)


def db():
    con = sqlite3.connect(OUT_DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=OFF")
    return con


# ── Phase 1: stream-filter the bulk docket dump to bankruptcy courts ─────────

def phase_filter():
    courts = bk_courts()
    print(f"{len(courts)} bankruptcy courts")
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS dockets(
        cl_id INTEGER PRIMARY KEY, court_id TEXT, case_name TEXT,
        date_filed TEXT, date_terminated TEXT, docket_number TEXT,
        pacer_case_id TEXT)""")
    if con.execute("SELECT COUNT(*) FROM dockets").fetchone()[0] and "--force" not in sys.argv:
        print("dockets table already populated; use --force to redo")
        return

    # System bzcat decompresses ~3x faster than python bz2
    proc = subprocess.Popen(["bzcat", str(DOCKETS_BZ2)], stdout=subprocess.PIPE, text=True,
                            errors="replace", bufsize=1 << 20)
    reader = csv.reader(proc.stdout)
    header = next(reader)
    col = {name: i for i, name in enumerate(header)}
    need = ["id", "court_id", "case_name", "date_filed", "date_terminated",
            "docket_number", "pacer_case_id"]
    idx = [col[n] for n in need]
    print("columns ok:", need)

    rows, kept, batch, t0 = 0, 0, [], time.time()
    for r in reader:
        rows += 1
        try:
            if r[col["court_id"]] in courts:
                batch.append(tuple(r[i] for i in idx))
        except IndexError:
            continue
        if len(batch) >= 50000:
            con.executemany("INSERT OR REPLACE INTO dockets VALUES(?,?,?,?,?,?,?)", batch)
            con.commit()
            kept += len(batch)
            batch = []
            print(f"\r  {rows:,} rows scanned, {kept:,} BK dockets kept "
                  f"({rows/(time.time()-t0):,.0f} rows/s)", end="", flush=True)
    if batch:
        con.executemany("INSERT OR REPLACE INTO dockets VALUES(?,?,?,?,?,?,?)", batch)
        kept += len(batch)
    con.commit()
    print(f"\nDone: {rows:,} scanned, {kept:,} bankruptcy dockets")
    rc = proc.wait()
    if rc:
        print(f"WARNING: bzcat exit {rc} — file may be truncated/incomplete")


# ── Phase 2: roster of known-bankrupt people with parsed filing dates ────────

def phase_people():
    import pandas as pd
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS people_bk(
        pid TEXT, last TEXT, first TEXT, state TEXT, dob_year INT,
        full_name TEXT, filed_y INT, filed_m INT, filed_raw TEXT,
        PRIMARY KEY(pid, filed_raw))""")
    if con.execute("SELECT COUNT(*) FROM people_bk").fetchone()[0] and "--force" not in sys.argv:
        print("people_bk already populated; use --force to redo")
        return

    cr = sqlite3.connect(CR_DB)
    recs = cr.execute(
        "SELECT pid, filed FROM cr_pr WHERE rec_type='Bankruptcy'").fetchall()
    print(f"{len(recs):,} bankruptcy records from cr_pr")
    uids = {int(pid[4:]) for pid, _ in recs if pid.startswith("lex_")}

    ident = {}
    for p in sorted(WORK.glob("id*.parquet")):
        df = pd.read_parquet(p, columns=["internal_user_id", "full_legal_name",
                                         "current_address_state", "dob_year"])
        df = df[df.internal_user_id.isin(uids)]
        for uid, name, st, dy in df.itertuples(index=False):
            ident[int(uid)] = (name, st, int(dy) if pd.notna(dy) else None)
        print(f"\r  identity loaded: {len(ident):,}", end="", flush=True)
    print()

    rows, no_ident, bad_name = [], 0, 0
    for pid, filed in recs:
        info = ident.get(int(pid[4:])) if pid.startswith("lex_") else None
        if not info:
            no_ident += 1
            continue
        name, st, dy = info
        key = person_name_key(name)
        if not key:
            bad_name += 1
            continue
        ym = parse_mmyy(filed)
        rows.append((pid, key[0], key[1], (st or "").upper(), dy, name,
                     ym[0] if ym else None, ym[1] if ym else None, filed or ""))
    con.executemany("INSERT OR REPLACE INTO people_bk VALUES(?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    n_people = con.execute("SELECT COUNT(DISTINCT pid) FROM people_bk").fetchone()[0]
    print(f"people_bk: {len(rows):,} records, {n_people:,} people "
          f"(skipped: {no_ident:,} no identity, {bad_name:,} unparseable name)")


# ── Phase 2b: CCOM bankruptcy extraction ─────────────────────────────────────

CCOM_TL = WORK / "CCOM_EV_Tradelines.csv"
CCOM_ID = WORK / "CCOM_EV_Identity.csv"


def phase_ccom():
    """Extract BANKRUPTCY public-record rows from the CCOM tradelines CSV and
    add those people to people_bk (pid cc_<ucid>). Also records ucids whose
    tradelines are marked INCL_IN_BANKRUPTCY but who lack a public record —
    secondary detection for rolled-off filings (no filing date available)."""
    import pyarrow as pa
    import pyarrow.csv as pcsv
    import pyarrow.compute as pc

    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS ccom_incl_bk(ucid INTEGER PRIMARY KEY)""")
    if con.execute("SELECT COUNT(*) FROM people_bk WHERE pid LIKE 'cc_%'").fetchone()[0] \
            and "--force" not in sys.argv:
        print("CCOM people already in people_bk; use --force to redo")
        return

    print("Streaming CCOM tradelines (27M rows)...")
    ro = pcsv.ReadOptions(block_size=64 * 1024 * 1024)
    reader = pcsv.open_csv(CCOM_TL, read_options=ro)
    bk_rows, incl_ids, rows, t0 = {}, set(), 0, time.time()
    for batch in reader:
        t = pa.Table.from_batches([batch])
        rows += len(t)
        bk = t.filter(pc.equal(t["internal_item_type"], "BANKRUPTCY"))
        for r in bk.select(["ucid", "FilingDate", "AccountHolder"]).to_pylist():
            ucid, fd = r["ucid"], r["FilingDate"]
            if not ucid:
                continue
            key = (ucid, str(fd)[:10] if fd is not None else "")
            bk_rows[key] = (r["AccountHolder"] or "")
        inc = t.filter(pc.equal(t["internal_item_type"], "INCL_IN_BANKRUPTCY"))
        incl_ids.update(u for u in inc["ucid"].to_pylist() if u)
        print(f"\r  {rows:,} rows, {len(bk_rows):,} BK records, "
              f"{len(incl_ids):,} incl-in-BK people "
              f"({rows/(time.time()-t0):,.0f} rows/s)", end="", flush=True)
    print()

    print("Loading CCOM identity...")
    idt = pcsv.read_csv(CCOM_ID, read_options=pcsv.ReadOptions(block_size=64 * 1024 * 1024))
    ident = {}
    for r in idt.select(["ucid", "First_Name", "Last_Name", "State"]).to_pylist():
        if r["ucid"]:
            ident[r["ucid"]] = (r["First_Name"] or "", r["Last_Name"] or "",
                                (r["State"] or "").upper())
    print(f"  {len(ident):,} CCOM identities")

    out, no_ident, bad_name = [], 0, 0
    for (ucid, fdate), court in bk_rows.items():
        info = ident.get(ucid)
        if not info:
            no_ident += 1
            continue
        first_raw, last_raw, st = info
        ft, lt = norm_tokens(first_raw), norm_tokens(last_raw)
        if not ft or not lt:
            bad_name += 1
            continue
        fy = fm = None
        if len(fdate) >= 7:
            try:
                fy, fm = int(fdate[:4]), int(fdate[5:7])
            except ValueError:
                pass
        out.append((f"cc_{ucid}", lt[-1], ft[0], st, None,
                    f"{first_raw} {last_raw}".strip(), fy, fm, fdate or court))
    con.executemany("INSERT OR REPLACE INTO people_bk VALUES(?,?,?,?,?,?,?,?,?)", out)
    con.executemany("INSERT OR REPLACE INTO ccom_incl_bk VALUES(?)",
                    [(u,) for u in incl_ids])
    con.commit()
    n = con.execute("SELECT COUNT(DISTINCT pid) FROM people_bk WHERE pid LIKE 'cc_%'").fetchone()[0]
    incl_only = con.execute("""SELECT COUNT(*) FROM ccom_incl_bk WHERE ucid NOT IN
        (SELECT CAST(SUBSTR(pid,4) AS INTEGER) FROM people_bk WHERE pid LIKE 'cc_%')""").fetchone()[0]
    print(f"CCOM: {len(out):,} BK records added, {n:,} distinct cc_ people "
          f"(skipped: {no_ident:,} no identity, {bad_name:,} bad name)")
    print(f"CCOM incl-in-BK only (filed but record rolled off, no date): {incl_only:,}")


# ── Phase 3: match ───────────────────────────────────────────────────────────

def phase_match():
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS matches(
        pid TEXT, cl_id INTEGER, tier TEXT, court_id TEXT, docket_number TEXT,
        case_name TEXT, cl_date_filed TEXT, cl_date_terminated TEXT,
        bureau_filed TEXT, month_diff INT, PRIMARY KEY(pid, cl_id))""")
    con.execute("DELETE FROM matches")

    print("Indexing docket captions by (last, first)...")
    con.execute("""CREATE TABLE IF NOT EXISTS docket_names(
        last TEXT, first TEXT, cl_id INTEGER)""")
    if not con.execute("SELECT COUNT(*) FROM docket_names").fetchone()[0]:
        batch, n = [], 0
        for cl_id, case_name in con.execute("SELECT cl_id, case_name FROM dockets"):
            for last, first in caption_name_keys(case_name):
                batch.append((last, first, cl_id))
            if len(batch) >= 100000:
                con.executemany("INSERT INTO docket_names VALUES(?,?,?)", batch)
                n += len(batch)
                batch = []
                print(f"\r  {n:,} caption names", end="", flush=True)
        if batch:
            con.executemany("INSERT INTO docket_names VALUES(?,?,?)", batch)
            n += len(batch)
        con.commit()
        print(f"\n  {n:,} caption name keys")
        con.execute("CREATE INDEX IF NOT EXISTS ix_dn ON docket_names(last, first)")
        con.commit()

    print("Matching people...")
    q_cand = """SELECT d.cl_id, d.court_id, d.docket_number, d.case_name,
                       d.date_filed, d.date_terminated
                FROM docket_names n JOIN dockets d ON d.cl_id = n.cl_id
                WHERE n.last = ? AND n.first = ?"""
    people = con.execute("""SELECT pid, last, first, state, filed_y, filed_m, filed_raw
                            FROM people_bk""").fetchall()
    out, done, t0 = [], 0, time.time()
    for pid, last, first, state, fy, fm, filed_raw in people:
        done += 1
        bureau_mi = month_index(fy, fm) if fy else None
        for cl_id, court_id, dno, cname, dfiled, dterm in con.execute(q_cand, (last, first)):
            same_state = court_state(court_id) == state
            mdiff = None
            if bureau_mi and dfiled and len(dfiled) >= 7:
                try:
                    mdiff = abs(month_index(int(dfiled[:4]), int(dfiled[5:7])) - bureau_mi)
                except ValueError:
                    pass
            date_ok = mdiff is not None and mdiff <= 3
            if same_state and date_ok:
                tier = "A"
            elif same_state:
                tier = "B"
            elif date_ok:
                tier = "C"
            else:
                continue  # name-only, wrong state, wrong date: noise
            out.append((pid, cl_id, tier, court_id, dno, cname, dfiled, dterm,
                        filed_raw, mdiff))
        if done % 20000 == 0:
            con.executemany("INSERT OR REPLACE INTO matches VALUES(?,?,?,?,?,?,?,?,?,?)", out)
            con.commit()
            out = []
            print(f"\r  {done:,}/{len(people):,} records "
                  f"({done/(time.time()-t0):,.0f}/s)", end="", flush=True)
    if out:
        con.executemany("INSERT OR REPLACE INTO matches VALUES(?,?,?,?,?,?,?,?,?,?)", out)
    con.commit()
    print()
    phase_stats()


def phase_stats():
    con = db()
    for label, q in [
        ("BK dockets in CL dump", "SELECT COUNT(*) FROM dockets"),
        ("people_bk records", "SELECT COUNT(*) FROM people_bk"),
        ("people_bk distinct people", "SELECT COUNT(DISTINCT pid) FROM people_bk"),
        ("matches total", "SELECT COUNT(*) FROM matches"),
        ("matched people (any tier)", "SELECT COUNT(DISTINCT pid) FROM matches"),
        ("matched people tier A (name+state+date)",
         "SELECT COUNT(DISTINCT pid) FROM matches WHERE tier='A'"),
        ("matched people tier B (name+state)",
         "SELECT COUNT(DISTINCT pid) FROM matches WHERE tier='B'"),
        ("matched people tier C (name+date, other state)",
         "SELECT COUNT(DISTINCT pid) FROM matches WHERE tier='C'"),
    ]:
        try:
            print(f"{label}: {con.execute(q).fetchone()[0]:,}")
        except sqlite3.OperationalError:
            print(f"{label}: (table missing)")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "stats"
    {"filter": phase_filter, "people": phase_people, "ccom": phase_ccom,
     "match": phase_match, "stats": phase_stats}[mode]()
