#!/usr/bin/env python3
"""
Step 1 (FREE, no KV writes) of the targeted credit KV correction.

Produces three lists from the local DuckDB corpus so the blast radius is known
before any production write:

  1. s524_keepers.csv   — the CORRECTED §524 discharge-violation cohort
                          (uid, live, bad_tl, last_rep). live=1 => still reporting
                          2024-2026 (no-SOL, high value). These KEEP a §524 tag.
  2. bk_filers.csv      — all bankruptcy-filer uids (the bounded set the write
                          pass will scan in KV; anyone here with a §524 tag who is
                          NOT a keeper gets the fabricated tag stripped).
  3. dedup_suppress.csv — lex_uid -> survivor ccom_ucid for humans present in BOTH
                          populations (suppress the lex_ twin, keep cc_).

Idempotent, validates its own output. Run: /usr/bin/python3 tools/credit-correction-export.py
"""
import duckdb, time, sys, csv
from pathlib import Path

SRC = Path("/Users/stef/credit-data-src")
OUT = SRC / "corrections"
OUT.mkdir(exist_ok=True)
TL  = str(SRC / "LEX_EV_Tradelines_*.parquet")
PR  = str(SRC / "LEX_EV_Public_Records_*.parquet")
LID = str(SRC / "LEX_EV_Identity_*.parquet")
CID = str(SRC / "CCOM_EV_Identity.csv")

# MMYY ('0317'=Mar 2017) -> first-of-month DATE; yy<=30 => 20yy else 19yy; bad -> NULL
def mmyy(c):
    return (f"TRY(make_date(CASE WHEN CAST(substr({c},3,2) AS INT)<=30 THEN 2000 ELSE 1900 END"
            f"+CAST(substr({c},3,2) AS INT), CAST(substr({c},1,2) AS INT), 1))")

PH10 = lambda c: f"right(regexp_replace({c}, '[^0-9]', '', 'g'), 10)"


def write_csv(path, header, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(header); w.writerows(rows)
    return path


def main():
    con = duckdb.connect()
    con.execute("PRAGMA threads=6")
    con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory='{SRC/'_duckspill'}'")
    t0 = time.time()

    # ---- bankruptcy filers (earliest parseable filing date) -------------------
    con.execute(f"""CREATE TEMP TABLE bk AS
        SELECT internal_user_id uid, min({mmyy('filing_date')}) bk_date
        FROM read_parquet('{PR}')
        WHERE Type='Bankruptcy' AND filing_date ~ '^[0-9]{{4}}$'
        GROUP BY 1 HAVING min({mmyy('filing_date')}) IS NOT NULL""")
    bk_n = con.execute("SELECT count(*) FROM bk").fetchone()[0]

    # ---- filer tradelines (join FIRST, then parse — the fast/safe plan) -------
    con.execute(f"""CREATE TEMP TABLE filer_tl AS
        SELECT t.internal_user_id uid, t.open_date, t.last_reported_date lrd, bk.bk_date
        FROM read_parquet('{TL}') t JOIN bk ON bk.uid=t.internal_user_id
        WHERE t.current_balance_cents>0 AND t.last_reported_date > bk.bk_date""")

    # buggy-tagged estimate = filers with ANY post-filing balance line (no
    # pre-petition check) — approximates what the old LEX run wrote to KV.
    buggy_tagged = con.execute("SELECT count(DISTINCT uid) FROM filer_tl").fetchone()[0]

    # ---- CORRECTED §524 keepers (pre-petition + still reporting + balance) ----
    keepers = con.execute(f"""
        SELECT uid,
               CASE WHEN max(lrd) >= DATE '2024-01-01' THEN 1 ELSE 0 END AS live,
               count(*) AS bad_tl,
               max(lrd) AS last_rep
        FROM filer_tl
        WHERE {mmyy('open_date')} IS NOT NULL AND {mmyy('open_date')} < bk_date
        GROUP BY uid""").fetchall()
    live_n = sum(1 for r in keepers if r[1] == 1)

    write_csv(OUT/"s524_keepers.csv", ["uid", "live", "bad_tl", "last_rep"],
              [(r[0], r[1], r[2], str(r[3])) for r in keepers])
    write_csv(OUT/"bk_filers.csv", ["uid"],
              ((r[0],) for r in con.execute("SELECT uid FROM bk").fetchall()))

    # to-untag estimate = buggy-tagged filers who are NOT corrected keepers
    untag_est = buggy_tagged - len(keepers)

    # ---- cross-population dedup (lex_ present in CCOM) ------------------------
    con.execute(f"""CREATE TEMP TABLE lex AS SELECT internal_user_id uid,
        CASE WHEN length(lower(trim(current_email)))>3 THEN lower(trim(current_email)) END em,
        CASE WHEN length({PH10('current_Phone')})=10 THEN {PH10('current_Phone')} END ph
        FROM read_parquet('{LID}')""")
    con.execute(f"""CREATE TEMP TABLE ccom AS SELECT ucid,
        CASE WHEN length(lower(trim(email)))>3 THEN lower(trim(email)) END em,
        CASE WHEN length({PH10('phone_number')})=10 THEN {PH10('phone_number')} END ph
        FROM read_csv_auto('{CID}', sample_size=-1, ignore_errors=true, types={{'ucid':'VARCHAR'}})""")
    dedup = con.execute("""
        SELECT lex_uid, min(ucid) survivor FROM (
            SELECT l.uid lex_uid, c.ucid FROM lex l JOIN ccom c ON l.em=c.em WHERE l.em IS NOT NULL
            UNION
            SELECT l.uid lex_uid, c.ucid FROM lex l JOIN ccom c ON l.ph=c.ph WHERE l.ph IS NOT NULL
        ) GROUP BY lex_uid""").fetchall()
    write_csv(OUT/"dedup_suppress.csv", ["lex_uid", "survivor_ccom_ucid"], dedup)

    # ---- validate output ------------------------------------------------------
    def lines(p): return sum(1 for _ in open(p)) - 1
    k_n, b_n, d_n = lines(OUT/"s524_keepers.csv"), lines(OUT/"bk_filers.csv"), lines(OUT/"dedup_suppress.csv")
    assert k_n == len(keepers),  f"keeper file {k_n} != {len(keepers)}"
    assert b_n == bk_n,          f"bk file {b_n} != {bk_n}"
    assert d_n == len(dedup),    f"dedup file {d_n} != {len(dedup)}"

    print(f"\n=== CORRECTION BLAST RADIUS  ({time.time()-t0:.0f}s) ===")
    print(f"  Bankruptcy filers (KV scan candidate set):     {bk_n:,}   -> bk_filers.csv")
    print(f"  Currently §524-tagged in KV (est, buggy logic): {buggy_tagged:,}")
    print(f"  CORRECTED §524 keepers:                         {len(keepers):,}   -> s524_keepers.csv")
    print(f"     of which LIVE (reporting 2024-2026):         {live_n:,}")
    print(f"  => §524 tags to STRIP (tagged minus keepers):   ~{untag_est:,}")
    print(f"  Dedup lex_ twins to suppress (keep cc_):        {len(dedup):,}   -> dedup_suppress.csv")
    print(f"\n  Approx KV writes for step 2 = ~{len(keepers)+untag_est+len(dedup):,} record updates")
    print(f"  (+ index maintenance). Files in {OUT}")


if __name__ == "__main__":
    sys.exit(main())
