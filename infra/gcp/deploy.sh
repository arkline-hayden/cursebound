#!/usr/bin/env bash
# Build the cloud service image with Cloud Build and deploy it to Cloud Run (manual path; CI uses
# .github/workflows/deploy-cloud.yml). Presence is in-memory, so the service runs as ONE instance
# (docs/contracts/ONLINE_CONTRACT.md); WebSockets need the 60-minute request timeout.
#
#   PROJECT_ID=<id> ./infra/gcp/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
source ./infra/gcp/env.sh

TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
IMAGE="${IMAGE_BASE}:${TAG}"
TURN_HOST="${TURN_HOST:-$(gcloud compute addresses describe "$TURN_IP_NAME" --region "$REGION" --format='value(address)' 2>/dev/null || true)}"
MIN_CLIENT_BUILD="${MIN_CLIENT_BUILD:-}"

echo "[deploy] building $IMAGE"
gcloud builds submit --region "$REGION" --config infra/gcp/cloudbuild.yaml --substitutions "_IMAGE=${IMAGE}" .

echo "[deploy] deploying $SERVICE"
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
  --service-account "$RUN_SA_EMAIL" --add-cloudsql-instances "$SQL_CONN" \
  --set-secrets "DATABASE_URL=cb-database-url:latest,TURN_SECRET=cb-turn-secret:latest" \
  --set-env-vars "TURN_HOST=${TURN_HOST},MIN_CLIENT_BUILD=${MIN_CLIENT_BUILD},NODE_ENV=production" \
  --min-instances 0 --max-instances 1 --concurrency 1000 --cpu 1 --memory 512Mi \
  --timeout 3600 --session-affinity --no-invoker-iam-check --port 8080

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "[deploy] live at $URL"
curl -fsS "$URL/api/v1/healthz" && echo
echo "Desktop builds point at this URL via CURSEBOUND_CLOUD_URL=$URL (GitHub variable CLOUD_URL)."
