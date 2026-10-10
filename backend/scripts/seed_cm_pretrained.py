"""Train and store the shared pre-trained models for Exercise 3 (cm_pretrained + cm_models), and
read every dataset once with DistilBERT at each text length (cached in the bucket, cm_features/).

Usage (from backend/):  python -m scripts.seed_cm_pretrained
Safe to re-run: a model is only retrained when its dataset file has changed. The app also
trains a missing one on first use; this script just makes "open" instant from day one.
Writes to the database named by FIRESTORE_DATABASE_ID (see .env).
"""

from app.config import settings
from app.services import cm_bert, cm_datasets
from app.services.confusion_matrix_service import ConfusionMatrixService


BERT_LENGTHS = (16, 24, 32, 64)  # the "Text read per example" options in the Ex 3 settings


def main() -> None:
    service = ConfusionMatrixService()
    print(f"Pre-trained models in database '{settings.firestore_database_id}':")
    for dataset_id in cm_datasets.SAMPLE_IDS:
        doc = service.pretrained(dataset_id)
        m = doc["m"]
        print(f"  - {dataset_id}: accuracy {m['accuracy']:.3f}, precision {m['precision']:.3f}, "
              f"recall {m['recall']:.3f} (trained on {doc['trainN']}, scored on {m['n']}; model {doc['modelId']})")
    print("DistilBERT summaries (computed once, then read from the bucket):")
    for dataset_id in cm_datasets.SAMPLE_IDS:
        ds = cm_datasets.load_sample(dataset_id)
        for max_len in BERT_LENGTHS:
            _, cached = cm_bert.features(ds.key, ds.version, ds.texts, max_len)
            print(f"  - {dataset_id} @ {max_len} tokens: {'already stored' if cached else 'computed and stored'}")


if __name__ == "__main__":
    main()
