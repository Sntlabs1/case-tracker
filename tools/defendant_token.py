# Canonical defendant normalization — Python mirror of api/_lib/defendantToken.js.
# SINGLE SOURCE OF TRUTH for the casepeople:<token> join key. Keep the ALIASES
# list in sync with the JS module verbatim when adding entries.

import re

# (needle_uppercased, canonical_token). If a raw string CONTAINS the needle it
# collapses to the token. Order matters — more specific needles first.
ALIASES = [
    # Debt buyers / collectors (FDCPA)
    ("MIDLAND FUNDING", "midland funding"),
    ("MIDLAND CREDIT", "midland credit management"),
    (" MCM ", "midland credit management"),  # double-bounded: bare "MCM", never MCMC / MCMURRAY / MCMASTER
    # bare "MIDLAND" omitted — collides with Midland States Bank / Midland Mortgage
    ("PORTFOLIO RECOV", "portfolio recovery associates"),
    ("LVNV", "lvnv funding"),
    ("RESURGENT", "resurgent capital"),
    ("ENCORE CAPITAL", "encore capital"),
    ("CAVALRY", "cavalry portfolio services"),
    ("ENHANCED RECOVERY", "enhanced recovery company"),
    (" ERC ", "enhanced recovery company"),  # double-bounded: bare "ERC"/"ERC COLLECTIONS", never "DISCOVERC"/"COMMERC" truncations
    ("TRANSWORLD", "transworld systems"),
    ("I.C. SYSTEM", "ic system"),
    ("IC SYSTEM", "ic system"),
    ("CONVERGENT", "convergent outsourcing"),
    ("JEFFERSON CAPITAL", "jefferson capital systems"),
    ("DIVERSIFIED CONSULT", "diversified consultants"),
    ("CREDIT COLLECTION SERV", "credit collection services"),
    ("NATIONAL CREDIT ADJUST", "national credit adjusters"),
    ("COMMONWEALTH FINANCIAL", "commonwealth financial systems"),
    ("WAKEFIELD", "wakefield associates"),
    ("MEDICAL DATA SYS", "medical data systems"),
    ("CAINE", "caine weiner"),
    ("AD ASTRA", "ad astra recovery services"),
    ("AMERICOLLECT", "americollect"),
    ("ACCOUNT RESOLUTION", "account resolution services"),
    ("UNITED REVENUE", "united revenue corp"),
    ("CONVERGYS", "convergent outsourcing"),
    ("RADIUS GLOBAL", "radius global solutions"),
    ("CBE GROUP", "cbe group"),
    ("AMSHER", "amsher collection"),
    ("NCO FINANCIAL", "nco financial"),
    ("HUNTER WARFIELD", "hunter warfield"),
    ("SHERMAN FIN", "sherman financial"),  # narrowed: bare "SHERMAN" hit TX city branch names (SERVICE LOAN CO-SHERMAN etc.)
    ("SHERMAN ORIG", "sherman financial"),
    ("SHERMAN ACQ", "sherman financial"),
    ("CACH ", "cach llc"),               # boundary: "CACH LLC" / bare "CACH", never CACHE VALLEY BANK
    ("CACH,", "cach llc"),               # "CACH, LLC" comma form, 8K rows
    (" CCO ", "cco mortgage"),           # double-bounded standalone token, never inside "ACCOUNT"
    # Subprime auto lenders
    ("CREDIT ACCEPTANCE", "credit acceptance"),
    ("SANTANDER", "santander consumer usa"),
    ("WESTLAKE", "westlake financial"),
    ("EXETER", "exeter finance"),
    ("DRIVETIME", "drivetime"),
    ("CONSUMER PORTFOLIO SERV", "consumer portfolio services"),
    ("AMERICAN CREDIT ACCEPT", "american credit acceptance"),
    ("BYRIDER", "jd byrider"),
    ("TOYOTA", "toyota motor credit"),
    ("NISSAN", "nissan motor acceptance"),
    ("INFINITI FIN", "nissan motor acceptance"),
    ("AMERICAN HONDA", "american honda finance"),
    ("HONDA FIN", "american honda finance"),
    ("GM FINANCIAL", "gm financial"),
    ("GMFNANCIAL", "gm financial"),      # recurring feed typo, 153K cr_tl rows
    ("AMERICREDIT", "gm financial"),
    ("CHRYSLER CAPITAL", "chrysler capital"),
    ("FORD MOTOR CREDIT", "ford motor credit"),
    ("FORD CRED", "ford motor credit"),
    ("FORD MTR", "ford motor credit"),
    ("FORDCREDIT", "ford motor credit"),
    ("HYUNDAI", "hyundai capital"),
    ("KIA MOTOR", "kia finance"),
    ("KIA FIN", "kia finance"),
    ("KIA AMERICA", "kia finance"),
    ("MERCEDES", "mercedes benz financial"),
    (" ALLY", "ally financial"),         # boundary: "ALLY FINCL"/bare "ALLY", never SALLY/RALLY/TALLY/BALLY
    ("/ALLY", "ally financial"),         # OLLO/ALLY, TD BANK N.A./ALLY co-brand forms
    # Installment / payday / subprime cards (UDAP)
    ("ONEMAIN", "onemain financial"),
    ("ONE MAIN", "onemain financial"),
    ("MARINER", "mariner finance"),
    ("LENDMARK", "lendmark financial"),
    ("WORLD FINANCE", "world acceptance"),
    ("WORLD ACCEPTANCE", "world acceptance"),
    ("REGIONAL MANAGE", "regional management"),
    ("REPUBLIC FINANCE", "republic finance"),
    ("HEIGHTS FINANCE", "heights finance"),
    ("SPRINGLEAF", "onemain financial"),
    ("TITLEMAX", "titlemax"),
    ("LOANMAX", "titlemax"),
    ("ADVANCE AMERICA", "advance america"),
    ("SECURITY FINANCE", "security finance"),  # unify w/ 24-char truncation "SECURITY FINANCE CORPORA", 1.09M rows
    ("SPEEDY CASH", "speedy cash"),
    ("ACE CASH", "ace cash express"),
    ("CHECK INTO CASH", "check into cash"),
    ("FIRST CASH", "first cash"),
    # Bank / card furnishers
    ("CAPITAL ONE", "capital one"),
    ("CAPITALONE", "capital one"),       # joined spelling, 440K cr_tl rows
    ("CAP ONE", "capital one"),
    ("COAF", "capital one"),
    ("KOHLS", "capital one"),
    ("SYNCHRONY", "synchrony"),
    ("SYNCB", "synchrony"),
    ("COMENITY", "comenity"),
    ("CREDIT ONE", "credit one bank"),
    ("CREDITONE", "credit one bank"),    # CREDITONEBNK, 161K cr_tl rows
    ("FIRST PREMIER", "first premier bank"),
    ("MERRICK", "merrick bank"),
    ("MISSION LANE", "mission lane"),
    ("MILESTONE", "milestone genesis"),
    ("GENESIS FS", "milestone genesis"),
    ("GENESIS FINANCIAL", "milestone genesis"),
    ("CONCORA", "milestone genesis"),
    ("FORTIVA", "fortiva"),
    ("FINGERHUT", "webbank fingerhut"),  # WEBBANK/FINGERHUT + FINGERHUT/WEBBANK + FRES variants, 1.8M rows
    ("BANK OF THE WEST", "bmo bank"),
    ("BMO", "bmo bank"),
    ("SARASOTA MEM", "sarasota memorial"),
    ("DISCOVER", "discover"),
    ("SYNOVUS", "synovus"),
    ("CITIBANK", "citibank"),
    ("CITICARDS", "citibank"),           # CITICARDS CBNA, 636K cr_tl rows
    ("/CBNA", "citibank"),               # THD/SEARS/BEST BUY/CBNA co-brands (Citibank N.A.), ~1.2M rows
    (" CBNA", "citibank"),               # "BRAND SOURCE/CITI CBNA", bare "CBNA" (265K rows) — Citibank N.A. furnisher code
    ("CITI CB", "citibank"),             # "FORD SERVICES/CITI CBN"-style truncations that cut CBNA mid-word
    (" CITI ", "citibank"),              # double-bounded: bare "CITI" (118K rows) / "CITI CARDS", never "...CITI" truncation tails
    ("WELLS FARGO", "wells fargo"),
    ("WELLSFARGO", "wells fargo"),       # WELLSFARGODEALERSVCS, 180K rows
    ("BANK OF AMERICA", "bank of america"),
    ("BK OF AMER", "bank of america"),   # truncated spelling, 253K rows
    ("JPMORGAN", "chase"),
    ("JP MORGAN", "chase"),
    ("JPMCB", "chase"),                  # JPMorgan Chase Bank card tradelines, 1.02M rows
    ("JPMCHASE", "chase"),               # CES/JPMCHASE
    (" CHASE", "chase"),                 # boundary: never "AUTO CREDIT PURCHASE CEN"-style PURCHASE hits
    ("/CHASE", "chase"),                 # AES/CHASE BANK co-brand forms
    ("AMERICAN EXPRESS", "american express"),
    ("AMEX", "american express"),
    # Student loan servicers
    ("NAVIENT", "navient"),
    ("SALLIE MAE", "sallie mae"),
    ("GREAT LAKES", "great lakes"),
    ("FEDLOAN", "fedloan"),
    ("FED LOAN", "fedloan"),             # FED LOAN SERV, 651K rows
    ("/NELN", "nelnet"),                 # DEPT OF EDUCATION/NELN truncation, 720K rows
    ("MOHELA", "mohela"),
    ("NELNET", "nelnet"),
    ("GLELSI", "great lakes"),           # Great Lakes Educational Loan Services Inc, 604K rows; AFTER NELNET so "GLELSI/NELNET" keeps nelnet
    ("AIDVANTAGE", "aidvantage"),
    ("EDFINANCIAL", "edfinancial"),
    ("PHEAA", "pheaa"),
    # Mortgage servicers (RESPA)
    ("OCWEN", "ocwen"),
    ("PHH MORTGAGE", "phh mortgage"),
    ("NATIONSTAR", "mr cooper"),
    ("MR. COOPER", "mr cooper"),
    ("MR COOPER", "mr cooper"),
    ("DITECH", "ditech"),
    ("GREEN TREE", "ditech"),
    ("GREENTREE", "ditech"),
    ("CALIBER HOME", "caliber home loans"),
    ("SHELLPOINT", "shellpoint"),
    ("NEWREZ", "newrez"),
    ("SPECIALIZED LOAN", "specialized loan servicing"),
    ("CENLAR", "cenlar"),
    ("SELECT PORTFOLIO", "select portfolio servicing"),
    ("RUSHMORE", "rushmore"),
    ("ROUNDPOINT", "roundpoint"),
]

_SUFFIX_RE = re.compile(r"\b(INC|LLC|CORP|CORPORATION|CO|LTD|LP|LLP|PLLC|PC|N\s*A|SVC|SVCS)\b")
_NONALNUM_RE = re.compile(r"[^A-Z0-9 ]")
_WS_RE = re.compile(r"\s+")


def norm_def(s):
    up = str(s or "").upper()
    up = re.sub(r"[.,'\"]", " ", up).replace("&", " ")
    up = _SUFFIX_RE.sub(" ", up)
    up = _NONALNUM_RE.sub(" ", up)
    return _WS_RE.sub(" ", up).strip()


def canonical_token(name):
    """Alias families first, then the mild suffix-stripped fallback.

    Matching is done against the raw uppercase string PADDED with one space on
    each side, so needles may anchor on a word boundary: a trailing-space
    needle ("ERC ", "CITI ", "CCO ") matches both "ERC COLLECTIONS" and the
    bare string "ERC", while a leading-space needle (" ALLY") matches
    "ALLY FINCL" / bare "ALLY" but not "BALLY TOTAL FITNESS". Inner needles
    are unaffected."""
    if not name:
        return ""
    up = " " + str(name).upper() + " "
    for needle, token in ALIASES:
        if needle in up:
            return token
    return norm_def(name).lower()
