#!/usr/bin/env bash
# One-time (idempotent) GCP setup for CURSEBOUND online services (docs/contracts/ONLINE_CONTRACT.md, docs/DEPLOY.md).
# Creates: APIs, Artifact Registry, Cloud SQL Postgres + database/user, secrets, service accounts + IAM, Workload
# Identity Federation for GitHub Actions, the TURN relay VM (static IP + firewall), and a budget alert.
# Safe to re-run: every step checks before creating. Prints the GitHub repository variables to set at the end.
#
#   PROJECT_ID=<id> BILLING_ACCOUNT=<id> ./infra/gcp/setup.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./env.sh

say() { printf '\033[35m[setup]\033[0m %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null

say "enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com compute.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudbuild.googleapis.com billingbudgets.googleapis.com

say "artifact registry: $AR_REPO"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location "$REGION" \
    --description "CURSEBOUND images"

say "service accounts"
for sa in "$RUN_SA:CURSEBOUND Cloud Run runtime" "$DEPLOY_SA:CURSEBOUND GitHub deployer" "$TURN_SA:CURSEBOUND TURN relay VM"; do
  id="${sa%%:*}"; name="${sa#*:}"
  exists gcloud iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" ||
    gcloud iam service-accounts create "$id" --display-name "$name"
done

say "cloud sql: $SQL_INSTANCE ($SQL_TIER, Postgres 16) — first creation takes several minutes"
exists gcloud sql instances describe "$SQL_INSTANCE" ||
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
    --tier="$SQL_TIER" --region="$REGION" --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=09:00 --retained-backups-count=7
exists gcloud sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" ||
  gcloud sql databases create "$DB_NAME" --instance "$SQL_INSTANCE"

say "secrets"
if ! exists gcloud secrets describe cb-database-url; then
  DB_PASS="$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 32)"
  exists gcloud sql users describe "$DB_USER" --instance "$SQL_INSTANCE" &&
    gcloud sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASS" ||
    gcloud sql users create "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASS"
  printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASS" "$DB_NAME" "$SQL_CONN" |
    gcloud secrets create cb-database-url --replication-policy=automatic --data-file=-
  unset DB_PASS
fi
exists gcloud secrets describe cb-turn-secret ||
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create cb-turn-secret --replication-policy=automatic --data-file=-

say "IAM: runtime"
for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUN_SA_EMAIL" --role "$role" --condition=None >/dev/null
done
say "IAM: TURN VM reads only the TURN secret"
gcloud secrets add-iam-policy-binding cb-turn-secret --member "serviceAccount:$TURN_SA_EMAIL" \
  --role roles/secretmanager.secretAccessor >/dev/null
say "IAM: deployer (GitHub Actions)"
for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA_EMAIL" --role "$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA_EMAIL" --member "serviceAccount:$DEPLOY_SA_EMAIL" \
  --role roles/iam.serviceAccountUser >/dev/null

say "workload identity federation for $GITHUB_REPO"
exists gcloud iam workload-identity-pools describe "$WIF_POOL" --location global ||
  gcloud iam workload-identity-pools create "$WIF_POOL" --location global --display-name "GitHub Actions"
exists gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --location global --workload-identity-pool "$WIF_POOL" ||
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --location global \
    --workload-identity-pool "$WIF_POOL" --display-name "GitHub OIDC" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

say "TURN relay: static IP, firewall, VM $TURN_VM ($TURN_MACHINE)"
exists gcloud compute addresses describe "$TURN_IP_NAME" --region "$REGION" ||
  gcloud compute addresses create "$TURN_IP_NAME" --region "$REGION"
TURN_IP="$(gcloud compute addresses describe "$TURN_IP_NAME" --region "$REGION" --format='value(address)')"
exists gcloud compute firewall-rules describe cursebound-turn ||
  gcloud compute firewall-rules create cursebound-turn --network default --direction INGRESS \
    --target-tags cursebound-turn --source-ranges 0.0.0.0/0 \
    --allow udp:3478,tcp:3478,udp:49160-49200 --description "CURSEBOUND TURN relay"
exists gcloud compute instances describe "$TURN_VM" --zone "$ZONE" ||
  gcloud compute instances create "$TURN_VM" --zone "$ZONE" --machine-type "$TURN_MACHINE" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 10GB \
    --address "$TURN_IP" --tags cursebound-turn --service-account "$TURN_SA_EMAIL" \
    --scopes cloud-platform --metadata-from-file startup-script=./turn-startup.sh \
    --metadata turn-ip="$TURN_IP"

if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  say "budget alert: \$${BUDGET_USD}/month (50/90/100%)"
  gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --format='value(displayName)' | grep -qx "CURSEBOUND" ||
    gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --display-name "CURSEBOUND" \
      --budget-amount "${BUDGET_USD}USD" --filter-projects "projects/${PROJECT_ID}" \
      --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0
else
  say "skipping budget alert (set BILLING_ACCOUNT=<id from 'gcloud billing accounts list'> to create one)"
fi

cat <<EOF

Done. Set these GitHub repository variables (Settings → Secrets and variables → Actions → Variables):
  GCP_PROJECT_ID       = ${PROJECT_ID}
  GCP_REGION           = ${REGION}
  GCP_WIF_PROVIDER     = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}
  GCP_DEPLOY_SA        = ${DEPLOY_SA_EMAIL}
  TURN_HOST            = ${TURN_IP}
Then deploy the cloud service: ./infra/gcp/deploy.sh   (or push to main once the workflow variables exist)
EOF
