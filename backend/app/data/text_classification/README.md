# Text Classification packs (Day 1, Ex 2)

Built by `backend/scripts/build_tc_datasets.py RAW_DIR` (seeded, so it rebuilds identically). Every file is `id,text,label`, two classes. The first class in `tc_datasets.PACKS` is the class we care about, which Ex 3 opens as its target.

| File | Rows | Classes (class we care about first) | Source | Licence |
|---|---|---|---|---|
| cfpb_complaint_routing.csv | 4,975 | Payments & transfers 2,486 · Accounts & statements 2,489 | CFPB complaints, Jan–Mar 2024 (via nishanttyagi28/crm-ticket-intelligence sample) | Public domain |
| banking77_payment_vs_kyc.csv | 1,728 | Payment status 1,128 · Identity & KYC 600 | BANKING77 (PolyAI), train + test | CC BY 4.0 |
| cfpb_prepaid_vs_bank.csv | 2,135 | Prepaid card 1,067 · Bank account 1,068 | CFPB complaints, Jan–Mar 2024 | Public domain |
| fin_news_bearish_bullish.csv | 4,185 | Bearish 1,788 · Bullish 2,397 | Twitter Financial News Sentiment, neutral removed | MIT |
| custody_breaks.csv | 40,000 | Investigate 20,019 · Self-clears 19,981 | Synthetic custody wording, 2.5% label noise | YaaraLabs |
| custody_client_emails.csv | 40,000 | Escalate 20,071 · Routine 19,929 | Synthetic custody wording, 2.5% label noise | YaaraLabs |

How the packs are built:

- **Complaint routing.** "Payments & transfers" is every *Money transfer, virtual currency, or money service* complaint. "Accounts & statements" is the same number of *Checking or savings account* complaints. Narratives of 40+ characters, de-duplicated.
- **Prepaid vs bank account.** Every *Prepaid card* complaint, plus as many checking/savings complaints that are not used in routing.
- **Payment vs KYC.** BANKING77 intents:
  - Payment status: pending_transfer, transfer_not_received_by_recipient, balance_not_updated_after_bank_transfer, transfer_timing, declined_transfer, failed_transfer.
  - Identity & KYC: verify_my_identity, why_verify_identity, unable_to_verify_identity, verify_source_of_funds.

**Differences from the curriculum.** The curriculum lists 4,157 rows for the routing pack and 1,941 for the prepaid pack. Its source file isn't in the pack, so the rows here come from the same public CFPB extract with the product mapping above. TF-IDF + logistic regression on the routing pack scores about 82% (Balanced preset), which is in line with the curriculum.

**Synthetic packs.** These are template-generated with deliberate duplicates and conflicting labels, so step 2 (inspect and clean) has real problems to find. The real packs were de-duplicated at build time, so they show almost none; the CFPB packs instead show the XXXX masking.
