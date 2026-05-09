import { createRoot } from "react-dom/client";
import { SecureContextGate } from "./SecureContextGate";
import "./styles.css";

/** Vite + @vitejs/plugin-basic-ssl: ohne https zeigen YouTube-Embeds oft „Video nicht verfügbar“. */
if (
  typeof location !== "undefined" &&
  location.protocol === "http:" &&
  (location.hostname === "127.0.0.1" || location.hostname === "localhost")
) {
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
}

createRoot(document.getElementById("root")!).render(<SecureContextGate />);
