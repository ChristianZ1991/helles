#!/usr/bin/env bash
# Zeigt, ob Helles/Vite auf allen Interfaces lauschen (0.0.0.0) oder nur localhost.
set -euo pipefail
echo "=== TCP: Helles / Vite / Node (3847, 3848, 5173) ==="
ss -tlnp 2>/dev/null | grep -E ':3847|:3848|:5173' || echo "(nichts gefunden)"
echo ""
echo "Erwartung im LAN: Zeilen mit 0.0.0.0:<port> oder *:<port>."
echo "Nur 127.0.0.1:<port> → HELLES_HOST in .env auf 0.0.0.0 setzen (nicht 127.0.0.1)."
echo "0.0.0.0 aber anderer PC kommt nicht ran → Firewall auf DIESEM Rechner (siehe /join)."
