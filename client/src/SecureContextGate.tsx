import { StrictMode } from "react";
import { App } from "./App";

/**
 * `crypto.subtle` (für E2EE) existiert nur in „secure contexts“:
 * https:// oder http://localhost — nicht bei http://192.168.x.x
 */
export function SecureContextGate() {
  const ok = typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle != null;
  if (ok) {
    return (
      <StrictMode>
        <App />
      </StrictMode>
    );
  }

  return (
    <div className="mesh" style={{ minHeight: "100dvh" }}>
      <div className="orb a" aria-hidden />
      <div className="orb b" aria-hidden />
      <div className="auth-panel" style={{ marginTop: "10vh" }}>
        <h2>HTTPS erforderlich</h2>
        <p className="sub">
          Die Verschlüsselung im Browser braucht <strong>Web Crypto</strong> — das ist bei einer reinen Adresse wie{" "}
          <code>http://192.168.…</code> aus Sicherheitsgründen abgeschaltet.
        </p>
        <p className="sub">
          <strong>Entwicklung:</strong> <code>npm run dev</code> nutzt jetzt <strong>HTTPS</strong> auf Port 5173. Am zweiten
          PC z. B. <code>https://&lt;IP&gt;:5173</code> öffnen (Zertifikatswarnung einmal akzeptieren).
        </p>
        <p className="sub">
          <strong>Production:</strong> Helles mit TLS starten, z. B. Zertifikat via{" "}
          <a href="https://github.com/FiloSottile/mkcert" target="_blank" rel="noreferrer">
            mkcert
          </a>
          , dann in der <code>.env</code> setzen: <code>HELLES_HTTPS_KEY_PATH</code> und{" "}
          <code>HELLES_HTTPS_CERT_PATH</code> (und Dienst neu starten). Dann <code>https://&lt;IP&gt;:3847</code> verwenden.
        </p>
        <p className="hint">
          Ohne HTTPS auf der LAN-IP kann diese App die E2EE-Funktion hier nicht nutzen.
        </p>
      </div>
    </div>
  );
}
