#!/usr/bin/env python3
"""
Systemic Furnisher-Violation Report generator (business direction #1).

Per-defendant, self-contained HTML report from the DuckDB engine — the
aggregate, class-cert-grade statistics no plaintiff firm can compute without the
full population: numerosity, §1681i dispute-ignored rate, disputed-still-owing,
live (current) harm, account composition, geographic distribution, double-sold
chain-of-title, the federal docket landscape, and FCRA §1681n recovery sizing.
Aggregate-only, NO PII.

  python3 tools/build-systemic-report.py --defendant "LVNV"
  python3 tools/build-systemic-report.py --batch            # top debt buyers
  python3 tools/build-systemic-report.py --batch --out-dir data/credit-com-report/svr

DuckDB over LEX tradeline parquets (224.7M rows, through 2026-05). Docket data
from the per-defendant files in data/pacer-cases/.
"""
import duckdb, sys, html, argparse, datetime, json, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from defendant_token import canonical_token

SRC = Path("/Users/stef/credit-data-src")
TL  = str(SRC / "LEX_EV_Tradelines_*.parquet")
IDF = str(SRC / "LEX_EV_Identity_*.parquet")
PACER_DIR = Path(__file__).parent.parent / "data" / "pacer-cases"
PANEL = 5528402          # distinct people in the LEX panel
FCRA_LOW, FCRA_HIGH = 100, 1000
RECENT_CUTOFF = "2024-01-01"

# Top debt buyers / collectors for batch mode (display names -> canonicalized).
BATCH_DEFENDANTS = [
    "LVNV Funding", "Portfolio Recovery Associates", "Midland Credit Management",
    "Midland Funding", "Jefferson Capital Systems", "Convergent Outsourcing",
    "I.C. System", "Enhanced Recovery Company", "Account Resolution Services",
    "AD Astra Recovery Services", "Wakefield & Associates", "Transworld Systems",
    "Diversified Consultants", "National Credit Adjusters", "Commonwealth Financial Systems",
    "Credit Collection Services", "Americollect", "Medical Data Systems",
    "Caine & Weiner", "United Revenue Corp",
]

MMYY = lambda c: (f"TRY(make_date(CASE WHEN CAST(substr({c},3,2) AS INT)<=30 THEN 2000 ELSE 1900 END"
                  f"+CAST(substr({c},3,2) AS INT), CAST(substr({c},1,2) AS INT), 1))")


# ---- docket landscape (PACER per-defendant files) ----------------------------
_pacer_map = None
def pacer_index():
    global _pacer_map
    if _pacer_map is None:
        _pacer_map = {}
        for p in PACER_DIR.glob("*.json"):
            if p.name.startswith("_"):
                continue
            name = re.sub(r"\([^)]*\)", "", p.stem).replace("_", " ").strip()
            _pacer_map.setdefault(canonical_token(name), p)
    return _pacer_map


def dockets(target):
    p = pacer_index().get(target)
    if not p:
        return None
    d = json.loads(p.read_text())
    cases = d.get("cases", [])
    recent = sorted([c for c in cases if (c.get("dateFiled") or "") >= "2024-01-01"],
                    key=lambda c: c.get("dateFiled", ""), reverse=True)
    examples = recent[:6] if recent else sorted(cases, key=lambda c: c.get("dateFiled", ""), reverse=True)[:6]
    return dict(total=d.get("caseCount", len(cases)), open=d.get("openCases", 0),
                closed=d.get("closedCases", 0), recent24=len(recent), examples=examples)


# ---- per-defendant metrics ---------------------------------------------------
def compute(con, target):
    con.execute("CREATE OR REPLACE TEMP TABLE keep AS SELECT raw FROM allmap WHERE canon = ?", [target])
    if con.execute("SELECT count(*) FROM keep").fetchone()[0] == 0:
        return None
    con.execute(f"""CREATE OR REPLACE TEMP TABLE d AS SELECT t.internal_user_id uid, t.account_status status,
        t.open_date, t.last_reported_date lrd, t.dispute_flag disp, t.current_balance_cents bal,
        lower(trim(t.original_creditor_name)) oc
        FROM read_parquet('{TL}') t JOIN keep k ON k.raw=t.creditor_name_raw""")
    base = con.execute(f"""SELECT count(*) tl, count(DISTINCT uid) ppl, sum(disp) disp,
        sum(CASE WHEN disp=1 AND bal>0 THEN 1 ELSE 0 END) disp_owe,
        count(DISTINCT CASE WHEN disp=1 THEN uid END) disp_ppl,
        round(avg(CASE WHEN bal>0 THEN bal END)/100.0,0) avg_bal,
        min(lrd) first_rep, max(lrd) last_rep,
        count(DISTINCT CASE WHEN lrd>=DATE '{RECENT_CUTOFF}' THEN uid END) live_ppl,
        sum(CASE WHEN lrd>=DATE '{RECENT_CUTOFF}' THEN 1 ELSE 0 END) live_tl
        FROM d""").fetchone()
    status = con.execute("SELECT status,count(*) c FROM d GROUP BY 1 ORDER BY 2 DESC LIMIT 8").fetchall()
    states = con.execute(f"""SELECT i.current_address_state st, count(DISTINCT d.uid) c
        FROM d JOIN read_parquet('{IDF}') i ON i.internal_user_id=d.uid
        WHERE i.current_address_state IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12""").fetchall()
    con.execute("CREATE OR REPLACE TEMP TABLE dp AS SELECT DISTINCT uid, oc FROM d WHERE oc IS NOT NULL AND length(oc)>2")
    double_sold = con.execute(f"""SELECT count(*) FROM (
          SELECT DISTINCT dp.uid, dp.oc FROM dp
          JOIN read_parquet('{TL}') t ON t.internal_user_id=dp.uid AND lower(trim(t.original_creditor_name))=dp.oc
          JOIN allmap m ON m.raw=t.creditor_name_raw
          WHERE m.canon <> ? AND m.canon <> '' )""", [target]).fetchone()[0]
    return dict(target=target, spellings=con.execute("SELECT count(*) FROM keep").fetchone()[0],
                tl=base[0], ppl=base[1], disp=base[2], disp_owe=base[3], disp_ppl=base[4],
                avg_bal=base[5], first_rep=str(base[6]), last_rep=str(base[7]),
                live_ppl=base[8], live_tl=base[9],
                disp_pct=round(100.0*base[2]/base[0], 1) if base[0] else 0,
                status=status, states=states, double_sold=double_sold, dockets=dockets(target))


def fmt(n): return f"{n:,}" if isinstance(n, int) else (f"{n:,.0f}" if n else "0")
def dollars(n): return f"${n/1e6:.1f}M" if n >= 1e6 else (f"${n/1e3:.0f}K" if n >= 1e3 else f"${n:.0f}")


def render(m):
    title = m["target"].title()
    rows_status = "".join(f"<tr><td>{html.escape(str(s[0]))}</td><td class=n>{fmt(s[1])}</td></tr>" for s in m["status"])
    rows_states = "".join(f"<tr><td>{html.escape(str(s[0]))}</td><td class=n>{fmt(s[1])}</td></tr>" for s in m["states"])
    rec_lo, rec_hi = m["disp_ppl"]*FCRA_LOW, m["disp_ppl"]*FCRA_HIGH
    today = datetime.date.today().isoformat()

    dk = m["dockets"]
    if dk:
        ex = "".join(
            f"<tr><td>{html.escape((c.get('caseTitle') or '')[:60])}</td>"
            f"<td>{html.escape((c.get('courtId') or '').upper())}</td>"
            f"<td>{html.escape(c.get('dateFiled') or '')}</td>"
            f"<td>{html.escape(c.get('status') or '')}</td></tr>" for c in dk["examples"])
        docket_section = f"""
<h2>Federal docket landscape</h2>
<p>{html.escape(title)} is named in <b>{fmt(dk['total'])}</b> federal consumer-protection dockets
({fmt(dk['open'])} open, {fmt(dk['recent24'])} filed since 2024) — the theory is actively litigated and
the plaintiffs' bar is engaged. Recent filings:</p>
<table><tr><th>Case</th><th>Court</th><th>Filed</th><th>Status</th></tr>{ex}</table>
<p style="font-size:11px;color:var(--muted);margin-top:6px">Federal dockets naming this defendant (NOS 480/485/890), enumerated via PACER.</p>"""
    else:
        docket_section = ""

    return f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Systemic Violation Report — {html.escape(title)}</title>
<style>
:root{{--ink:#1a1a1a;--muted:#6b6b6b;--accent:#2D7D95;--line:#e6e2d8;--cream:#faf8f3}}
*{{box-sizing:border-box}}body{{margin:0;font-family:'DM Sans',-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--cream);line-height:1.55}}
.wrap{{max-width:880px;margin:0 auto;padding:0 28px 64px}}
header{{background:#262626;color:#f3efe6;padding:36px 28px}}
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
<header><h1>Systemic Violation Report</h1>
<div class=sub>{html.escape(title)} &nbsp;·&nbsp; FCRA § 1681i furnisher analysis &nbsp;·&nbsp; prepared {today}</div></header>
<div class=wrap>

<h2>Executive summary</h2>
<p class=lead>Across a {fmt(PANEL)}-consumer national credit panel, <b>{html.escape(title)}</b> furnished
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
at least <b>{fmt(m['disp_ppl'])}</b> such consumers (numerosity), with common questions as to
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
{docket_section}

<h2>Recovery exposure (illustrative ceiling)</h2>
<p>FCRA § 1681n provides statutory damages of $100–$1,000 per willful violation. Applied to the
{fmt(m['disp_ppl'])} consumers with a disputed {html.escape(title)} tradeline, statutory exposure ranges
<b>{dollars(rec_lo)} – {dollars(rec_hi)}</b>, before actual or punitive damages and fees. A ceiling for
scoping, not an expected recovery.</p>

<div class=note><b>Methodology &amp; provenance.</b> Aggregate analysis of a {fmt(PANEL)}-consumer national
credit panel (tradeline-level, last reported through May 2026). Furnisher spellings collapsed to one
defendant via canonical normalization ({m['spellings']} source spellings). "Disputed" = the bureau dispute
flag on the furnished tradeline. Docket counts from PACER. No personally identifying information is
contained in this report. Statistics describe a systemic furnishing pattern; individual claims require
individual verification. Not legal advice. Prepared {today}.</div>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--defendant")
    ap.add_argument("--batch", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--out-dir", default="data/credit-com-report")
    a = ap.parse_args()
    if not (a.defendant or a.batch):
        ap.error("pass --defendant NAME or --batch")

    con = duckdb.connect(); con.execute("PRAGMA threads=6"); con.execute("SET memory_limit='8GB'")
    con.execute(f"SET temp_directory='{SRC/'_duckspill'}'")
    # canonical map computed ONCE (reused across all defendants in batch mode)
    print("building canonical furnisher map ...", flush=True)
    raws = [r[0] for r in con.execute(
        f"SELECT DISTINCT creditor_name_raw FROM read_parquet('{TL}') WHERE creditor_name_raw IS NOT NULL").fetchall()]
    con.execute("CREATE TEMP TABLE allmap(raw VARCHAR, canon VARCHAR)")
    con.executemany("INSERT INTO allmap VALUES (?,?)", [(r, canonical_token(r)) for r in raws])

    targets = ([canonical_token(d) for d in BATCH_DEFENDANTS] if a.batch
               else [canonical_token(a.defendant)])
    seen, outdir = set(), Path(a.out_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for tok in targets:
        if tok in seen:
            continue
        seen.add(tok)
        m = compute(con, tok)
        if not m:
            print(f"  SKIP {tok}: no furnisher spellings match"); continue
        fname = f"svr-{tok.replace(' ','-')}.html"
        out = Path(a.out) if (a.out and not a.batch) else outdir / fname
        out.write_text(render(m))
        dk = m["dockets"]
        manifest.append({"token": tok, "name": tok.title(), "file": out.name,
                         "consumers": m["ppl"], "disputedPct": m["disp_pct"],
                         "disputedOwing": m["disp_owe"], "live": m["live_ppl"],
                         "dockets": dk["total"] if dk else 0})
        print(f"  {tok:34s} ppl={m['ppl']:>9,} disp={m['disp_pct']:>4}% owe={m['disp_owe']:>9,} "
              f"live={m['live_ppl']:>8,} dockets={dk['total'] if dk else 'n/a'} -> {out.name}", flush=True)
    # Manifest drives the platform tab; sort by disputed-still-owing (impact).
    if a.batch or len(manifest) > 1 or not a.out:
        manifest.sort(key=lambda r: r["disputedOwing"], reverse=True)
        (outdir / "index.json").write_text(json.dumps(
            {"generated": datetime.date.today().isoformat(), "reports": manifest}, indent=2))
        print(f"  wrote {outdir/'index.json'} ({len(manifest)} reports)")
    print(f"\nGenerated {len(manifest)} report(s) in {outdir}")


if __name__ == "__main__":
    main()
