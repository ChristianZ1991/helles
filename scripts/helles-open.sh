#!/usr/bin/env bash
set -euo pipefail
URL="${HELLES_URL:-http://127.0.0.1:3847}"

notify_error() {
  local msg="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Helles" "$msg" 2>/dev/null || true
  fi
  echo "$msg" >&2
}

if systemctl --user is-active --quiet helles.service 2>/dev/null; then
  :
else
  systemctl --user start helles.service 2>/dev/null || {
    notify_error "systemd user service 'helles.service' nicht gefunden oder Start fehlgeschlagen. Manuell: cd $(dirname "$0")/.. && NODE_ENV=production npm start"
    exit 1
  }
  for _ in $(seq 1 50); do
    if curl -sfS "${URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.15
  done
fi

open_cmd() {
  local cmd="$1"
  shift
  command -v "$cmd" >/dev/null 2>&1 || return 127
  "$cmd" "$@" >/dev/null 2>&1
}

if open_cmd xdg-open "$URL"; then
  exit 0
fi
if open_cmd gio open "$URL"; then
  exit 0
fi
if open_cmd sensible-browser "$URL"; then
  exit 0
fi
if open_cmd x-www-browser "$URL"; then
  exit 0
fi

notify_error "Kein Browser-Starter gefunden oder Öffnen fehlgeschlagen: ${URL}"
exit 1
