"""Seed data for the Rules Bot Samples menu (Firestore collection rules_bot_samples).

Loaded into Firestore by scripts/seed_rules_bot_samples.py; the app reads samples
from Firestore only. Add a dict here and re-run the script to grow the menu.
"""

from typing import Any, Dict, List

DEFAULT_REPLY = "Sorry, I didn't understand. A person will reply."

SAMPLES: List[Dict[str, Any]] = [
    {
        "id": "asset-services",
        "name": "Asset Services",
        "summary": "Custody client queries · 6 rules",
        "reply": DEFAULT_REPLY,
        "order": 1,
        "rules": [
            {"desk": "Corporate Actions", "keywords": ["dividend", "bonus", "rights", "split", "buyback", "coupon", "record date"]},
            {"desk": "Settlement", "keywords": ["settle", "pay-in", "pay-out", "auction", "short", "delivery", "T+1", "T+0"]},
            {"desk": "Client Reporting", "keywords": ["statement", "report", "contract note", "NAV pack", "ledger"]},
            {"desk": "Onboarding & KYC", "keywords": ["KYC", "PAN", "FATCA", "signatory", "registration", "UBO", "address"]},
            {"desk": "Billing", "keywords": ["fee", "invoice", "bill", "charge", "GST"]},
            {"desk": "Escalations", "keywords": ["complaint", "unacceptable", "escalate", "board", "regulator", "wrong"]},
        ],
    },
]
