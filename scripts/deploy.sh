#!/bin/sh
# Requires Docker only. Compose v2 is supported through either CLI spelling.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mode=${1:-local}
case "$mode" in init|local|production) ;; *) echo 'Usage: ./scripts/deploy.sh [init|local|production]' >&2; exit 2 ;; esac
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  echo 'Install Docker Compose v2 (docker compose or docker-compose).' >&2
  exit 1
fi
if [ ! -f .env ]; then
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace \
    node:22-bookworm-slim node scripts/setup-env.mjs
fi
if [ "$mode" = init ]; then
  echo 'Environment ready in .env. For HTTPS configure NEXUS_HOST and ACME_EMAIL.'
  exit 0
fi
if [ "$mode" = production ]; then
  if grep -Eq '^NEXUS_HOST=(nexus\.example\.com|localhost|127\.0\.0\.1)$' .env; then
    echo 'Set your real NEXUS_HOST and ACME_EMAIL in .env before production deployment.' >&2
    exit 1
  fi
  compose -f docker-compose.yml up -d --build --wait --wait-timeout 180
  echo 'NEXUS is running with HTTPS on the domain configured in .env.'
else
  compose -f docker-compose.local.yml up -d --build --wait --wait-timeout 180
  echo "NEXUS is ready at http://localhost:${NEXUS_HTTP_PORT:-8080}"
fi
echo 'Sign in with ADMIN_EMAIL and ADMIN_PASSWORD from .env. Existing accounts are preserved.'
