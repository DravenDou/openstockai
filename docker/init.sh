#!/bin/sh
# One-shot: generates each missing internal secret once and stores it in the secrets volume.
# Existing secrets are never rotated, so restarts reuse them; `docker compose down -v` drops
# the volume together with the database it protects. Values are never printed.
set -eu
dir="${SECRETS_DIR:-/secrets}"
umask 022
for name in POSTGRES_PASSWORD API_DATABASE_PASSWORD AUTH_DATABASE_PASSWORD BETTER_AUTH_SECRET AGENT_SERVICE_SECRET; do
  file="$dir/$name"
  if [ -s "$file" ]; then
    echo "$name: already present"
    continue
  fi
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file.tmp"
  chmod 0444 "$file.tmp"
  mv "$file.tmp" "$file"
  echo "$name: generated"
done
