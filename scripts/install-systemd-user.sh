#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
UNIT="$UNIT_DIR/helles.service"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Fehlt: $ROOT/.env — bitte aus .env.example anlegen." >&2
  exit 1
fi
if [[ ! -f "$ROOT/dist/server/index.js" ]]; then
  echo "Fehlt Build: $ROOT/dist/server/index.js — zuerst: npm run build" >&2
  exit 1
fi

cat >"$UNIT" <<EOF
[Unit]
Description=Helles home LAN hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$ROOT/.env
Environment=NODE_ENV=production
ExecStart=$NODE $ROOT/dist/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
echo "Installiert: $UNIT"
echo "Aktivieren mit: systemctl --user enable --now helles.service"
echo "Status:         systemctl --user status helles.service"
echo "Logs:           journalctl --user -u helles.service -f"
echo ""
echo "Hinweis: Dienst auch ohne angemeldete GUI starten:"
echo "  loginctl enable-linger $USER"
