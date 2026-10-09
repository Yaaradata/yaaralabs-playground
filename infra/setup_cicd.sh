#!/usr/bin/env bash
# YaaraLabs Playground - CI/CD setup (Cloud Build trigger -> Cloud Run).
#
# Push to main touching backend/** -> build image -> push to Artifact Registry
# -> roll Cloud Run service to the new image -> /health smoke test.
# Pipeline steps live in backend/cloudbuild.yaml.
#
# Builds run as a dedicated deployer SA with grants scoped to this service,
# its runtime SA and the image repo (not the broad default compute SA).
#
# Prereq: the GitHub repo must be connected to Cloud Build (Cloud Build GitHub App
# has access to Yaaradata/yaaralabs-playground). Safe to re-run.

set -euo pipefail

PROJECT="${PROJECT:-playgroundai-470111}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-yaaralabs-playground-backend}"
RUNTIME_SA="yl-backend@$PROJECT.iam.gserviceaccount.com"
DEPLOYER="yl-deployer"
DEPLOYER_SA="$DEPLOYER@$PROJECT.iam.gserviceaccount.com"
AR_REPO="${AR_REPO:-cloud-run-source-deploy}"
GH_OWNER="${GH_OWNER:-Yaaradata}"
GH_REPO="${GH_REPO:-yaaralabs-playground}"
TRIGGER="${TRIGGER:-yaaralabs-backend-deploy}"

# Windows gcloud emits CRLF; strip \r so values compare cleanly (pipefail keeps exit codes).
g() { gcloud --project="$PROJECT" --quiet "$@" | tr -d '\r'; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$*"; }
log() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

log "Deployer service account"
if g iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1; then ok "$DEPLOYER_SA exists"
else
  g iam service-accounts create "$DEPLOYER" --display-name="YaaraLabs Playground CI/CD deployer"
  ok "created $DEPLOYER_SA"; sleep 5
fi

log "Scoped grants"
g run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/run.developer >/dev/null
ok "run.developer on service $SERVICE"
g iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser >/dev/null
ok "serviceAccountUser on $RUNTIME_SA (deploy as runtime SA)"
g artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.writer >/dev/null
ok "artifactregistry.writer on repo $AR_REPO"
g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOYER_SA" \
  --role=roles/logging.logWriter --condition=None >/dev/null
ok "logging.logWriter (build logs)"

log "Cloud Build trigger: $TRIGGER"
if g builds triggers describe "$TRIGGER" >/dev/null 2>&1; then ok "trigger exists"
else
  g builds triggers create github --name="$TRIGGER" \
    --description="Build and deploy $SERVICE on push to main (backend/**)" \
    --repo-owner="$GH_OWNER" --repo-name="$GH_REPO" --branch-pattern='^main$' \
    --build-config=backend/cloudbuild.yaml --included-files='backend/**' \
    --service-account="projects/$PROJECT/serviceAccounts/$DEPLOYER_SA" >/dev/null
  ok "created: push to $GH_OWNER/$GH_REPO main (backend/**) -> $SERVICE"
fi
