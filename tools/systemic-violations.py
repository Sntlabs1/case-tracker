#!/usr/bin/env python3
"""
Systemic Furnisher-Violation Discovery Engine (DuckDB over LEX tradeline parquets).

This is the clean, aggregate-only analytics product (business direction #1): per-
furnisher statistics no plaintiff firm can compute without the full population —
dispute-ignored rate (§1681i), disputed-but-still-reporting-with-balance (live
harm), numerosity (distinct consumers), and double-sold-debt detection. NO PII is
emitted; output is defendant-level aggregates suitable for a "Systemic Violation
Report" sold as class-firm consulting.

DuckDB reads the parquet files in place — no 34GB cr_db.db SQLite staging needed.

Usage:
  python3 tools/systemic-violations.py                      # all furnishers, ranked
  python3 tools/systemic-violations.py --defendant "LVNV"   # one-defendant deep report
  python3 tools/systemic-violations.py --src _inspect/tl_eq_sample.parquet   # test on a shard
  python3 tools/systemic-violations.py --out data/systemic-violations.json

Data vintage: LEX tradelines are a ~2019 snapshot (last_reported_date maxes at
2019-10). These statistics prove the systemic PATTERN; "still reporting today"
requires a fresh consented pull. CCOM is the current-dated population (separate).
"""
import argparse, json, sys, os
from pathlib import Path

try:
    import duckdb
except ImportError:
    sys.exit("duckdb not installed — run: /usr/bin/python3 -m pip install --user duckdb")

sys.path.insert(0, str(Path(__file__).parent))
from defendant_token import canonical_token  # shared canonical normalizer

SRC_DIR = Path(os.environ.get("CREDIT_SRC", "/Users/stef/credit-data-src"))
DEFAULT_GLOB = "LEX_EV_Tradelines_*.parquet"  # EQ + TU + EX, all shards

# Min tradelines for a furnisher to appear in the ranked overview (noise floor).
MIN_TRADELINES = 500


def build_canon_map(con, src):
    """Map every distinct raw furnisher spelling to its canonical defendant token,
    so 'LVNV FUNDING LLC' / 'LVNV FUNDING' collapse to one defendant. The heavy
    scan stays in DuckDB; canonicalization runs on the small distinct-name set."""
    names = [r[0] for r in con.execute(
        f"SELECT DISTINCT creditor_name_raw FROM read_parquet('{src}') WHERE creditor_name_raw IS NOT NULL"
    ).fetchall()]
    pairs = [(n, canonical_token(n)) for n in names]
    con.execute("CREATE OR REPLACE TEMP TABLE canon_map (raw VARCHAR, canon VARCHAR)")
    con.executemany("INSERT INTO canon_map VALUES (?, ?)", pairs)
    return len(pairs)


def resolve_src(src_arg):
    """Return a DuckDB read_parquet path expression for the requested source."""
    if src_arg:
        p = (SRC_DIR / src_arg) if not os.path.isabs(src_arg) else Path(src_arg)
        return str(p)
    return str(SRC_DIR / DEFAULT_GLOB)


def overview(con, src):
    """Per-DEFENDANT systemic-violation metrics (canonical token), ranked by
    disputed volume. Distinct-consumer counts are correct at canonical level
    because the token is joined in before the aggregation."""
    return con.execute(f"""
        SELECT
            m.canon                                                        AS defendant,
            count(DISTINCT t.internal_user_id)                             AS consumers,
            count(*)                                                       AS tradelines,
            sum(t.dispute_flag)                                            AS disputed,
            round(100.0 * sum(t.dispute_flag) / count(*), 1)               AS disputed_pct,
            sum(CASE WHEN t.dispute_flag = 1 AND t.current_balance_cents > 0
                     THEN 1 ELSE 0 END)                                    AS disputed_owing,
            round(avg(CASE WHEN t.current_balance_cents > 0
                           THEN t.current_balance_cents END) / 100.0, 0)   AS avg_balance_usd,
            count(DISTINCT lower(trim(t.original_creditor_name)))
                FILTER (WHERE t.original_creditor_name IS NOT NULL)        AS distinct_orig_creditors
        FROM read_parquet('{src}') t
        JOIN canon_map m ON m.raw = t.creditor_name_raw
        WHERE m.canon <> ''
        GROUP BY 1
        HAVING count(*) >= {MIN_TRADELINES}
        ORDER BY disputed DESC
    """).fetchall()


def double_sold(con, src):
    """Person+original-creditor pairs reported by 2+ furnishers = sold-debt chains."""
    return con.execute(f"""
        WITH pairs AS (
            SELECT internal_user_id,
                   lower(trim(original_creditor_name))   AS oc,
                   count(DISTINCT creditor_name_raw)      AS buyers
            FROM read_parquet('{src}')
            WHERE original_creditor_name IS NOT NULL
              AND length(trim(original_creditor_name)) > 2
            GROUP BY 1, 2
        )
        SELECT count(*) FILTER (WHERE buyers >= 2) AS double_sold_pairs,
               count(*) FILTER (WHERE buyers >= 3) AS triple_plus_pairs,
               count(*)                            AS total_pairs
        FROM pairs
    """).fetchone()


def defendant_report(con, src, needle):
    """Deep single-defendant report (canonical token): class-cert memo numbers."""
    token = canonical_token(needle)
    base = con.execute(f"""
        SELECT count(DISTINCT t.internal_user_id)                     AS consumers,
               count(*)                                               AS tradelines,
               sum(t.dispute_flag)                                    AS disputed,
               round(100.0*sum(t.dispute_flag)/count(*),1)            AS disputed_pct,
               sum(CASE WHEN t.dispute_flag=1 AND t.current_balance_cents>0 THEN 1 ELSE 0 END) AS disputed_owing,
               min(t.last_reported_date)                              AS first_reported,
               max(t.last_reported_date)                              AS last_reported,
               sum(CASE WHEN t.last_reported_date >= DATE '2024-01-01' THEN 1 ELSE 0 END) AS recent_2yr
        FROM read_parquet('{src}') t
        JOIN canon_map m ON m.raw = t.creditor_name_raw
        WHERE m.canon = '{token}'
    """).fetchone()
    return {"token": token, "consumers": base[0], "tradelines": base[1], "disputed": base[2],
            "disputed_pct": base[3], "disputed_with_balance": base[4],
            "first_reported": str(base[5]), "last_reported": str(base[6]),
            "tradelines_since_2024": base[7]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="parquet file/glob under CREDIT_SRC (default all LEX tradelines)")
    ap.add_argument("--defendant", help="furnisher name substring for a deep report")
    ap.add_argument("--out", help="write full overview JSON here")
    args = ap.parse_args()

    src = resolve_src(args.src)
    con = duckdb.connect()
    con.execute("PRAGMA threads=8")
    n_names = build_canon_map(con, src)

    if args.defendant:
        rep = defendant_report(con, src, args.defendant)
        print(f"\n=== Systemic Violation Report: {args.defendant.upper()}  (token: {rep['token']}) ===")
        print(f"  Consumers (numerosity):     {rep['consumers']:,}")
        print(f"  Tradelines:                 {rep['tradelines']:,}")
        print(f"  Disputed (§1681i):          {rep['disputed']:,} ({rep['disputed_pct']}%)")
        print(f"  Disputed + still owing:     {rep['disputed_with_balance']:,}")
        print(f"  Reported since 2024:        {rep['tradelines_since_2024']:,}")
        print(f"  Reporting window:           {rep['first_reported']} → {rep['last_reported']}")
        return

    rows = overview(con, src)
    ds = double_sold(con, src)
    print(f"\n=== Per-defendant systemic-violation overview "
          f"({len(rows)} defendants ≥ {MIN_TRADELINES} tradelines, from {n_names:,} raw spellings) ===")
    print(f"  {'defendant':36s} {'consumers':>10s} {'tradelines':>11s} {'disp%':>6s} {'disp_owing':>11s}")
    for r in rows[:40]:
        print(f"  {(r[0] or '')[:36]:36s} {r[1]:>10,} {r[2]:>11,} {r[4]:>5}% {r[5]:>11,}")
    print(f"\n  Double-sold-debt chains: {ds[0]:,} pairs (2+ buyers), {ds[1]:,} with 3+ buyers, "
          f"of {ds[2]:,} person-originalcreditor pairs")

    if args.out:
        out = {
            "source": src,
            "defendants": [
                {"defendant": r[0], "consumers": r[1], "tradelines": r[2],
                 "disputed": r[3], "disputed_pct": r[4], "disputed_with_balance": r[5],
                 "avg_balance_usd": r[6], "distinct_original_creditors": r[7]}
                for r in rows
            ],
            "double_sold": {"pairs_2plus": ds[0], "pairs_3plus": ds[1], "total_pairs": ds[2]},
        }
        Path(args.out).write_text(json.dumps(out, indent=2))
        print(f"\n  wrote {args.out} ({len(rows)} furnishers)")


if __name__ == "__main__":
    main()
