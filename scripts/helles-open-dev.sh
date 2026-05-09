#!/usr/bin/env bash
# Helles im Entwicklungsmodus öffnen (Chat-UI).
# Nutzung:
#   helles-open-dev.sh local          → https://127.0.0.1:5173 , startet bei Bedarf „npm run dev“
#   helles-open-dev.sh remote         → URL aus ~/.config/helles/remote-url (für zweiten Rechner / woanders)
#   helles-open-dev.sh https://…      → beliebige URL; bei 127.0.0.1/localhost wird Dev ggf. gestartet
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_OR_URL="${1:-local}"

resolve_url() {
  case "$PROFILE_OR_URL" in
  local)
    echo "https://127.0.0.1:5173"
    ;;
  remote)
    f="${XDG_CONFIG_HOME:-$HOME/.config}/helles/remote-url"
    if [[ -f "$f" ]]; then
      line="$(grep -E '^[[:space:]]*https?://' "$f" 2>/dev/null | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [[ -n "${line:-}" ]]; then
        echo "$line"
        return 0
      fi
    fi
    echo "https://127.0.0.1:5173"
    ;;
  http://* | https://*)
    echo "$PROFILE_OR_URL"
    ;;
  *)
    echo "https://127.0.0.1:5173"
    ;;
  esac
}

URL="$(resolve_url)"

is_local_dev_url() {
  [[ "$URL" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/|$) ]]
}

wait_for_url() {
  local i
  for i in $(seq 1 120); do
    if curl -k -sfS --connect-timeout 1 "$URL" -o /dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_local_dev_if_needed() {
  is_local_dev_url || return 0
  if wait_for_url; then
    return 0
  fi
  mkdir -p "${HOME}/.cache"
  pidf="${HOME}/.cache/helles-dev.pid"
  if [[ -f "$pidf" ]]; then
    old="$(cat "$pidf" 2>/dev/null || true)"
    if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
      if wait_for_url; then
        return 0
      fi
    fi
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Helles: npm nicht gefunden — bitte Node/npm installieren." >&2
    exit 1
  fi
  cd "$ROOT"
  echo "$(date -Iseconds) starting npm run dev" >>"${HOME}/.cache/helles-dev.log"
  nohup npm run dev >>"${HOME}/.cache/helles-dev.log" 2>&1 &
  echo $! >"$pidf"
  if ! wait_for_url; then
    echo "Helles: Dev-Server startet nicht rechtzeitig — Log: ${HOME}/.cache/helles-dev.log" >&2
    exit 1
  fi
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$URL" >/dev/null 2>&1 &
  elif command -v x-www-browser >/dev/null 2>&1; then
    x-www-browser "$URL" >/dev/null 2>&1 &
  else
    echo "Kein xdg-open / Browser-Starter gefunden." >&2
    exit 1
  fi
}

start_local_dev_if_needed
open_browser
