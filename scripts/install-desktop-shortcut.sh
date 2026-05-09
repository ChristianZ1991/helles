#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
mkdir -p "$DESKTOP"
TARGET="$DESKTOP/Helles.desktop"

chmod +x "$ROOT/scripts/helles-open.sh"

cat >"$TARGET" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Helles
GenericName=Home-Hub
Comment=Helles starten (falls aus) und im Browser öffnen
Exec=$ROOT/scripts/helles-open.sh
Icon=$ROOT/scripts/helles-icon.svg
Path=$ROOT
Terminal=false
Categories=Network;
Keywords=helles;home;lan;
EOF

chmod +x "$TARGET"
if command -v gio >/dev/null 2>&1; then
  gio set "$TARGET" metadata::trusted true 2>/dev/null || true
fi

echo "Shortcut: $TARGET"
