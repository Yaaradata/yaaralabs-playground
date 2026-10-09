#!/usr/bin/env bash
# YaaraLabs Playground - GCP infra setup.
#
# Mirrors TheNeural Playground's stack in the SAME project, under separate names:
#   Firestore (default)          -> named database  $FS_DB
#   gs://playgroundai-470111-data -> gs://$BUCKET
#   Pub/Sub train-jobs/trainer-sub -> $TOPIC / $SUB
#   svc-{backend,trainer,infer,cleaner} -> yl-{backend,trainer,infer,cleaner}
#
# Settings are read from the live old resources (DB location, composite indexes,
# bucket lifecycle + CORS, each old SA's project roles) so the new stack matches.
# Storage / Firestore / Pub/Sub grants are scoped to the NEW resources only, so the
# YaaraLabs services cannot read or write TheNeural's data.
#
# Old resources are only ever read, never modified. Safe to re-run (idempotent).
#
# Usage:   bash infra/setup_gcp.sh            # apply
#          DRY_RUN=1 bash infra/setup_gcp.sh  # print commands only

set -euo pipefail

PROJECT="${PROJECT:-playgroundai-470111}"
REGION="${REGION:-us-central1}"

OLD_FS_DB="${OLD_FS_DB:-(default)}"
OLD_BUCKET="${OLD_BUCKET:-playgroundai-470111-data}"
OLD_SA_PREFIX="${OLD_SA_PREFIX:-svc}"

FS_DB="${FS_DB:-yaaralabs-playground}"
BUCKET="${BUCKET:-yaaralabs-playground-470111-data}"
TOPIC="${TOPIC:-yaaralabs-train-jobs}"
SUB="${SUB:-yaaralabs-trainer-sub}"
SA_PREFIX="${SA_PREFIX:-yl}"
ROLES=(backend trainer infer cleaner)

DRY_RUN="${DRY_RUN:-0}"
# Windows gcloud emits CRLF; strip \r so values compare and pass cleanly (pipefail keeps exit codes).
g() { gcloud --project="$PROJECT" --quiet "$@" | tr -d '\r'; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "   [dry-run] $*"; else "$@"; fi; }
py()   { python -I -c "$@"; }

FS_DB_RESOURCE="projects/$PROJECT/databases/$FS_DB"

# --------------------------------------------------------------------------
log "Checking auth and project"
g projects describe "$PROJECT" --format="value(projectId)" >/dev/null
ok "authenticated as $(gcloud config get-value account 2>/dev/null) on $PROJECT"

# --------------------------------------------------------------------------
log "Enabling APIs (no-op if already on)"
run g services enable firestore.googleapis.com run.googleapis.com pubsub.googleapis.com \
  storage.googleapis.com cloudscheduler.googleapis.com cloudfunctions.googleapis.com \
  aiplatform.googleapis.com cloudbuild.googleapis.com iam.googleapis.com
ok "APIs enabled"

# --------------------------------------------------------------------------
log "Firestore database: $FS_DB"
FS_LOCATION="$(g firestore databases describe --database="$OLD_FS_DB" --format="value(locationId)")"
FS_TYPE="$(g firestore databases describe --database="$OLD_FS_DB" --format="value(type)")"
ok "old database $OLD_FS_DB: location=$FS_LOCATION type=$FS_TYPE"

if g firestore databases describe --database="$FS_DB" >/dev/null 2>&1; then
  ok "$FS_DB already exists"
else
  fs_type_flag="firestore-native"
  [ "$FS_TYPE" = "DATASTORE_MODE" ] && fs_type_flag="datastore-mode"
  run g firestore databases create --database="$FS_DB" --location="$FS_LOCATION" \
    --type="$fs_type_flag" --delete-protection
  ok "created $FS_DB in $FS_LOCATION (delete protection on)"
fi

log "Copying composite indexes $OLD_FS_DB -> $FS_DB"
g firestore indexes composite list --database="$OLD_FS_DB" --format=json > "$TMP/old_idx.json"
g firestore indexes composite list --database="$FS_DB" --format=json > "$TMP/new_idx.json" 2>/dev/null || echo "[]" > "$TMP/new_idx.json"
# One line per missing index: collection<TAB>scope<TAB>--field-config=... ...
py '
import json, sys
def key(i):
    return (i["name"].split("/collectionGroups/")[1].split("/")[0], i.get("queryScope","COLLECTION"),
            json.dumps(i.get("fields",[]), sort_keys=True))
old = json.load(open(sys.argv[1])); new = json.load(open(sys.argv[2]))
have = {key(i) for i in new}
for i in old:
    k = key(i)
    if k in have:
        continue
    cfgs = []
    for f in i["fields"]:
        if f["fieldPath"] == "__name__" and f.get("order") == "ASCENDING":
            continue
        c = "field-path=" + f["fieldPath"]
        if "order" in f:         c += ",order=" + f["order"].lower()
        elif "arrayConfig" in f: c += ",array-config=" + f["arrayConfig"].lower()
        elif "vectorConfig" in f:
            c += ",vector-config=" + json.dumps({"dimension": str(f["vectorConfig"]["dimension"]), "flat": "{}"}).replace(" ", "")
        cfgs.append("--field-config=" + c)
    print(k[0] + "\t" + k[1].lower().replace("_", "-") + "\t" + " ".join(cfgs))
' "$TMP/old_idx.json" "$TMP/new_idx.json" > "$TMP/missing_idx.tsv"
idx_count=$(py 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$TMP/old_idx.json")
missing=$(grep -c . "$TMP/missing_idx.tsv" || true)
ok "$idx_count composite indexes on old db, $missing to create"
while IFS=$'\t' read -r coll scope cfgs; do
  [ -z "$coll" ] && continue
  # shellcheck disable=SC2086
  run g firestore indexes composite create --database="$FS_DB" --collection-group="$coll" \
    --query-scope="$scope" $cfgs --async
  ok "index on $coll queued"
done < "$TMP/missing_idx.tsv"

ttl_fields=$(g firestore fields ttls list --database="$OLD_FS_DB" --format="value(name)" 2>/dev/null || true)
if [ -n "$ttl_fields" ]; then
  log "Copying TTL policies"
  while read -r name; do
    [ -z "$name" ] && continue
    cg=$(echo "$name" | sed -E 's#.*/collectionGroups/([^/]+)/fields/.*#\1#')
    fld=$(echo "$name" | sed -E 's#.*/fields/##')
    run g firestore fields ttls update "$fld" --collection-group="$cg" --database="$FS_DB" --enable-ttl --async
    ok "TTL $cg.$fld"
  done <<< "$ttl_fields"
fi

# --------------------------------------------------------------------------
log "Storage bucket: gs://$BUCKET"
if g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  ok "bucket already exists"
else
  OLD_LOC="$(g storage buckets describe "gs://$OLD_BUCKET" --format="value(location)")"
  OLD_CLASS="$(g storage buckets describe "gs://$OLD_BUCKET" --format="value(default_storage_class)")"
  run g storage buckets create "gs://$BUCKET" --location="${OLD_LOC:-$REGION}" \
    --default-storage-class="${OLD_CLASS:-STANDARD}" --uniform-bucket-level-access \
    --public-access-prevention
  ok "created in ${OLD_LOC:-$REGION}"
fi

g storage buckets describe "gs://$OLD_BUCKET" --format=json > "$TMP/old_bucket.json"
py '
import json, sys
b = json.load(open(sys.argv[1]))
lc = b.get("lifecycle_config") or {"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7}}]}
json.dump(lc, open(sys.argv[2], "w"))
json.dump(b.get("cors_config") or [], open(sys.argv[3], "w"))
' "$TMP/old_bucket.json" "$TMP/lifecycle.json" "$TMP/cors.json"
run g storage buckets update "gs://$BUCKET" --lifecycle-file="$TMP/lifecycle.json"
ok "lifecycle: $(cat "$TMP/lifecycle.json")"
if [ "$(cat "$TMP/cors.json")" != "[]" ]; then
  run g storage buckets update "gs://$BUCKET" --cors-file="$TMP/cors.json"
  ok "CORS copied from old bucket"
fi

# --------------------------------------------------------------------------
log "Pub/Sub: $TOPIC / $SUB"
if g pubsub topics describe "$TOPIC" >/dev/null 2>&1; then ok "topic exists"
else run g pubsub topics create "$TOPIC"; ok "topic created"; fi

OLD_ACK="$(g pubsub subscriptions describe trainer-sub --format="value(ackDeadlineSeconds)" 2>/dev/null || echo 600)"
OLD_RET="$(g pubsub subscriptions describe trainer-sub --format="value(messageRetentionDuration)" 2>/dev/null || echo 604800s)"
if g pubsub subscriptions describe "$SUB" >/dev/null 2>&1; then ok "subscription exists"
else
  run g pubsub subscriptions create "$SUB" --topic="$TOPIC" \
    --ack-deadline="${OLD_ACK:-600}" --message-retention-duration="${OLD_RET:-604800s}"
  ok "subscription created (ack ${OLD_ACK:-600}s)"
fi

# --------------------------------------------------------------------------
log "Service accounts and IAM"
for r in "${ROLES[@]}"; do
  sa="$SA_PREFIX-$r@$PROJECT.iam.gserviceaccount.com"
  old_sa="$OLD_SA_PREFIX-$r@$PROJECT.iam.gserviceaccount.com"

  if g iam service-accounts describe "$sa" >/dev/null 2>&1; then ok "$sa exists"
  else
    run g iam service-accounts create "$SA_PREFIX-$r" --display-name="YaaraLabs Playground ${r^} SA"
    ok "created $sa"
    [ "$DRY_RUN" = 1 ] || sleep 5   # IAM propagation before binding
  fi

  old_roles=$(g projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:$old_sa" --format="value(bindings.role)" | sort -u)
  echo "   $old_sa roles: $(echo $old_roles)"

  for role in $old_roles; do
    case "$role" in
      roles/storage.*)
        run g storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$sa" --role="$role" >/dev/null
        ok "$role on gs://$BUCKET" ;;
      roles/datastore.*)
        run g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$sa" --role="$role" \
          --condition="expression=resource.name==\"$FS_DB_RESOURCE\",title=only-$FS_DB,description=Limit to $FS_DB database" >/dev/null
        ok "$role on database $FS_DB only" ;;
      roles/pubsub.publisher)
        run g pubsub topics add-iam-policy-binding "$TOPIC" --member="serviceAccount:$sa" --role="$role" >/dev/null
        ok "$role on topic $TOPIC" ;;
      roles/pubsub.subscriber)
        run g pubsub subscriptions add-iam-policy-binding "$SUB" --member="serviceAccount:$sa" --role="$role" >/dev/null
        ok "$role on subscription $SUB" ;;
      *)
        run g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$sa" --role="$role" --condition=None >/dev/null
        ok "$role (project)" ;;
    esac
  done
done

# --------------------------------------------------------------------------
log "Done"
cat <<EOF
   Backend env for YaaraLabs Playground:
     GOOGLE_CLOUD_PROJECT=$PROJECT
     FIRESTORE_DATABASE_ID=$FS_DB
     GCS_BUCKET_NAME=$BUCKET
     PUBSUB_TOPIC_NAME=$TOPIC
     PUBSUB_SUBSCRIPTION_NAME=$SUB
   Cloud Run service account: $SA_PREFIX-backend@$PROJECT.iam.gserviceaccount.com
   Composite indexes build asynchronously; check with:
     gcloud firestore indexes composite list --database=$FS_DB
EOF
