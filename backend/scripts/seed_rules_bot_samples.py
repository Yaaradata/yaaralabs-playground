"""Load Rules Bot samples into Firestore (rules_bot_samples). Safe to re-run: upserts by id.

Usage (from backend/):  python -m scripts.seed_rules_bot_samples
Writes to the database named by FIRESTORE_DATABASE_ID (see .env).
"""

from app.config import settings
from app.services.rules_bot_samples import SAMPLES
from app.services.rules_bot_service import RulesBotService


def main() -> None:
    service = RulesBotService()
    print(f"Seeding {len(SAMPLES)} sample(s) into database '{settings.firestore_database_id}'")
    for sample in SAMPLES:
        service.upsert_sample(sample)
        print(f"  - {sample['id']}: {sample['name']} ({len(sample['rules'])} rules)")
    print("Now in Firestore:", [s.id for s in service.list_samples()])


if __name__ == "__main__":
    main()
