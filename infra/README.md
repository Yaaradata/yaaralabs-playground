# YaaraLabs Playground — GCP infra

Same GCP project as TheNeural Playground (`playgroundai-470111`), fully separate data plane.

| Resource | TheNeural (college) | YaaraLabs (corporate) |
|---|---|---|
| Firestore database | `(default)` | `yaaralabs-playground` |
| GCS bucket | `playgroundai-470111-data` | `yaaralabs-playground-470111-data` |
| Pub/Sub topic | `train-jobs` | `yaaralabs-train-jobs` |
| Pub/Sub subscription | `trainer-sub` | `yaaralabs-trainer-sub` |
| Service accounts | `svc-{backend,trainer,infer,cleaner}` | `yl-{backend,trainer,infer,cleaner}` |
| Region | us-central1 | us-central1 |

Collection names and the GCS folder layout are unchanged (`projects`, `students`, `teachers_classrooms`, `knowledge`, `agents`, …), so the backend code ports as-is.

The new service accounts get the same roles as the old ones. Storage, Firestore and Pub/Sub roles are scoped to the new bucket, database, topic and subscription only, so YaaraLabs services cannot touch TheNeural data.

Status (2026-10-09): created and verified. All 3 composite indexes are READY, and re-running the script makes no changes.

Note: the old `trainer-sub` subscription does not exist in the project and never did (no deletion in the audit logs). The old Pub/Sub training worker therefore isn't in use, and `yaaralabs-trainer-sub` was created with the documented settings (600s ack, 7-day retention).

## Run

```bash
gcloud auth login
DRY_RUN=1 bash infra/setup_gcp.sh   # preview
bash infra/setup_gcp.sh             # apply (idempotent)
```

## CI/CD

A push to `main` that touches `backend/**` runs the Cloud Build trigger `yaaralabs-backend-deploy` → [backend/cloudbuild.yaml](../backend/cloudbuild.yaml):
build (with layer cache) → push `:<sha>` and `:latest` to Artifact Registry → `gcloud run services update --image` → `/health` smoke test.

- CI only rolls the image forward. Env vars, secrets, service account and sizing are set by `backend/deploy.ps1`; re-run it when those change.
- Builds run as `yl-deployer`, which can only: update `yaaralabs-playground-backend` (run.developer), act as `yl-backend`, write to the `cloud-run-source-deploy` repo, and write logs.
- Setup: connect `Yaaradata/yaaralabs-playground` to Cloud Build once (console, GitHub App), then `bash infra/setup_cicd.sh`.

| Secret (Secret Manager) | Env var | Readable by |
|---|---|---|
| `yaaralabs-google-api-key` | `GOOGLE_API_KEY` | `yl-backend` |
| `yaaralabs-google-cse-id` | `GOOGLE_CSE_ID` | `yl-backend` |

## Backend env

```
GOOGLE_CLOUD_PROJECT=playgroundai-470111
FIRESTORE_DATABASE_ID=yaaralabs-playground
GCS_BUCKET_NAME=yaaralabs-playground-470111-data
PUBSUB_TOPIC_NAME=yaaralabs-train-jobs
PUBSUB_SUBSCRIPTION_NAME=yaaralabs-trainer-sub
```

Deploy Cloud Run with `--service-account=yl-backend@playgroundai-470111.iam.gserviceaccount.com`.

## Required code changes when porting the backend

The TheNeural backend has these resource names hard-coded. Without these fixes the new backend would silently read and write the **old** data:

1. `app/config.py`, `app/config_local.py`: `firestore.Client(project=...)` ignores `FIRESTORE_DATABASE_ID`. Change it to `firestore.Client(project=..., database=settings.firestore_database_id)`.
2. `app/image_training_service.py:690`: bare `firestore.Client()`. Use `gcp_clients.get_firestore_client()` instead.
3. `app/config.py` `get_subscription_path`, `app/config_local.py`, `app/training_worker.py:54`: `"trainer-sub"` is hard-coded. Read it from `PUBSUB_SUBSCRIPTION_NAME` instead.
4. `app/services/file_service.py:45`: falls back to the bucket `neural-playground-kb` and auto-creates it. Default to `settings.gcs_bucket_name` instead.
5. Defaults in `Settings`, `cloudbuild.yaml` and `deploy.ps1`: update the bucket, database, topic, service account, service names and CORS origins.
