import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "node:path";

/** Muss mit dem laufenden Helles-Backend übereinstimmen (siehe HELLES_PORT in .env / npm run dev). */
const hellesApiPort = Number(process.env.HELLES_PORT || 3847);
const apiOrigin = `http://127.0.0.1:${hellesApiPort}`;
const wsOrigin = `ws://127.0.0.1:${hellesApiPort}`;

export default defineConfig({
  /** HTTPS nötig: Web Crypto (`importKey`) ist nur in „secure contexts“ — reine http://LAN-IP blockiert das. */
  plugins: [react(), basicSsl()],
  root: "client",
  publicDir: "public",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    https: true,
    host: true,
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    /** false: wenn 5173 belegt ist, nächster freier Port (5174 …) — siehe Konsolen-Ausgabe von Vite */
    strictPort: false,
    proxy: {
      "/api": apiOrigin,
      "/ws": { target: wsOrigin, ws: true },
    },
  },
});
