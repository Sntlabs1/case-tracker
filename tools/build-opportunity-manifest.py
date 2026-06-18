#!/usr/bin/env python3
"""
Build the deployable opportunity manifest for the Opportunities board.

Computes per-DEFENDANT (canonical token) signals across the full LEX tradeline
panel — consumers, dispute rate, disputed-still-owing, and live (reported since
2024) — for every furnisher above a cohort threshold, flags which already have a
Systemic Violation Report, and writes public/opportunities.json (served to the
app). The board merges this with live litigation/settlement status from
/api/portfolio-cases.

  /usr/bin/python3 tools/build-opportunity-manifest.py [--min-consumers 2500]
"""
import duckdb, sys, json, argparse, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from defendant_token import canonical_token

SRC = Path("/Users/stef/credit-data-src")
TL  = str(SRC / "LEX_EV_Tradelines_*.parquet")
SVR_DIR = Path(__file__).parent.parent / "public" / "svr"
OUT = Path(__file__).parent.parent / "public" / "opportunities.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-consumers", type=int, default=2500)
    a = ap.parse_args()

    con = duckdb.connect(); con.execute("PRAGMA threads=6"); con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory='{SRC/'_duckspill'}'")
    print("building canonical furnisher map ...", flush=True)
    raws = [r[0] for r in con.execute(
        f"SELECT DISTINCT creditor_name_raw FROM read_parquet('{TL}') WHERE creditor_name_raw IS NOT NULL").fetchall()]
    con.execute("CREATE TEMP TABLE allmap(raw VARCHAR, canon VARCHAR)")
    con.executemany("INSERT INTO allmap VALUES (?,?)", [(r, canonical_token(r)) for r in raws])

    print("aggregating per-defendant signals ...", flush=True)
    rows = con.execute(f"""
        SELECT m.canon AS token,
               count(DISTINCT t.internal_user_id) AS consumers,
               count(*) AS tradelines,
               round(100.0*sum(t.dispute_flag)/count(*),1) AS disputed_pct,
               sum(CASE WHEN t.dispute_flag=1 AND t.current_balance_cents>0 THEN 1 ELSE 0 END) AS disputed_owing,
               count(DISTINCT CASE WHEN t.last_reported_date>=DATE '2024-01-01' THEN t.internal_user_id END) AS live
        FROM read_parquet('{TL}') t JOIN allmap m ON m.raw=t.creditor_name_raw
        WHERE m.canon <> ''
        GROUP BY 1
        HAVING count(DISTINCT t.internal_user_id) >= {a.min_consumers}
        ORDER BY consumers DESC
    """).fetchall()

    have_report = {p.name[len("svr-"):-len(".html")].replace("-", " ")
                   for p in SVR_DIR.glob("svr-*.html")}
    # report filenames use the token with spaces->dashes; rebuild the exact file
    def report_file(tok):
        f = f"svr-{tok.replace(' ', '-')}.html"
        return f if (SVR_DIR / f).exists() else None

    defendants = [{
        "token": r[0], "name": r[0].title(), "consumers": r[1], "tradelines": r[2],
        "disputedPct": r[3], "disputedOwing": r[4], "live": r[5],
        "reportFile": report_file(r[0]),
    } for r in rows]

    OUT.write_text(json.dumps({
        "generated": datetime.date.today().isoformat(),
        "minConsumers": a.min_consumers,
        "count": len(defendants),
        "withReport": sum(1 for d in defendants if d["reportFile"]),
        "defendants": defendants,
    }, indent=2))
    print(f"wrote {OUT}: {len(defendants):,} defendants (>= {a.min_consumers:,} consumers), "
          f"{sum(1 for d in defendants if d['reportFile'])} with reports")


if __name__ == "__main__":
    main()
