#!/usr/bin/env python3
"""Export every known bankruptcy filer (LEX + CCOM) to Excel.

Reads the people_bk roster from cl_bk.db (built by bk-cl-match.py), joins
contact info from the identity sources, aggregates one row per person.

Output: data/credit-matches/bankruptcy-filers.xlsx  (gitignored, PII)
"""
import sqlite3
from collections import defaultdict
from pathlib import Path

import pandas as pd

WORK = Path("/tmp/credit-ingest-work")
OUT = Path("/Users/stef/MDL Business/data/credit-matches/bankruptcy-filers.xlsx")

con = sqlite3.connect(f"file:{WORK/'cl_bk.db'}?mode=ro", uri=True)
rows = con.execute("""SELECT pid, full_name, state, dob_year, filed_y, filed_m, filed_raw
                      FROM people_bk""").fetchall()
print(f"{len(rows):,} bankruptcy records")

people = {}
filings = defaultdict(list)
for pid, name, st, dy, fy, fm, raw in rows:
    people[pid] = (name, st, dy)
    if fy and fm:
        filings[pid].append(f"{fy}-{fm:02d}")
    elif raw:
        filings[pid].append(f"unparsed:{raw}")

# Contact info joins
lex_uids = {int(p[4:]) for p in people if p.startswith("lex_")}
cc_uids = {int(p[3:]) for p in people if p.startswith("cc_")}
contact = {}

for p in sorted(WORK.glob("id*.parquet")):
    df = pd.read_parquet(p, columns=["internal_user_id", "current_email",
                                     "current_Phone", "current_address_city",
                                     "current_address_zip"])
    df = df[df.internal_user_id.isin(lex_uids)]
    for uid, em, ph, city, zc in df.itertuples(index=False):
        contact[f"lex_{int(uid)}"] = (em, ph, city, zc, None)
print(f"LEX contact joined: {sum(1 for k in contact if k.startswith('lex_')):,}")

import pyarrow.csv as pcsv
idt = pcsv.read_csv(WORK / "CCOM_EV_Identity.csv",
                    read_options=pcsv.ReadOptions(block_size=64 * 1024 * 1024))
for r in idt.select(["ucid", "email", "phone_number", "City",
                     "Postal_Code", "dnc_date"]).to_pylist():
    if r["ucid"] in cc_uids:
        contact[f"cc_{r['ucid']}"] = (r["email"], r["phone_number"], r["City"],
                                      r["Postal_Code"], r["dnc_date"])
print(f"CCOM contact joined: {sum(1 for k in contact if k.startswith('cc_')):,}")

out = []
for pid, (name, st, dy) in people.items():
    em, ph, city, zc, dnc = contact.get(pid, (None,) * 5)
    fl = sorted(set(filings.get(pid, [])))
    dated = [f for f in fl if not f.startswith("unparsed")]
    out.append({
        "id": pid,
        "dataset": "LEX" if pid.startswith("lex_") else "CCOM",
        "full_name": name,
        "state": st,
        "city": city,
        "zip": zc,
        "dob_year": dy,
        "email": em,
        "phone": ph,
        "dnc": "YES" if dnc else "",
        "bk_filings_count": len(fl),
        "bk_filing_dates": ", ".join(fl),
        "earliest_filing": dated[0] if dated else "",
        "latest_filing": dated[-1] if dated else "",
    })

df = pd.DataFrame(out).sort_values(["latest_filing"], ascending=False)
print(f"{len(df):,} people -> {OUT}")
OUT.parent.mkdir(parents=True, exist_ok=True)
with pd.ExcelWriter(OUT, engine="openpyxl") as xw:
    df.to_excel(xw, sheet_name="Bankruptcy Filers", index=False)
print("done")
