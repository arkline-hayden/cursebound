# Deploying CURSEBOUND online services (GCP)

What runs in the cloud (docs/contracts/ONLINE_CONTRACT.md): the **cloud service** (accounts, friends, builds, run
summaries, boards, presence and signaling) on Cloud Run with Cloud SQL Postgres, and a **TURN relay** VM for co-op
connections that can't go direct. Gameplay itself is peer-to-peer: each host's desktop app runs its own authority.

Expected cost at friends scale: about **$15–30/month**, mostly the Cloud SQL micro instance (~$10) and the TURN VM
(e2-micro, free-tier eligible in us-central1/us-east1/us-west1, plus a little egress for relayed sessions). Cloud Run
scales to zero when nobody is online.

## 0. Prerequisites (you)
1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and the [GitHub CLI](https://cli.github.com/).
2. Sign in: `gcloud auth login` and `gh auth login`.
3. Create (or pick) a GCP project with billing attached:
   `gcloud projects create <id>`, then link billing in the console, or `gcloud billing projects link <id> --billing-account <acct>`.
4. Note your billing account id: `gcloud billing accounts list`.

## 1. One-time infrastructure (idempotent; safe to re-run)
```bash
PROJECT_ID=<id> BILLING_ACCOUNT=<acct> ./infra/gcp/setup.sh
```
This creates:
- Artifact Registry
- Cloud SQL Postgres 16 (`cursebound-pg`, db-f1-micro, daily backups kept 7 days), with a generated password stored only in Secret Manager
- the TURN shared secret
- three least-privilege service accounts
- keyless GitHub→GCP auth (Workload Identity Federation, limited to `arkline-hayden/cursebound`)
- the TURN VM (static IP, UDP/TCP 3478 + 49160–49200)
- a budget alert (default $30; alerts only)

It ends by printing the **GitHub repository variables** to set: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`,
`GCP_DEPLOY_SA`, `TURN_HOST`. Set them with `gh variable set NAME --body VALUE`.

## 2. Deploy the cloud service
Either push to `main` (`.github/workflows/deploy-cloud.yml` tests, builds, deploys and smoke-tests), or deploy by hand:
```bash
PROJECT_ID=<id> ./infra/gcp/deploy.sh
```
The service runs as **one instance** (presence is in-memory), with a 60-minute request timeout for WebSockets
(clients reconnect transparently). Then set the repository variable `CLOUD_URL` to the printed `https://…run.app` URL.
Desktop builds bake it in.

## 3. Release the desktop app
See docs/RELEASING.md: bump the version, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` builds Windows,
macOS and Linux and publishes a GitHub Release. Installed apps auto-update from there.

## Operations
- **Logs:** Cloud Run → `cursebound-cloud` → Logs (JSON lines). TURN: `gcloud compute ssh cursebound-turn -- journalctl -u coturn`.
- **Database backups:** automatic daily (7 kept). Manual: `gcloud sql backups create --instance cursebound-pg`.
- **Rotate the TURN secret:**
  1. Add a new version: `openssl rand -hex 32 | gcloud secrets versions add cb-turn-secret --data-file=-`
  2. Reset the VM so it re-reads it: `gcloud compute instances reset cursebound-turn --zone us-central1-a`
  3. Redeploy the service.
- **Force clients to update:** set repository variable `MIN_CLIENT_BUILD` and redeploy; older apps see an update prompt.
- **Scale beyond one instance (later):** move presence fan-out to Postgres LISTEN/NOTIFY, then raise `--max-instances`.
- **Tear down:** delete the Cloud Run service, the SQL instance, the VM and the static IP (or the whole project) to stop all charges.
