from datetime import date, timedelta

# NSE capital-market TRADING holidays in 2026 that fall on a weekday (NSE circular NSE/CMTR/71775 and NSE/CMTR/72260)
HOLIDAYS = {
    "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31", "2026-04-03",
    "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02",
    "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
}


def settlement_date(trade_date: str, t_plus: int = 1) -> dict:
    """Settlement date for an NSE trade, skipping weekends and 2026 NSE trading holidays.

    Args:
        trade_date: Trade date as YYYY-MM-DD.
        t_plus: Business days to settlement, 1 for T+1.
    """
    d = date.fromisoformat(trade_date)
    skipped = []
    n = 0
    while n < t_plus:
        d += timedelta(days=1)
        if d.weekday() >= 5:          # Saturday or Sunday
            continue
        if d.isoformat() in HOLIDAYS:  # exchange holiday
            skipped.append(d.isoformat())
            continue
        n += 1
    return {"trade_date": trade_date, "t_plus": t_plus, "settlement_date": d.isoformat(),
            "weekday": d.strftime("%A"), "holidays_skipped": skipped}
