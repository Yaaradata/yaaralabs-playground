"""Builds the AI Agent reference data (app/data/ai_agent/) from NSE's own files.

Download into RAW_DIR first:
  EQUITY_L.csv            https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv   (NSE equity list with ISINs)
  holidays_trading.json   https://www.nseindia.com/api/holiday-master?type=trading         (needs NSE site cookies)
  holidays_clearing.json  https://www.nseindia.com/api/holiday-master?type=clearing        (settlement holidays)
  (page: https://www.nseindia.com/resources/exchange-communication-holidays)

Writes:
  nse_equity_list.csv     symbol,company,series,listed_on,face_value,isin   (every row's ISIN check digit verified)
  nse_holidays_2026.json  capital-market trading holidays and settlement (clearing) holidays, weekdays only

usage (from backend/): python scripts/build_agent_data.py RAW_DIR
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.agent_tools import validate_isin  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "ai_agent"


def holidays(path: Path, year: int) -> list:
    rows = json.loads(path.read_text(encoding="utf-8")).get("CM", [])
    out = []
    for r in rows:
        d = datetime.strptime(r["tradingDate"], "%d-%b-%Y").date()
        if d.year == year and d.weekday() < 5:  # weekend holidays change nothing
            out.append({"date": d.isoformat(), "day": d.strftime("%A"), "name": " ".join(r["description"].replace("*", "").split())})
    return sorted(out, key=lambda h: h["date"])


def main(raw: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows, bad = [], []
    with (raw / "EQUITY_L.csv").open(encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip(): (v or "").strip() for k, v in r.items()}
            isin = r["ISIN NUMBER"].upper()
            if not validate_isin(isin)["valid"]:
                bad.append(isin)
            listed = datetime.strptime(r["DATE OF LISTING"], "%d-%b-%Y").date().isoformat() if r["DATE OF LISTING"] else ""
            rows.append([r["SYMBOL"], r["NAME OF COMPANY"], r["SERIES"], listed, r["FACE VALUE"], isin])
    with (OUT / "nse_equity_list.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["symbol", "company", "series", "listed_on", "face_value", "isin"])
        w.writerows(sorted(rows, key=lambda r: r[0]))
    print(f"nse_equity_list.csv: {len(rows)} companies; ISINs failing the check digit: {len(bad)} {bad[:5]}")

    trading = holidays(raw / "holidays_trading.json", 2026)
    clearing = holidays(raw / "holidays_clearing.json", 2026)
    t_dates = {h["date"] for h in trading}
    doc = {
        "year": 2026,
        "source": "https://www.nseindia.com/resources/exchange-communication-holidays",
        "fetched": date.today().isoformat(),
        "note": "Capital-market (CM) segment, weekdays only. Trading holidays: no trading. Settlement holidays: the clearing "
                "corporation does not settle (bank holidays), so a T+1 trade the day before settles one business day later.",
        "trading": trading,
        "settlement": clearing,
        "settlementOnly": [h for h in clearing if h["date"] not in t_dates],
    }
    (OUT / "nse_holidays_2026.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"nse_holidays_2026.json: {len(trading)} trading, {len(clearing)} settlement, settlement-only {[h['date'] for h in doc['settlementOnly']]}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
