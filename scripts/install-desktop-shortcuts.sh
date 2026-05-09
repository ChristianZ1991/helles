#!/usr/bin/env bash
# Zwei Desktop-Verknüpfungen: „dieser PC“ (startet ggf. npm run dev) und „woanders“ (URL aus ~/.config/helles/remote-url).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/helles"
mkdir -p "$DESKTOP" "$CFG"

chmod +x "$ROOT/scripts/helles-open-dev.sh"
chmod +x "$ROOT/scripts/helles-open.sh" 2>/dev/null || true

if [[ ! -f "$CFG/remote-url" ]]; then
  cat >"$CFG/remote-url" <<'EOF'
# Ziel-URL, wenn du dich vom zweiten Rechner aus einloggst (Vite-HTTPS, Port meist 5173).
# Beispiel: Rechner A führt „npm run dev“ aus — hier die LAN-Adresse von A eintragen:
https://192.168.0.10:5173
EOF
fi

write_desktop() {
  local name="$1" generic="$2" comment="$3" execargs="$4" outfile="$5"
  cat >"$outfile" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$name
GenericName=$generic
Comment=$comment
Exec=$ROOT/scripts/helles-open-dev.sh $execargs
Icon=$ROOT/scripts/helles-icon.svg
Path=$ROOT
Terminal=false
Categories=Network;InstantMessaging;
Keywords=helles;chat;lan;
EOF
  chmod +x "$outfile"
  if command -v gio >/dev/null 2>&1; then
    gio set "$outfile" metadata::trusted true 2>/dev/null || true
  fi
  echo "  → $outfile"
}

write_desktop "Helles — dieser PC" "Helles Chat" "Helles starten und hier im Chat öffnen (127.0.0.1)" "local" \
  "$DESKTOP/Helles-dieser-PC.desktop"

write_desktop "Helles — woanders" "Helles Chat" "Helles im Browser öffnen (URL aus ~/.config/helles/remote-url)" "remote" \
  "$DESKTOP/Helles-woanders.desktop"

echo ""
echo "Fertig. Zweiter Rechner: in $CFG/remote-url die https://<IP>:5173 vom ersten PC eintragen."
echo "Hinweis: „dieser PC“ startet bei Bedarf automatisch „npm run dev“ im Projektordner."
