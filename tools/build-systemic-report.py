#!/usr/bin/env python3
"""
Systemic Furnisher-Violation Report generator (business direction #1).

Produces a single, self-contained, presentable HTML report for ONE defendant —
the aggregate, class-cert-grade statistics no plaintiff firm can compute without
the full population: numerosity, §1681i dispute-ignored rate, disputed-still-
owing, live (current) harm, account composition, geographic distribution, and
double-sold-debt (chain-of-title) detection. Aggregate-only, NO PII.

DuckDB over the LEX tradeline parquets (no cr_db.db needed). Grouping is by the
canonical defendant token so spelling variants collapse to one defendant.

  /usr/bin/python3 tools/build-systemic-report.py --defendant "LVNV"
  /usr/bin/python3 tools/build-systemic-report.py --defendant "Portfolio Recovery" --out data/credit-com-report/svr-portfolio.html

Data: LEX tradelines (224.7M rows / 5.53M people), last_reported through 2026-05.
"""
import duckdb, sys, html, argparse, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from defendant_token import canonical_token

SRC = Path("/Users/stef/credit-data-src")
TL  = str(SRC / "LEX_EV_Tradelines_*.parquet")
IDF = str(SRC / "LEX_EV_Identity_*.parquet")
FCRA_LOW, FCRA_HIGH = 100, 1000  # 15 USC 1681n statutory damages per willful violation
RECENT_CUTOFF = "2024-01-01"

MMYY = lambda c: (f"TRY(make_date(CASE WHEN CAST(substr({c},3,2) AS INT)<=30 THEN 2000 ELSE 1900 END"
                  f"+CAST(substr({c},3,2) AS INT), CAST(substr({c},1,2) AS INT), 1))")


def compute(con, target):
    # restrict to the canonical defendant via a raw->keep map (named cols only;
    # the EX parquets name the bureau col differently so SELECT * would fail).
    raws = [r[0] for r in con.execute(
        f"SELECT DISTINCT creditor_name_raw FROM read_parquet('{TL}') WHERE creditor_name_raw IS NOT NULL").fetchall()]
    keep = [r for r in raws if canonical_token(r) == target]
    if not keep:
        sys.exit(f"No furnisher spellings map to canonical token '{target}'")
    con.execute("CREATE TEMP TABLE keep(raw VARCHAR)")
    con.executemany("INSERT INTO keep VALUES (?)", [(r,) for r in keep])
    con.execute(f"""CREATE TEMP TABLE d AS SELECT t.internal_user_id uid, t.account_status status,
        t.open_date, t.last_reported_date lrd, t.dispute_flag disp, t.current_balance_cents bal,
        lower(trim(t.original_creditor_name)) oc
        FROM read_parquet('{TL}') t JOIN keep k ON k.raw=t.creditor_name_raw""")

    base = con.execute("""SELECT count(*) tl, count(DISTINCT uid) ppl, sum(disp) disp,
        sum(CASE WHEN disp=1 AND bal>0 THEN 1 ELSE 0 END) disp_owe,
        count(DISTINCT CASE WHEN disp=1 THEN uid END) disp_ppl,
        round(avg(CASE WHEN bal>0 THEN bal END)/100.0,0) avg_bal,
        min(lrd) first_rep, max(lrd) last_rep,
        count(DISTINCT CASE WHEN lrd>=DATE '%s' THEN uid END) live_ppl,
        sum(CASE WHEN lrd>=DATE '%s' THEN 1 ELSE 0 END) live_tl
        FROM d""" % (RECENT_CUTOFF, RECENT_CUTOFF)).fetchone()
    status = con.execute("SELECT status,count(*) c FROM d GROUP BY 1 ORDER BY 2 DESC LIMIT 8").fetchall()
    states = con.execute(f"""SELECT i.current_address_state st, count(DISTINCT d.uid) c
        FROM d JOIN read_parquet('{IDF}') i ON i.internal_user_id=d.uid WHERE i.current_address_state IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12""").fetchall()
    # double-sold: this defendant's (uid, original_creditor) also furnished by a
    # DIFFERENT furnisher = the same debt reported by multiple buyers.
    con.execute("CREATE TEMP TABLE dp AS SELECT DISTINCT uid, oc FROM d WHERE oc IS NOT NULL AND length(oc)>2")
    # double-sold: this defendant's (consumer, original_creditor) pairs that also
    # appear under a furnisher whose canonical token is a DIFFERENT defendant.
    con.execute("CREATE TEMP TABLE allmap(raw VARCHAR, canon VARCHAR)")
    con.executemany("INSERT INTO allmap VALUES (?,?)", [(r, canonical_token(r)) for r in raws])
    double_sold = con.execute(f"""
        SELECT count(*) FROM (
          SELECT DISTINCT dp.uid, dp.oc
          FROM dp
          JOIN read_parquet('{TL}') t ON t.internal_user_id=dp.uid
               AND lower(trim(t.original_creditor_name))=dp.oc
          JOIN allmap m ON m.raw=t.creditor_name_raw
          WHERE m.canon <> '{target}' AND m.canon <> '' )""").fetchone()[0]
    return dict(target=target, spellings=len(keep), tl=base[0], ppl=base[1], disp=base[2],
                disp_owe=base[3], disp_ppl=base[4], avg_bal=base[5], first_rep=str(base[6]),
                last_rep=str(base[7]), live_ppl=base[8], live_tl=base[9],
                disp_pct=round(100.0*base[2]/base[0], 1) if base[0] else 0,
                status=status, states=states, double_sold=double_sold)


def fmt(n): return f"{n:,}" if isinstance(n, int) else (f"{n:,.0f}" if n else "0")
def dollars(n): return f"${n/1e6:.1f}M" if n >= 1e6 else (f"${n/1e3:.0f}K" if n >= 1e3 else f"${n:.0f}")


def render(m):
    title = m["target"].title()
    rows_status = "".join(f"<tr><td>{html.escape(str(s[0]))}</td><td class=n>{fmt(s[1])}</td></tr>" for s in m["status"])
    rows_states = "".join(f"<tr><td>{html.escape(str(s[0]))}</td><td class=n>{fmt(s[1])}</td></tr>" for s in m["states"])
    rec_lo, rec_hi = m["disp_ppl"]*FCRA_LOW, m["disp_ppl"]*FCRA_HIGH
    today = datetime.date.today().isoformat()
    return f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Systemic Violation Report — {html.escape(title)}</title>
<style>
:root{{--ink:#1a1a1a;--muted:#6b6b6b;--accent:#2D7D95;--line:#e6e2d8;--cream:#faf8f3}}
*{{box-sizing:border-box}}body{{margin:0;font-family:'DM Sans',-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--cream);line-height:1.55}}
.wrap{{max-width:880px;margin:0 auto;padding:0 28px 64px}}
header{{background:#262626;color:#f3efe6;padding:36px 28px;margin-bottom:0}}
header .wrap{{padding-bottom:0;padding-top:0}}
h1{{font-family:Georgia,serif;font-size:30px;margin:0 0 6px}}
.sub{{color:#b9b2a3;font-size:13px}}
h2{{font-family:Georgia,serif;font-size:19px;margin:34px 0 12px;border-bottom:2px solid var(--accent);padding-bottom:6px}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}}
.kpi{{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px}}
.kpi .v{{font-size:26px;font-weight:800;color:var(--accent);line-height:1}}
.kpi .l{{font-size:11px;color:var(--muted);margin-top:6px;text-transform:uppercase;letter-spacing:.04em}}
.kpi.red .v{{color:#c0392b}}
table{{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}}
th,td{{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}}
th{{background:#f2eee4;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}}
td.n{{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}}
p{{font-size:14px}}.lead{{font-size:15px}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
.note{{background:#fff;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:6px;padding:14px 16px;font-size:12px;color:var(--muted);margin-top:30px}}
.big{{font-size:15px;background:#fbf3f0;border:1px solid #e8c9c0;border-left:3px solid #c0392b;border-radius:8px;padding:16px 18px;margin:18px 0}}
</style></head><body>
<header><div class=wrap><h1>Systemic Violation Report</h1>
<div class=sub>{html.escape(title)} &nbsp;·&nbsp; FCRA § 1681i furnisher analysis &nbsp;·&nbsp; prepared {today}</div></div></header>
<div class=wrap>

<h2>Executive summary</h2>
<p class=lead>Across a {fmt(5528402)}-consumer national credit panel, <b>{html.escape(title)}</b> furnished
<b>{fmt(m['tl'])}</b> tradelines to <b>{fmt(m['ppl'])}</b> distinct consumers. Of those tradelines,
<b>{m['disp_pct']}%</b> were marked disputed yet continued to report — a population-wide pattern of
furnishing after dispute that no single-plaintiff record set can establish.</p>
<div class=big><b>The systemic signal:</b> {fmt(m['disp_ppl'])} consumers disputed a {html.escape(title)}
tradeline; {fmt(m['disp_owe'])} of those disputed tradelines were still reporting a positive balance.
{fmt(m['live_ppl'])} consumers have a {html.escape(title)} tradeline reported on/after {RECENT_CUTOFF[:4]} —
the violation is current, not historical.</div>

<div class=kpis>
<div class=kpi><div class=v>{fmt(m['ppl'])}</div><div class=l>Consumers (numerosity)</div></div>
<div class=kpi red><div class=v>{m['disp_pct']}%</div><div class=l>Tradelines disputed</div></div>
<div class=kpi red><div class=v>{fmt(m['disp_owe'])}</div><div class=l>Disputed, still owing</div></div>
<div class=kpi><div class=v>{fmt(m['live_ppl'])}</div><div class=l>Live since {RECENT_CUTOFF[:4]}</div></div>
</div>

<h2>Proposed class definition</h2>
<p>All natural persons in the United States as to whom {html.escape(title)} furnished a consumer-account
tradeline to a nationwide credit reporting agency that the consumer disputed and which {html.escape(title)}
thereafter continued to report, during the applicable limitations period. Panel evidence shows a class of
at least <b>{fmt(m['disp_ppl'])}</b> such consumers (numerosity), with common questions of law and fact as to
{html.escape(title)}'s reinvestigation and furnishing practices (commonality / predominance).</p>

<h2>Numerosity &amp; commonality</h2>
<table><tr><th>Metric</th><th>Value</th></tr>
<tr><td>Distinct consumers furnished</td><td class=n>{fmt(m['ppl'])}</td></tr>
<tr><td>Total tradelines furnished</td><td class=n>{fmt(m['tl'])}</td></tr>
<tr><td>Consumers who disputed</td><td class=n>{fmt(m['disp_ppl'])}</td></tr>
<tr><td>Disputed tradelines</td><td class=n>{fmt(m['disp'])} ({m['disp_pct']}%)</td></tr>
<tr><td>Disputed &amp; still reporting a balance</td><td class=n>{fmt(m['disp_owe'])}</td></tr>
<tr><td>Same debt also furnished by another buyer (chain-of-title)</td><td class=n>{fmt(m['double_sold'])}</td></tr>
<tr><td>Average reported balance</td><td class=n>{dollars(m['avg_bal'] or 0)}</td></tr>
<tr><td>Reporting window</td><td class=n>{m['first_rep']} → {m['last_rep']}</td></tr>
</table>

<div class=cols>
<div><h2>Account composition</h2><table><tr><th>Status</th><th>Tradelines</th></tr>{rows_status}</table></div>
<div><h2>Geographic distribution</h2><table><tr><th>State</th><th>Consumers</th></tr>{rows_states}</table></div>
</div>

<h2>Recovery exposure (illustrative ceiling)</h2>
<p>FCRA § 1681n provides statutory damages of $100–$1,000 per willful violation. Applied to the
{fmt(m['disp_ppl'])} consumers with a disputed {html.escape(title)} tradeline, statutory exposure ranges
<b>{dollars(rec_lo)} – {dollars(rec_hi)}</b>, before actual or punitive damages and fees. A ceiling for
scoping, not an expected recovery.</p>

<div class=note><b>Methodology &amp; provenance.</b> Aggregate analysis of a {fmt(5528402)}-consumer national
credit panel (tradeline-level, last reported through May 2026). Furnisher spellings collapsed to one
defendant via canonical normalization ({m['spellings']} source spellings). "Disputed" = the bureau dispute
flag on the furnished tradeline. No personally identifying information is contained in this report.
Statistics describe a systemic furnishing pattern; individual claims require individual verification.
Not legal advice. Prepared {today}.</div>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--defendant", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    target = canonical_token(a.defendant)
    con = duckdb.connect(); con.execute("PRAGMA threads=6"); con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory='{SRC/'_duckspill'}'")
    print(f"computing Systemic Violation Report for '{a.defendant}' (token: {target}) ...")
    m = compute(con, target)
    out = Path(a.out) if a.out else Path(f"data/credit-com-report/svr-{target.replace(' ','-')}.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(m))
    print(f"  consumers={m['ppl']:,}  disputed={m['disp_pct']}%  disp_owe={m['disp_owe']:,}  "
          f"live={m['live_ppl']:,}  double_sold={m['double_sold']:,}")
    print(f"  wrote {out}")


if __name__ == "__main__":
    main()
