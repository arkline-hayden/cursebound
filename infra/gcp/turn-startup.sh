#!/usr/bin/env bash
# Startup script of the CURSEBOUND TURN relay VM (runs as root on every boot). Installs coturn and configures
# time-limited credentials (use-auth-secret) with the shared secret from Secret Manager, which the cloud service
# also reads to mint credentials (docs/contracts/ONLINE_CONTRACT.md "GET /turn"). No static users, no TLS needed
# for TURN-over-UDP/TCP; WebRTC encrypts the data channel end to end (DTLS), so the relay only sees ciphertext.
set -euo pipefail
MD=http://metadata.google.internal/computeMetadata/v1
hdr='Metadata-Flavor: Google'
PROJECT="$(curl -fsS -H "$hdr" "$MD/project/project-id")"
EXT_IP="$(curl -fsS -H "$hdr" "$MD/instance/attributes/turn-ip")"
INT_IP="$(curl -fsS -H "$hdr" "$MD/instance/network-interfaces/0/ip")"
# the API replies are multi-line JSON: parse with python3 (always present on Debian images), not sed
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
TOKEN="$(curl -fsS -H "$hdr" "$MD/instance/service-accounts/default/token" | json "d['access_token']")"
SECRET="$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/cb-turn-secret/versions/latest:access" |
  json "d['payload']['data']" | base64 -d)"
[ -n "$SECRET" ] || { echo 'cb-turn-secret is empty or unreadable' >&2; exit 1; }

if ! command -v turnserver >/dev/null; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
fi

cat > /etc/turnserver.conf <<EOF
listening-port=3478
listening-ip=${INT_IP}
relay-ip=${INT_IP}
external-ip=${EXT_IP}/${INT_IP}
min-port=49160
max-port=49200
fingerprint
use-auth-secret
static-auth-secret=${SECRET}
realm=cursebound
no-tls
no-dtls
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
total-quota=200
user-quota=12
max-bps=262144
stale-nonce=600
log-file=syslog
simple-log
EOF
chmod 600 /etc/turnserver.conf
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || true
systemctl enable coturn
systemctl restart coturn
