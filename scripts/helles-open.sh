#!/usr/bin/env bash
set -euo pipefail
URL="${HELLES_URL:-http://127.0.0.1:3847}"

if systemctl --user is-active --quiet helles.service 2>/dev/null; then
  :
else
  systemctl --user start helles.service 2>/dev/null || {
    echo "Helles: systemd user service 'helles.service' nicht gefunden oder start fehlgeschlagen." >&2
    echo "Manuell: cd $(dirname "$0")/.. && NODE_ENV=production npm start" >&2
    exit 1
  }
  for _ in $(seq 1 50); do
    if curl -sfS "${URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.15
  done
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v sensible-browser >/dev/null 2>&1; then
  sensible-browser "$URL" >/dev/null 2>&1 &
elif command -v x-www-browser >/dev/null 2>&1; then
  x-www-browser "$URL" >/dev/null 2>&1 &
else
  echo "Kein Browser-Starter (xdg-open) gefunden." >&2
  exit 1
fi
