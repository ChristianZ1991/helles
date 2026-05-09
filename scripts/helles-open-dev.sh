#!/usr/bin/env bash
# Helles im Entwicklungsmodus öffnen (Chat-UI).
# Nutzung:
#   helles-open-dev.sh local          → https://127.0.0.1:5173 , startet bei Bedarf „npm run dev“
#   helles-open-dev.sh remote         → URL aus ~/.config/helles/remote-url (für zweiten Rechner / woanders)
#   helles-open-dev.sh https://…      → beliebige URL; bei 127.0.0.1/localhost wird Dev ggf. gestartet
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_OR_URL="${1:-local}"

notify_error() {
  local msg="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Helles" "$msg" 2>/dev/null || true
  fi
  echo "$msg" >&2
}

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
  open_cmd() {
    local cmd="$1"
    shift
    command -v "$cmd" >/dev/null 2>&1 || return 127
    "$cmd" "$@" >/dev/null 2>&1
  }

  if open_cmd xdg-open "$URL"; then
    return 0
  fi
  if open_cmd gio open "$URL"; then
    return 0
  fi
  if open_cmd sensible-browser "$URL"; then
    return 0
  fi
  if open_cmd x-www-browser "$URL"; then
    return 0
  fi

  notify_error "Kein Browser-Starter gefunden oder Öffnen fehlgeschlagen: ${URL}"
  exit 1
}

start_local_dev_if_needed
open_browser
