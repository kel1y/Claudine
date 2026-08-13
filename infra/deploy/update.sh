#!/usr/bin/env bash
# =============================================================================
# OpenCode one-command update.
#
#   ./update.sh
#
# Pulls the latest opencode source from your local git checkout (you `git pull`
# first, then run this), rebuilds the image, and rolls the container with zero
# data loss. Sessions, auth, and config live on Docker volumes and are never
# touched during an update.
#
# Optional: pass a git ref to check out before building, e.g.
#   ./update.sh dev
#   ./update.sh v1.18.14
#   ./update.sh <commit-sha>

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # repo root

REF="${1:-}"

grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

bold "==> OpenCode update"

# If a ref was passed, check it out. Otherwise use whatever the working tree
# currently has (the caller is expected to have run `git pull` themselves, so we
# never mutate their checkout silently).
if [[ -n "$REF" ]]; then
  bold "==> Checking out $REF"
  if [[ -d .git ]]; then
    git fetch --all --tags
    git checkout "$REF"
  else
    echo "WARN: not a git checkout; skipping checkout (using current files)" >&2
  fi
fi

bold "==> Rebuilding opencode image"
docker compose --file infra/deploy/docker-compose.yml build opencode

bold "==> Rolling the container (no downtime for volumes; brief request gap)"
# `up -d` recreates only containers whose image/config changed. Caddy keeps
# proxying to the same service name, so the brief gap is just the time it takes
# for opencode to bind its port after recreation.
docker compose --file infra/deploy/docker-compose.yml up -d

bold "==> Pruning dangling builder images (keeps disk tidy on the VPS)"
docker image prune -f >/dev/null 2>&1 || true

grn "==> Update complete."
echo "  Logs:    docker compose --file infra/deploy/docker-compose.yml logs -f"
echo "  Health:  docker compose --file infra/deploy/docker-compose.yml ps"
