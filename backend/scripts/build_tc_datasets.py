"""Builds the Text Classification packs (Day 1, Ex 2) in app/data/text_classification/.

Every file is id,text,label. Real packs come from public data; the two custody packs are generated.

  cfpb_complaint_routing.csv     Payments & transfers vs Accounts & statements   CFPB complaints (public domain)
  banking77_payment_vs_kyc.csv   Payment status vs Identity & KYC                BANKING77 (CC BY 4.0)
  cfpb_prepaid_vs_bank.csv       Prepaid card vs Bank account                    CFPB complaints (public domain)
  fin_news_bearish_bullish.csv   Bearish vs Bullish                              Twitter Financial News Sentiment (MIT)
  custody_breaks.csv             Self-clears vs Investigate                      synthetic, custody wording
  custody_client_emails.csv      Routine vs Escalate                             synthetic, custody wording

Raw inputs (download into RAW_DIR first; see README section in the docstring of each loader):
  cfpb_sample_complaints.csv.gz  https://raw.githubusercontent.com/nishanttyagi28/crm-ticket-intelligence/HEAD/data/sample_complaints.csv.gz
                                 (CFPB Consumer Complaint Database, Jan-Mar 2024, narratives >= 40 chars)
  banking77_train.csv, banking77_test.csv
                                 https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/{train,test}.csv
  fin_news_train.csv, fin_news_valid.csv
                                 https://huggingface.co/datasets/zeroshot/twitter-financial-news-sentiment/resolve/main/sent_{train,valid}.csv

usage (from backend/): python scripts/build_tc_datasets.py RAW_DIR
Seeded: running it again writes the same files.
"""

from __future__ import annotations

import random
import re
import sys
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "text_classification"
SEED = 2026


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def write(name: str, rows: list[tuple[str, str]]) -> None:
    rnd = random.Random(SEED)
    rnd.shuffle(rows)
    df = pd.DataFrame(rows, columns=["text", "label"])
    df.insert(0, "id", range(1, len(df) + 1))
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / name, index=False, encoding="utf-8")
    counts = df["label"].value_counts().to_dict()
    print(f"{name}: {len(df)} rows {counts}")


def dedupe(texts) -> list[str]:
    seen, out = set(), []
    for t in texts:
        t = norm(t)
        k = t.lower()
        if len(t) >= 40 and k not in seen:
            seen.add(k)
            out.append(t)
    return out


# ── CFPB ─────────────────────────────────────────────

def build_cfpb(raw: Path) -> None:
    df = pd.read_csv(raw / "cfpb_sample_complaints.csv.gz", compression="gzip", low_memory=False)
    by_product = lambda p: dedupe(df.loc[df["product"] == p].sort_values("complaint_id")["narrative"])
    transfers = by_product("Money transfer, virtual currency, or money service")
    accounts = by_product("Checking or savings account")
    prepaid = by_product("Prepaid card")
    rnd = random.Random(SEED)
    rnd.shuffle(accounts)

    # Complaint routing: every transfer complaint, and the same number of account complaints
    n = len(transfers)
    routing_accounts = accounts[: n + 3]
    write("cfpb_complaint_routing.csv",
          [(t, "Payments & transfers") for t in transfers] + [(t, "Accounts & statements") for t in routing_accounts])

    # Prepaid vs bank account: every prepaid complaint, and as many bank-account ones not used above
    rest = [t for t in accounts[n + 3:]]
    write("cfpb_prepaid_vs_bank.csv",
          [(t, "Prepaid card") for t in prepaid] + [(t, "Bank account") for t in rest[: len(prepaid) + 1]])


# ── BANKING77 ────────────────────────────────────────

PAYMENT_STATUS = ["pending_transfer", "transfer_not_received_by_recipient", "balance_not_updated_after_bank_transfer",
                  "transfer_timing", "declined_transfer", "failed_transfer"]
IDENTITY_KYC = ["verify_my_identity", "why_verify_identity", "unable_to_verify_identity", "verify_source_of_funds"]


def build_banking77(raw: Path) -> None:
    b = pd.concat([pd.read_csv(raw / "banking77_train.csv"), pd.read_csv(raw / "banking77_test.csv")])
    rows = [(norm(t), "Payment status") for t, c in zip(b["text"], b["category"]) if c in PAYMENT_STATUS]
    rows += [(norm(t), "Identity & KYC") for t, c in zip(b["text"], b["category"]) if c in IDENTITY_KYC]
    write("banking77_payment_vs_kyc.csv", rows)


# ── Finance headlines ────────────────────────────────

def build_fin_news(raw: Path) -> None:
    f = pd.concat([pd.read_csv(raw / "fin_news_train.csv"), pd.read_csv(raw / "fin_news_valid.csv")])
    seen, rows = set(), []
    for t, lab in zip(f["text"], f["label"]):
        if lab == 2:
            continue
        t = norm(t)
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        rows.append((t, "Bearish" if lab == 0 else "Bullish"))
    write("fin_news_bearish_bullish.csv", rows)


# ── Synthetic custody packs ──────────────────────────

SECURITIES = ["Infosys", "TCS", "HDFC Bank", "ICICI Bank", "Reliance", "L&T", "ITC", "Wipro", "Axis Bank", "Kotak Bank",
              "Bharti Airtel", "Asian Paints", "Maruti", "Sun Pharma", "Titan", "UltraTech", "Nestle India", "HUL",
              "Bajaj Finance", "Tata Steel", "NTPC", "Power Grid", "ONGC", "Coal India", "HCL Tech", "Cipla", "SBI",
              "Tata Motors", "M&M", "Pidilite", "Dabur", "Havells", "Siemens", "Bosch", "Marico", "Britannia"]
CLIENTS = ["Aster Pension Trust", "Kaveri Growth Fund", "Nilgiri Family Office", "Coromandel Insurance", "Sahyadri PMS",
           "Vindhya Capital", "Narmada Provident Fund", "Godavari AIF", "Malabar Wealth", "Konkan Endowment",
           "Thar Opportunities Fund", "Deccan Balanced Fund", "Aravalli Trust", "Shivalik Partners", "Doon Alpha Fund"]
BROKERS = ["Brokerage A", "Brokerage B", "Brokerage C", "Clearing member D", "Clearing member E"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def isin(r):
    return "INE" + "".join(r.choice("0123456789ABCDEFGH") for _ in range(6)) + "01" + str(r.randint(0, 9))


def amount(r):
    return f"INR {r.randint(1, 99)},{r.randint(10, 99)},{r.randint(100, 999)}"


def breaks_row(r, kind: str) -> str:
    """Reconciliation break descriptions. Self-clears: timing, the other side will catch up.
    Investigate: a real difference someone must chase."""
    s, acct, d = r.choice(SECURITIES), f"{r.randint(1000, 9999)}", f"{r.randint(1, 28):02d}-{r.choice(MONTHS)}"
    qty = f"{r.randint(1, 90) * 100:,}"
    base = r.choice([f"Account {acct}", f"Client {r.choice(CLIENTS)}", f"DP ID IN30{r.randint(1000, 9999)}{r.randint(1000, 9999)}"])
    if kind == "Self-clears":
        reason = r.choice([
            f"trade dated {d} settles T+1; depository position will update after pay-out",
            f"{s} dividend booked by registrar today, custody ledger posts next business day",
            "cash credit received after the bank statement cut-off; appears in tomorrow's statement",
            f"FX rate snapshot taken before the NOSTRO credit of {amount(r)}; revaluation runs overnight",
            "bonus shares allotted, demat credit expected on the deemed allotment date",
            "counterparty confirmation received, settlement instructed and pending matching window",
            "split adjustment applied by NSDL, our books update in the next end-of-day batch",
            f"pay-in of {amount(r)} received from {r.choice(BROKERS)} after 4 pm, value date tomorrow",
            "standing instruction executed late in the day; position will align on next reconciliation",
            "interest accrual posted at month end; statement generated before posting",
        ])
        tail = r.choice(["Expected to clear automatically.", "No action needed.", "Monitor tomorrow.", "Timing difference only.", ""])
    else:
        reason = r.choice([
            f"quantity mismatch of {qty} shares of {s} between custody books and depository holding",
            f"trade booked twice for {s}; duplicate buy of {qty} shares not in broker contract note",
            f"ISIN {isin(r)} on the instruction does not match the {s} trade confirmation",
            f"short delivery of {qty} shares of {s} from {r.choice(BROKERS)}; auction risk",
            f"cash difference of {amount(r)} with no matching trade or corporate action",
            f"SSI changed by client but settlement went to the old account for {amount(r)}",
            f"rights entitlement for {s} missing from client holding after the record date",
            f"failed settlement on {d}; counterparty disputes the price for {qty} {s} shares",
            "client reports a debit that has no instruction on file",
            f"unmatched receipt of {qty} {s} shares from an unknown counterparty",
        ])
        tail = r.choice(["Needs investigation.", "Raise with operations.", "Open for 3 days.", "Escalated to supervisor.", ""])
    return norm(f"{base}: {reason}. {tail}")


def emails_row(r, kind: str) -> str:
    s, client, m = r.choice(SECURITIES), r.choice(CLIENTS), r.choice(MONTHS)
    greet = r.choice(["Dear team,", "Hello,", "Hi,", "Good morning,", ""])
    if kind == "Routine":
        body = r.choice([
            f"please share the {m} holding statement for our records.",
            f"could you confirm the record date for the {s} dividend?",
            f"kindly send the TDS certificate for the {s} dividend when ready.",
            f"we would like a copy of the {m} custody fee invoice.",
            f"please update us on the timeline for the {s} bonus credit.",
            "could you resend last week's contract notes? Our copy is unreadable.",
            f"please confirm receipt of our instruction for the {s} buyback tender.",
            "we need the transaction statement for Q2 in Excel, not PDF.",
            f"what is the cut-off time for {m} month-end reporting?",
            "please add our new analyst to the reporting distribution list.",
        ])
        tail = r.choice(["Thank you.", "No rush.", "Regards,", "Many thanks.", "Appreciate your help."])
    else:
        body = r.choice([
            f"the {s} dividend has still not been credited and our auditors sign off tomorrow.",
            f"your team missed our {s} buyback tender. We want to speak to your head of operations.",
            f"this is the third failed settlement this month for {s}. This is unacceptable.",
            "someone emailed asking us to change our bank details. Was that really from you?",
            f"the {m} statement shows a debit of {amount(r)} we never authorised.",
            "fix this today or we move custodians.",
            f"our {s} rights entitlement is missing and the regulator has asked for an explanation.",
            "the fee you charged for the failed trade is unfair and our board is reviewing the mandate.",
            f"we have written four times about the {s} short delivery with no reply. Escalate now.",
            "money is stuck for nine days and the pension payout to members is held up.",
        ])
        tail = r.choice(["Urgent.", "Please call me right away.", "Awaiting your reply today.", "Regards,", ""])
    return norm(f"{greet} {body[0].upper() + body[1:]} {tail} - {client}")


def build_synthetic(n: int = 40000, noise: float = 0.025) -> None:
    for name, fn, classes, seed in [
        ("custody_breaks.csv", breaks_row, ["Self-clears", "Investigate"], SEED + 1),
        ("custody_client_emails.csv", emails_row, ["Routine", "Escalate"], SEED + 2),
    ]:
        r = random.Random(seed)
        rows = []
        for i in range(n):
            kind = classes[i % 2]
            label = kind if r.random() >= noise else classes[1 - classes.index(kind)]  # a few mislabelled rows, like real data
            rows.append((fn(r, kind), label))
        write(name, rows)


if __name__ == "__main__":
    raw = Path(sys.argv[1])
    build_cfpb(raw)
    build_banking77(raw)
    build_fin_news(raw)
    build_synthetic()
