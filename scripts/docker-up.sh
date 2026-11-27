#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker build --target bootstrap -t openstockai-bootstrap:local .
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" -w /workspace openstockai-bootstrap:local \
  node scripts/setup-local.mjs
exec docker compose up -d --build "$@"
