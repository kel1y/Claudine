#!/usr/bin/env bash
# =============================================================================
# OpenCode one-command deploy.
#
#   ./deploy.sh
#
# What this does:
#   1. Validates that `.env` exists and has no remaining PLACEHOLDER values.
#   2. Builds the opencode Docker image from source (idempotent via build cache).
#   3. Seeds the persistent config volume with the default opencode.json on
#      first run only (never overwrites your edits on later runs).
#   4. Brings up opencode + Caddy with auto-HTTPS.
#   5. Prints the URL and shows live logs so you can verify the startup.
#
# Prereqs on the server:
#   - Docker Engine 24+ with the Compose v2 plugin (`docker compose`).
#   - Ports 80 + 443 open to the internet (Caddy needs 80 for ACME HTTP-01).
#   - DNS A record for OPENCODE_DOMAIN already pointing at this server's IPv4.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
CONFIG_SEED="opencode.json"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

# --------------------------------------------------------------------------- #
# 1. .env presence + placeholder check.                                       #
# --------------------------------------------------------------------------- #
if [[ ! -f "$ENV_FILE" ]]; then
  red "ERROR: $ENV_FILE not found."
  echo "  Run: cp .env.example $ENV_FILE  && edit $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

fail_placeholder() {
  red "ERROR: $1 still contains PLACEHOLDER. Edit $ENV_FILE and fill in real values."
  exit 1
}

[[ "${OPENCODE_DOMAIN:-}" == PLACEHOLDER* ]] && fail_placeholder "OPENCODE_DOMAIN"
[[ "${OPENCODE_SERVER_PASSWORD:-}" == PLACEHOLDER* ]] && fail_placeholder "OPENCODE_SERVER_PASSWORD"
[[ "${OPENCODE_SERVER_PASSWORD:-}" =~ ^(change-me|password|opencode|)$ ]] && {
  red "ERROR: OPENCODE_SERVER_PASSWORD looks weak or empty. Set a strong random value:"
  echo "  openssl rand -base64 32"
  exit 1
}
if [[ -z "${NVIDIA_API_KEY:-}" || "${NVIDIA_API_KEY:-}" == PLACEHOLDER* ]]; then
  ylw "WARN: NVIDIA_API_KEY is empty. The server will start but LLM calls will fail until you add one."
fi

if ! command -v docker >/dev/null 2>&1; then
  red "ERROR: docker not found. Install Docker Engine: https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  red "ERROR: docker compose plugin not found. Install Compose v2."
  exit 1
fi

bold "==> OpenCode deployment for ${OPENCODE_DOMAIN}"

# --------------------------------------------------------------------------- #
# 2. Build + 3. Seed config volume + 4. Bring up.                             #
# --------------------------------------------------------------------------- #
CONFIG_VOLUME="opencode_opencode-config"
DATA_VOLUME="opencode_opencode-data"

# Create volumes up front so we can seed the config file before the opencode
# container starts (avoids the race where opencode writes a default first).
docker volume create "$CONFIG_VOLUME" >/dev/null 2>&1 || true
docker volume create "$DATA_VOLUME" >/dev/null 2>&1 || true

# Seed opencode.json only if the volume is empty (first deploy). Later deploys
# never touch it — your config survives `update.sh` and image rebuilds.
if ! docker run --rm -v "$CONFIG_VOLUME:/cfg" alpine sh -c '[ -f /cfg/opencode.json ]' 2>/dev/null; then
  bold "==> Seeding default opencode.json into config volume (first run only)"
  docker run --rm -v "$CONFIG_VOLUME:/cfg" -v "$(pwd)/$CONFIG_SEED:/seed/opencode.json:ro" alpine \
    sh -c 'cp /seed/opencode.json /cfg/opencode.json && chmod 0644 /cfg/opencode.json'
else
  grn "==> Existing opencode.json found in volume — leaving it untouched"
fi

bold "==> Building opencode image (this is slow on first run, fast after)"
docker compose build opencode

bold "==> Starting services"
docker compose up -d

# --------------------------------------------------------------------------- #
# 5. Verify + report URL.                                                     #
# --------------------------------------------------------------------------- #
bold "==> Waiting for opencode to become healthy"
for i in $(seq 1 30); do
  if docker compose ps opencode | grep -q "healthy"; then
    grn "    opencode healthy"
    break
  fi
  printf '.'
  sleep 2
done
echo

URL="https://${OPENCODE_DOMAIN}"
bold "==> Deployed"
echo "  Web UI (login with the OPENCODE_SERVER_* creds):  $URL"
echo "  API base URL:                                    $URL"
echo "  View live logs:    docker compose logs -f"
echo "  Stop everything:   docker compose down"
echo "  Update to latest:  ./update.sh"
