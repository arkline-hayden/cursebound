# CURSEBOUND GCP settings (docs/contracts/ONLINE_CONTRACT.md). Sourced by the other scripts in this folder.
# Override anything by exporting it before running a script, e.g. `PROJECT_ID=my-proj ./infra/gcp/setup.sh`.

: "${PROJECT_ID:?set PROJECT_ID to your GCP project id (gcloud projects list)}"
: "${REGION:=us-central1}"                 # e2-micro free tier exists in us-central1 / us-east1 / us-west1
: "${ZONE:=${REGION}-a}"
: "${GITHUB_REPO:=arkline-hayden/cursebound}"

: "${AR_REPO:=cursebound}"                 # Artifact Registry (docker)
: "${SERVICE:=cursebound-cloud}"           # Cloud Run service
: "${SQL_INSTANCE:=cursebound-pg}"         # Cloud SQL Postgres 16
: "${SQL_TIER:=db-f1-micro}"
: "${DB_NAME:=cursebound}"
: "${DB_USER:=cursebound}"
: "${TURN_VM:=cursebound-turn}"
: "${TURN_MACHINE:=e2-micro}"
: "${TURN_IP_NAME:=cursebound-turn-ip}"
: "${RUN_SA:=cursebound-run}"              # runtime identity of the Cloud Run service
: "${DEPLOY_SA:=cursebound-deployer}"      # GitHub Actions identity (Workload Identity Federation, no keys)
: "${TURN_SA:=cursebound-turn}"            # identity of the TURN VM (reads only the TURN secret)
: "${WIF_POOL:=github}"
: "${WIF_PROVIDER:=github-oidc}"
: "${BUDGET_USD:=30}"                      # monthly budget alert (alerts only; GCP budgets never stop services)

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}"
RUN_SA_EMAIL="${RUN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
TURN_SA_EMAIL="${TURN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export PROJECT_ID REGION ZONE PROJECT_NUMBER SQL_CONN IMAGE_BASE RUN_SA_EMAIL DEPLOY_SA_EMAIL TURN_SA_EMAIL
