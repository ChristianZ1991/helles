# Helles

Kleiner LAN-Hub: Chat, Links (mit Video-Einbettung für YouTube, Vimeo und direkte Video-URLs), verschlüsselte Dateien. Nachrichten-Inhalte werden im Browser mit **AES-GCM** verschlüsselt; der Server speichert nur Ciphertext.

## Voraussetzungen

- Node.js 22+ (mit `node:sqlite`)

## Setup

```bash
npm install
cp .env.example .env   # optional
npm run dev          # Client https://…:5173, API z. B. Port 3848
```

Production-Build:

```bash
npm run build
npm start
```

TLS für Web Crypto im LAN: siehe `.env.example` (`HELLES_HTTPS_*`).

## Lizenz

Private Nutzung / nach Bedarf — keine Lizenzdatei gesetzt.
