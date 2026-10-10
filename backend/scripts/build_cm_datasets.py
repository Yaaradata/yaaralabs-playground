"""Builds the Exercise 3 teaching datasets in app/data/confusion_matrix/:

  client_emails.csv   custody client emails       Escalate  vs Routine
  it_tickets.csv      IT service desk tickets     Incident  vs Request
  feedback.csv        customer feedback messages  Complaint vs Feedback

Synthetic (fictional clients and people), written so that EVERY Exercise 3 setting changes the
confusion matrix in a way a learner can see and explain:

  threshold      about a third are the class we care about, plus a band of genuinely borderline
                 items, so scores are spread out and moving the line trades Missed for False alarms
  flexibility C  the classes are imbalanced: a very simple model falls back to "everything is the
                 bigger class" (nothing caught); more flexibility catches more
  what it reads  both classes use the same words in a different order ("now urgent ... not
                 arrived" vs "not urgent ... now arrived"): single words cannot separate them,
                 two-word phrases can
  vocabulary     the reason an item matters is written many different ways, each rare, so a small
                 vocabulary drops them
  iterations     the solver needs a few dozen steps; 3, 5 and 10 stop before it settles
  test split     large datasets, so 10% / 20% / 30% give visibly different counts

Seeded: running it again writes the same files. Check with scripts/check_cm_datasets.py.
Run from backend/:
    python scripts/build_cm_datasets.py
"""

from __future__ import annotations

import csv
import random
from pathlib import Path
from typing import Callable, Dict, List

OUT_DIR = Path(__file__).resolve().parents[1] / "app" / "data" / "confusion_matrix"
N = 1600
TARGET_SHARE = 0.33
BORDERLINE_SHARE = 0.12  # real problems said mildly: reviewers labelled them either way
NOISE = 0.03  # labels a reviewer got wrong

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
NAMES = ["Priya", "Rahul", "Anita", "Vikram", "Meera", "Arjun", "Kavya", "Sanjay", "Lakshmi", "Rohan", "Neha", "Imran"]
CITIES = ["Mumbai", "Chennai", "Bengaluru", "Delhi", "Kolkata", "Pune", "Hyderabad", "Ahmedabad", "Kochi", "Jaipur"]
SECURITIES = [
    "Infosys", "TCS", "HDFC Bank", "ICICI Bank", "Reliance", "L&T", "ITC", "Wipro", "Axis Bank", "Kotak Bank",
    "Bharti Airtel", "Asian Paints", "Maruti", "Sun Pharma", "Titan", "UltraTech", "Nestle India", "HUL",
    "Bajaj Finance", "Tata Steel", "JSW Steel", "NTPC", "Power Grid", "ONGC", "Coal India", "Hindalco",
    "Tech Mahindra", "HCL Tech", "Dr Reddy's", "Cipla", "Divi's Labs", "Britannia", "Eicher Motors",
    "Hero MotoCorp", "Grasim", "Adani Ports", "SBI", "IndusInd Bank", "Tata Motors", "M&M", "Pidilite",
    "Dabur", "Havells", "Siemens", "ABB India", "Bosch", "Godrej Consumer", "Marico", "Colgate", "Page Industries",
]
SOFTWARE = ["Excel", "Power BI", "Python", "Zoom", "Adobe Reader", "a PDF editor", "Tableau", "VS Code", "WinSCP", "Notepad++"]


def cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


class Pack:
    """One dataset. Swaps hold "{a}" (live word in the class we care about) and "{b}" (calm word);
    the other class gets them the other way round, so both classes use exactly the same words:
        "This is now urgent; X has not arrived."  vs  "This is not urgent; X has now arrived."
    """

    def __init__(self, file: str, target: str, other: str, seed: int, *, topic: Callable[[random.Random], str],
                 context: Callable[[random.Random], str], signer: Callable[[random.Random], str], swaps: List[str],
                 problems: List[str], pressure: List[str], asks: List[str], mild: List[str], greetings: List[str],
                 closers: List[str]):
        self.file, self.target, self.other, self.seed = file, target, other, seed
        self.topic, self.context, self.signer = topic, context, signer
        self.swaps, self.problems, self.pressure, self.asks = swaps, problems, pressure, asks
        self.mild, self.greetings, self.closers = mild, greetings, closers

    def swap(self, r: random.Random, live: bool) -> str:
        a, b = ("now", "not") if live else ("not", "now")
        return cap(r.choice(self.swaps).format(a=a, b=b, t=self.topic(r)))

    def problem(self, r: random.Random) -> str:
        return r.choice(self.problems).format(t=self.topic(r))

    def ask(self, r: random.Random) -> str:
        return cap(r.choice(self.asks).format(t=self.topic(r), sw=r.choice(SOFTWARE)))

    def assemble(self, r: random.Random, parts: List[str]) -> str:
        parts = [p for p in parts if p]
        if r.random() < 0.3:
            parts.insert(0, r.choice(self.greetings))
        c = self.context(r)
        if c:
            parts.insert(r.randint(0, len(parts)), c)
        if r.random() < 0.6:
            parts.append(r.choice(self.closers))
        return " ".join([p for p in parts if p] + [f"- {self.signer(r)}"])

    def live(self, r: random.Random) -> str:
        """The swapped phrasing, or a stated consequence written one of many rare ways."""
        if r.random() < 0.55:
            core = [self.swap(r, True)]
        else:
            p = cap(r.choice(self.pressure)) + "."
            core = [cap(self.problem(r)) + ".", p] if r.random() < 0.5 else [p, self.ask(r)]
        return self.assemble(r, core + [self.ask(r) if r.random() < 0.3 else ""])

    def calm(self, r: random.Random) -> str:
        x = r.random()
        if x < 0.6:
            core = [self.swap(r, False), self.ask(r) if r.random() < 0.5 else ""]
        elif x < 0.8:
            core = [self.ask(r), f"Earlier {self.problem(r)}, but that is sorted." if r.random() < 0.5 else ""]
        else:
            core = [self.ask(r)]
        return self.assemble(r, core)

    def borderline(self, r: random.Random) -> str:
        return self.assemble(r, [cap(r.choice(self.mild).format(p=self.problem(r)))])

    def build(self) -> None:
        r = random.Random(self.seed)
        n_border = int(N * BORDERLINE_SHARE)
        n_live = int(N * TARGET_SHARE) - n_border // 2
        plan = ["t"] * n_live + ["b"] * n_border + ["o"] * (N - n_live - n_border)
        r.shuffle(plan)
        rows, seen = [], set()
        for kind in plan:
            for _ in range(50):  # no exact duplicates
                text = self.live(r) if kind == "t" else self.calm(r) if kind == "o" else self.borderline(r)
                if text not in seen:
                    break
            seen.add(text)
            label = self.target if kind == "t" else self.other if kind == "o" else r.choice([self.target, self.other])
            if r.random() < NOISE:
                label = self.other if label == self.target else self.target
            rows.append((text, label))
        path = OUT_DIR / self.file
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["text", "label"])
            w.writerows(rows)
        n_t = sum(1 for _, l in rows if l == self.target)
        print(f"Wrote {len(rows)} rows to {path.name} ({n_t} {self.target}, {len(rows) - n_t} {self.other})")


# ── Client emails: does this need a senior person now? ─────────

CLIENTS = [
    "Aster Pension Trust", "Kaveri Growth Fund", "Nilgiri Family Office", "Coromandel Insurance", "Sahyadri PMS",
    "Vindhya Capital", "Narmada Provident Fund", "Godavari AIF", "Malabar Wealth", "Konkan Endowment",
    "Thar Opportunities Fund", "Brahmaputra Holdings", "Deccan Balanced Fund", "Aravalli Trust", "Shivalik Partners",
    "Kaziranga Investments", "Chilika Superannuation", "Palk Bay Fund", "Satpura Advisors", "Doon Alpha Fund",
]
SCHEMES = ["equity scheme", "debt scheme", "hybrid scheme", "index scheme", "liquid scheme", "PMS book", "AIF Category II book",
           "NRI portfolio", "treasury book", "FPI account", "family trust account", "pension corpus"]


def email_topic(r: random.Random) -> str:
    s, m = r.choice(SECURITIES), r.choice(MONTHS)
    return r.choice([
        f"the {s} dividend", f"the {s} dividend credit", f"the {s} buyback tender", f"our {s} rights entitlement",
        f"the {s} bonus shares", f"our {s} purchase settlement", f"the {s} sale proceeds", f"the {m} holding statement",
        f"the {m} custody statement", f"the TDS certificate for {s}", f"the {m} custody fee invoice",
        f"the proxy vote for the {s} AGM", f"the corporate action notice for {s}", f"the {s} split adjustment",
        f"the KYC update for our new signatory", f"the {m} transaction report",
    ])


def email_context(r: random.Random) -> str:
    return r.choice([
        f"Account {r.randint(10000, 99999)} under our {r.choice(SCHEMES)}.",
        f"This is for the {r.choice(SCHEMES)} serviced from your {r.choice(CITIES)} desk.",
        f"Reference {r.choice('ABCDEFGHJK')}{r.randint(100, 999)}/{r.choice(MONTHS)[:3]}.",
        f"Our {r.choice(SCHEMES)} holds {r.randint(2, 90)},{r.randint(100, 999)} shares of {r.choice(SECURITIES)}.",
        f"Copying {r.choice(NAMES)} from our {r.choice(['operations', 'finance', 'investment', 'accounts', 'treasury'])} team.",
        f"As discussed with {r.choice(NAMES)} at your {r.choice(CITIES)} office.",
        "",
    ])


CLIENT_EMAILS = Pack(
    "client_emails.csv", "Escalate", "Routine", 2026,
    topic=email_topic, context=email_context, signer=lambda r: r.choice(CLIENTS),
    swaps=[
        "this is {a} urgent; {t} has {b} arrived.",
        "{t} has {b} settled and it is {a} overdue.",
        "{t} is {b} credited and the matter is {a} serious.",
        "we have {b} received {t} and we are {a} escalating.",
        "{t} is {b} corrected and this is {a} a complaint.",
        "{t} was {b} fixed and it is {a} critical.",
        "the team has {b} replied about {t}, so it is {a} a priority.",
        "{t} is {a} delayed and {b} confirmed.",
        "{t} is {a} on hold and {b} released.",
        "{t} is {a} disputed and {b} reconciled.",
    ],
    problems=[
        "{t} has still not been credited", "{t} is missing from our account", "{t} failed and nobody informed us",
        "we have not received {t} despite reminders", "{t} was processed wrongly", "{t} is short by a few lakh",
        "{t} has been delayed again", "{t} shows the wrong quantity",
    ],
    pressure=[
        "our auditors sign off tomorrow", "the board meets on Monday", "the regulator has asked us for an explanation",
        "our investors are calling us", "we are reviewing whether to move our mandate", "this is the third time this quarter",
        "we will raise this with your senior management", "the fund cannot strike its NAV", "we were assured this was fixed last week",
        "please treat this as a formal complaint", "we need an answer today", "trustees want a written explanation",
        "our compliance head is copied", "the redemption payout depends on it", "we have already missed one deadline",
        "the record date passed yesterday", "our quarter close is blocked", "interest is accruing against us",
        "the beneficiary is threatening legal action", "our relationship manager has not responded for a week",
        "the investment committee has flagged it", "we cannot report to SEBI on time", "penalty charges will apply from Friday",
        "the client has written to our chairman", "nobody picks up the helpdesk line", "four emails have gone unanswered",
        "the cut-off is at three today", "our risk team has frozen further trades", "the overdraft was triggered because of this",
        "the mismatch is now in our audited accounts", "our insurer needs the figures tonight", "the pension payout to members is held up",
        "this breaches the agreed service levels", "our custodian review is next week and this will be noted",
        "we escalated on the call and still nothing", "your team promised a callback that never came",
        "the shortfall has been reported to our CFO", "the scheme's unitholders are affected", "the tender window closes tomorrow",
        "the settlement will fail again tonight", "the rating agency is asking questions", "our MD wants a call within the hour",
        "money is stuck for nine days now", "the error has repeated across two accounts", "the external auditors raised a query",
        "the fund's year-end freeze starts Thursday", "we may have to restate the statement", "the trustee meeting is this evening",
        "the margin call depends on this credit", "we are losing confidence in the service",
        "our ombudsman filing is being drafted", "the actuary cannot finalise the valuation", "the custodian fee will be withheld",
        "the distributor network is hearing about it", "our chief investment officer is furious", "the NAV published was incorrect",
        "the unclaimed amount will lapse", "the lender has issued a default notice", "our global parent has asked for a report",
        "the foreign investor's repatriation is stuck", "the stamp duty deadline lapses tonight", "the tax filing will be late",
        "the dividend should have reached unitholders on Tuesday", "our annual report goes to print tomorrow",
        "an investor complaint has been lodged on SCORES", "the depository has sent us a notice", "the AMC board is asking for a root cause",
        "the stock exchange needs our disclosure", "we have had to borrow overnight to cover it",
        "your service manager's mobile is switched off", "the error is costing us daily interest", "we have lost a client because of this",
        "the press have started asking", "the pledge release is overdue", "the margin shortfall attracted a penalty",
        "the wrong credit went to another client", "our sanctions screening is held up", "the escrow release missed its date",
        "the treasury cannot place funds", "your earlier fix created a second error", "this has gone on since last month",
        "the trustees will review your contract", "the court order deadline is Monday", "the investor helpline is flooded",
        "the year-end audit trail is broken", "our board has asked for compensation", "the overseas auditor has qualified our report",
    ],
    asks=[
        "please share {t} for our records.", "could you confirm the timeline for {t}?", "kindly send {t} when ready.",
        "we would like a copy of {t}.", "can you check the status of {t}?", "please update us on {t}.",
        "could you resend {t}?", "please confirm receipt of our instruction for {t}.",
    ],
    mild=["second reminder: {p}.", "just checking, {p}.", "gentle follow-up, {p}.", "it seems {p}. Could you look into it?",
          "we noticed {p}. Please check."],
    greetings=["Dear team,", "Hello,", "Good morning,", "Hi,"],
    closers=["Thanks.", "Thank you.", "Regards,", "Many thanks.", "Please revert.", "Awaiting your reply."],
)


# ── IT service desk: a live incident for the on-call team, or a normal request? ─────────

SYSTEMS = ["the trading terminal", "the order management system", "the back-office ledger", "the VPN", "Outlook",
           "the client portal", "the payments gateway", "the CRM", "the risk dashboard", "the settlement batch",
           "the market data feed", "the HR portal", "the shared drive", "the Bloomberg terminal", "the mobile app",
           "the KYC portal", "the NAV engine", "the reconciliation job", "the depository SFTP link", "the dealer voice line",
           "the margin system", "the branch billing screen", "the Teams meeting rooms", "the expense tool"]
DEPTS = ["Equity Dealing", "Custody Ops", "Wealth Desk", "Finance", "Compliance", "Treasury", "HR", "Risk", "Fund Accounting",
         "Retail Broking", "Client Service", "Settlements"]

IT_TICKETS = Pack(
    "it_tickets.csv", "Incident", "Request", 4711,
    topic=lambda r: r.choice(SYSTEMS),
    context=lambda r: r.choice([
        f"Laptop asset YL-{r.randint(1000, 9999)}.", f"Floor {r.randint(2, 14)}, {r.choice(CITIES)} office.",
        f"Raised by {r.choice(NAMES)} from {r.choice(DEPTS)}.", f"Ticket ref INC{r.randint(100000, 999999)}.",
        f"Windows {r.choice(['10', '11'])}, {r.choice(['Chrome', 'Edge'])} browser.", f"Extension {r.randint(2000, 7999)}.", "",
    ]),
    signer=lambda r: f"{r.choice(NAMES)}, {r.choice(DEPTS)}",
    swaps=[
        "{t} is {a} down and {b} restored.",
        "{t} is {a} failing and {b} fixed.",
        "{t} is {a} timing out and {b} responding.",
        "users are {a} blocked and {b} able to log in to {t}.",
        "the errors on {t} are {a} critical and {b} under control.",
        "the issue with {t} is {a} urgent and {b} resolved.",
        "{t} has {b} recovered and the impact is {a} growing.",
        "{t} is {a} disconnecting and {b} stable.",
        "the queue on {t} is {a} stuck and {b} clearing.",
        "the fault on {t} is {a} spreading and {b} contained.",
    ],
    problems=["{t} is throwing errors", "{t} crashed", "{t} is very slow", "{t} will not load", "{t} returns a server error",
              "{t} keeps disconnecting", "{t} shows yesterday's data", "{t} logged everyone out"],
    pressure=[
        "the dealing desk cannot place orders", "the market opens in ten minutes", "clients are calling the dealers",
        "the regulator report is due at five", "settlement cut-off is in an hour", "two hundred users are affected",
        "the CEO's client demo starts at noon", "we are losing trades", "the branch network is offline",
        "the auditors are on site today", "payments are piling up in the queue", "the whole floor is affected",
        "margin calls cannot be sent", "the exchange connectivity test failed", "orders are stuck in pending",
        "NAV publication is blocked", "the depository file will miss its window", "the call centre cannot see client records",
        "funds cannot be released to clients", "the risk limits are not updating", "positions are showing zero",
        "the overnight batch has not finished", "the disaster recovery site is not taking over", "client logins fail across India",
        "the payment file was sent twice", "duplicate orders went to the exchange", "prices are frozen on every screen",
        "the trading day cannot start", "the branch tills cannot print receipts", "the compliance surveillance feed stopped",
        "the client app has one-star reviews coming in", "the dealer voice recording is off, which is a regulatory breach",
        "KYC uploads are failing for new clients", "the settlement team is working on paper", "the firewall alert is flashing red",
        "the mailbox for client instructions is not receiving", "a ransomware warning popped up on two machines",
        "the market data vendor says the issue is on our side", "the morning reconciliation shows breaks everywhere",
        "the operations head is asking for an ETA", "the nightly backup failed for three days", "the SEBI audit is tomorrow",
        "the IPO bidding window closes in an hour", "the mutual fund cut-off is at three", "the corporate action file is wrong",
        "users are sharing passwords to get work done", "the treasury desk cannot see bank balances", "the trade blotter is empty",
        "the trading app crashed during market hours", "the incident bridge has been open for an hour",
        "the switchboard is down for the whole building", "the leased line to the exchange dropped",
        "client statements went to the wrong addresses", "the OTP SMS is not reaching clients", "every report shows a timeout",
        "the payroll file must reach the bank today", "the printer queue jammed the cheque run", "we had to stop the batch midway",
        "the second data centre is also failing", "management wants a root cause by evening",
    ],
    asks=[
        "please install {sw} on my laptop.", "request access to {t}.", "please reset my password for {t}.",
        "can we get a second monitor for the new joiner?", "please add the new analyst to {t}.", "kindly share the user guide for {t}.",
        "need a licence for {sw}.", "please move my desk phone to floor 9.", "can you update my email signature?",
        "please create a shared folder for the audit team.", "request a training session on {t}.",
        "please enable USB access for the presentation laptop.",
    ],
    mild=["{p} for some users, not sure if it is our side.", "since this morning {p}, not blocking yet.",
          "occasionally {p}. Please check when possible.", "a colleague says {p}. Can someone look?"],
    greetings=["Hi team,", "Hello,", "Hi IT,", "Good morning,"],
    closers=["Thanks.", "Thank you.", "Regards,", "Please help.", "Please check."],
)


# ── Customer feedback: a complaint we must act on, or general feedback? ─────────

FEATURES = ["app login", "SIP order", "mutual fund redemption", "IPO application", "brokerage bill", "contract note",
            "demat transfer", "fund transfer to my bank", "margin statement", "portfolio page", "two-factor OTP",
            "nominee update", "dividend payout", "tax P&L report", "stop-loss order", "chart screen", "watchlist",
            "fixed deposit booking", "insurance renewal", "statement download", "bond order", "PMS report"]

FEEDBACK = Pack(
    "feedback.csv", "Complaint", "Feedback", 919,
    topic=lambda r: f"my {r.choice(FEATURES)}",
    context=lambda r: r.choice([
        f"Client ID {r.choice('ABCDEFGHJK')}{r.randint(10000, 99999)}.", f"Using the app on {r.choice(['Android', 'iPhone', 'the web'])}.",
        f"I visited your {r.choice(CITIES)} branch.", f"Customer for {r.randint(2, 15)} years.",
        f"App version 6.{r.randint(0, 9)}.{r.randint(0, 9)}.", "",
    ]),
    signer=lambda r: r.choice(NAMES) + r.choice([" K", " S", " R", " M", " P", " T"]),
    swaps=[
        "{t} is {a} broken and {b} usable.",
        "{t} is {a} stuck and {b} working.",
        "{t} is {a} wrong and {b} corrected.",
        "I am {a} charged twice for {t} and {b} refunded.",
        "support has {b} called back about {t} and I am {a} upset.",
        "the problem with {t} is {a} worse and {b} fixed.",
        "{t} is {a} failing and {b} sorted.",
        "{t} is {a} pending and {b} processed.",
        "{t} is {a} blocked and {b} cleared.",
        "the charge on {t} is {a} unexplained and {b} reversed.",
    ],
    problems=["{t} failed", "{t} is not showing", "{t} charged me twice", "{t} has been pending for a week",
              "{t} shows the wrong amount", "{t} keeps crashing", "{t} was rejected without reason", "{t} went to the wrong account"],
    pressure=[
        "I will close my account", "I am filing a SEBI SCORES complaint", "I lost money because of this",
        "my order executed at the wrong price", "this is the fourth time", "the branch manager ignored me",
        "I want compensation", "I have screenshots as proof", "my money is stuck for ten days", "nobody answers the helpline",
        "I am moving to another broker", "I will post this on social media", "the agent was rude to me",
        "my senior citizen father cannot withdraw his own money", "I missed the IPO because of you", "my SIP bounced and I was fined",
        "my stop-loss did not trigger and I lost lakhs", "I was charged hidden fees", "my tax filing is stuck because of you",
        "I have written three emails with no reply", "your chatbot just loops", "the refund promised last month never came",
        "my nominee details were changed without my consent", "I got a margin penalty for your system error",
        "I want this escalated to the nodal officer", "the branch asked me to come four times", "my account was frozen without notice",
        "I received someone else's statement", "my bank was debited but no units were allotted", "the OTP never arrives",
        "I could not sell during the crash", "my dividend went to an old bank account", "I am a customer of fifteen years and this is shameful",
        "I will report this to the ombudsman", "my redemption money is needed for a hospital bill", "my FD matured but the money has not come",
        "the relationship manager has stopped answering", "I was mis-sold this insurance plan", "this has ruined my month",
        "the app logged me out in the middle of a trade", "my complaint number was closed without a fix",
        "you debited AMC charges twice", "my pledge was invoked wrongly", "my contract note shows trades I never made",
        "I want a written apology", "the call was disconnected three times", "my wife's account shows my holdings",
        "my KYC was rejected for the third time", "your staff told me to download a different app", "I am losing trust completely",
        "the branch is closed during working hours", "my bond interest has not been paid", "I paid but the plan is not active",
        "the transfer failed and the money vanished", "my portfolio value is wrong by lakhs", "I was promised a callback in an hour",
    ],
    asks=[
        "it would be nice if {t} had a dark mode.", "please add more charts to {t}.", "thanks for the quick help with {t}.",
        "can {t} show my XIRR?", "love the new design of {t}.", "suggestion: let me export {t} to Excel.",
        "could {t} support Hindi?", "the new {t} layout is cleaner, good work.", "please add a search box to {t}.",
        "it would help if {t} sent a WhatsApp alert.", "how do I change the font size on {t}?",
    ],
    mild=["{p}, maybe it is my phone.", "small thing, {p}.", "not sure why, but {p}.", "FYI {p}. Please check."],
    greetings=["Hi,", "Hello team,", "Dear Sir/Madam,"],
    closers=["Thanks.", "Thank you.", "Regards.", "Please look into it."],
)

PACKS: Dict[str, Pack] = {"client_emails": CLIENT_EMAILS, "it_tickets": IT_TICKETS, "feedback": FEEDBACK}

if __name__ == "__main__":
    for pack in PACKS.values():
        pack.build()
