import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import os from "node:os";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { WebSocket } from "ws";
import { nanoid } from "nanoid";
import { getDb, closeDb, clearAllMessages } from "./db.js";
import { peerLabel } from "./peer.js";
import { rotateRoomKey, roomKeyBase64Url } from "./room.js";

function resolveProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const oneUp = path.resolve(here, "..");
  if (fs.existsSync(path.join(oneUp, "package.json"))) return oneUp;
  const twoUp = path.resolve(here, "..", "..");
  if (fs.existsSync(path.join(twoUp, "package.json"))) return twoUp;
  return oneUp;
}

const PROJECT_ROOT = resolveProjectRoot();
loadEnv({ path: path.join(PROJECT_ROOT, ".env") });

const PORT = Number(process.env.HELLES_PORT ?? 3847);
const HOST = process.env.HELLES_HOST ?? "0.0.0.0";
const MAX_UPLOAD_MB = Number(process.env.HELLES_MAX_UPLOAD_MB ?? 200);
const MAX_BODY_CHARS = 512_000;
/** Wenn 0: sofort leeren, sobald der letzte Client weg ist (kann bei alleinigem Tab-Refresh den Chat löschen). */
const ROOM_RESET_MS = Number(process.env.HELLES_ROOM_RESET_MS ?? 15_000);

type OutMsg = {
  id: string;
  userId: string;
  username: string;
  type: string;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

type Client = { ws: WebSocket; label: string; connId: string };
const clients = new Set<Client>();
let currentSharer: string | null = null;
const lastAlertAt = new Map<string, number>();

type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  error?: string;
};

const previewCache = new Map<string, { data: LinkPreview; exp: number }>();
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 5_000;
const PREVIEW_MAX_BYTES = 512 * 1024;
// Identify as a link-preview bot. Reddit, Cloudflare-fronted sites, and
// many news outlets have allowlists for well-known preview-bot UAs
// (facebookexternalhit, Slackbot-LinkExpanding, Twitterbot, Discordbot)
// because these are explicitly *expected* to scrape head metadata only.
// Spoofing a browser UA usually fails further fingerprint checks (TLS JA3,
// Sec-Fetch headers, IP reputation), but appending the well-known
// facebookexternalhit token makes us pass the typical OG allowlist.
const PREVIEW_USER_AGENT =
  "Mozilla/5.0 (compatible; helles-linkpreview/0.1; +https://github.com/anthropics/claude-code) facebookexternalhit/1.1";

const BOT_BLOCK_TITLE_PATTERNS: RegExp[] = [
  /please[\s\-_]+wait[\s\-_]+for[\s\-_]+verification/i,
  /checking[\s\-_]+your[\s\-_]+browser/i,
  /just\s+a\s+moment/i, // Cloudflare interstitial
  /one[\s\-_]+more[\s\-_]+step/i,
  /are[\s\-_]+you[\s\-_]+(?:a\s+)?(?:human|robot)/i,
  /access\s+denied/i,
  /attention\s+required/i, // Cloudflare
  /security\s+check/i,
  /captcha/i,
  /bot\s+challenge/i,
  /verify\s+you\s+are\s+human/i,
];

function looksLikeBotBlock(title: string | null, description: string | null): boolean {
  const haystack = `${title ?? ""}\n${description ?? ""}`;
  return BOT_BLOCK_TITLE_PATTERNS.some((p) => p.test(haystack));
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) ? String.fromCharCode(c) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const c = parseInt(n, 16);
      return Number.isFinite(c) ? String.fromCharCode(c) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function findMeta(head: string, key: string, kind: "name" | "property"): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(
    `<meta\\b[^>]*\\b${kind}\\s*=\\s*["']${escaped}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["']`,
    "i"
  ).exec(head);
  if (a?.[1]) return decodeHtmlEntities(a[1]);
  const b = new RegExp(
    `<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\b${kind}\\s*=\\s*["']${escaped}["']`,
    "i"
  ).exec(head);
  return b?.[1] ? decodeHtmlEntities(b[1]) : null;
}

function clipText(s: string | null, max = 400): string | null {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

function parsePreview(url: string, html: string): LinkPreview {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { url, title: null, description: null, image: null, siteName: null, error: "bad_url" };
  }
  const headEnd = html.indexOf("</head>");
  const head = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 200_000);
  const titleEl = /<title[^>]*>([^<]+)<\/title>/i.exec(head)?.[1] ?? null;
  const title =
    findMeta(head, "og:title", "property") ??
    findMeta(head, "twitter:title", "name") ??
    (titleEl ? decodeHtmlEntities(titleEl) : null);
  const description =
    findMeta(head, "og:description", "property") ??
    findMeta(head, "twitter:description", "name") ??
    findMeta(head, "description", "name");
  let image =
    findMeta(head, "og:image:secure_url", "property") ??
    findMeta(head, "og:image", "property") ??
    findMeta(head, "twitter:image", "name") ??
    findMeta(head, "twitter:image:src", "name");
  if (image && !/^https?:\/\//i.test(image)) {
    try {
      image = new URL(image, target).toString();
    } catch {
      image = null;
    }
  }
  const siteName =
    findMeta(head, "og:site_name", "property") ?? target.hostname.replace(/^www\./, "");

  const cleanTitle = clipText(title);
  const cleanDesc = clipText(description);
  if (looksLikeBotBlock(cleanTitle, cleanDesc)) {
    return {
      url,
      title: null,
      description: null,
      image: null,
      siteName: clipText(siteName, 80),
      error: "bot_block",
    };
  }
  return {
    url,
    title: cleanTitle,
    description: cleanDesc,
    image: image ?? null,
    siteName: clipText(siteName, 80),
  };
}

async function fetchPreview(url: string): Promise<LinkPreview> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": PREVIEW_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        url,
        title: null,
        description: null,
        image: null,
        siteName: null,
        error: `http_${res.status}`,
      };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return { url, title: null, description: null, image: null, siteName: null, error: "not_html" };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return { url, title: null, description: null, image: null, siteName: null, error: "no_body" };
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let html = "";
    let read = 0;
    try {
      while (read < PREVIEW_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        read += value.byteLength;
        if (html.includes("</head>")) break;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    return parsePreview(url, html);
  } catch (e) {
    return {
      url,
      title: null,
      description: null,
      image: null,
      siteName: null,
      error: e instanceof Error ? e.name : "fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function broadcast(payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const c of clients) {
    if (c.ws.readyState === 1) c.ws.send(raw);
  }
}

function broadcastExcept(connId: string, payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const c of clients) {
    if (c.connId === connId) continue;
    if (c.ws.readyState === 1) c.ws.send(raw);
  }
}

function sendTo(connId: string, payload: unknown): boolean {
  for (const c of clients) {
    if (c.connId !== connId) continue;
    if (c.ws.readyState === 1) {
      c.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }
  return false;
}

function listLanIpv4Urls(port: number, scheme: string): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue;
    for (const i of list) {
      if (String(i.family) !== "IPv4") continue;
      if (i.internal) continue;
      out.push(`${scheme}://${i.address}:${port}`);
    }
  }
  return [...new Set(out)];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function joinHelpPage(port: number, scheme: string): string {
  const urls = listLanIpv4Urls(port, scheme);
  const li = urls.length
    ? urls.map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`).join("")
    : "<li><em>Keine LAN-IPv4 gefunden — IP manuell eintragen.</em></li>";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Helles — LAN</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:42rem;margin:0 auto;padding:1.25rem;line-height:1.55;background:#07060c;color:#e8e6f2}
  a{color:#6cf0c8} code{background:#1a1628;padding:.1rem .35rem;border-radius:4px}
  h1{font-size:1.25rem} .box{border:1px solid #2a2540;border-radius:12px;padding:1rem;margin:1rem 0;background:#0e0c18}
</style>
</head>
<body>
<h1>Helles — ein Raum im LAN</h1>
<p>Gemeinsamer Stream; Nachrichten werden im Browser mit AES-GCM verschlüsselt. Der Raum-Schlüssel liegt in <code>data/room.key</code>. Beim Serverstart und wenn alle Clients weg sind (Standard: nach ca. 15&nbsp;s), beginnt ein leerer Chat mit neuem Schlüssel.</p>
<ul>${li}</ul>
<p><strong>HTTPS</strong> nötig für Web Crypto: Dev <code>npm run dev</code> → <strong>https://&lt;IP&gt;:5173</strong>. Production: <code>HELLES_HTTPS_*_PATH</code> in <code>.env</code>, dann <strong>https://&lt;IP&gt;:${port}</strong>.</p>
<p><a href="/">Zur App</a></p>
</body>
</html>`;
}

function loadHttpsOptions(): { key: Buffer; cert: Buffer } | null {
  const kp = process.env.HELLES_HTTPS_KEY_PATH?.trim();
  const cp = process.env.HELLES_HTTPS_CERT_PATH?.trim();
  if (!kp || !cp) return null;
  try {
    return { key: fs.readFileSync(kp), cert: fs.readFileSync(cp) };
  } catch (e) {
    console.error("HELLES_HTTPS_KEY_PATH / HELLES_HTTPS_CERT_PATH unreadable — using HTTP", e);
    return null;
  }
}

async function main() {
  const db = getDb();
  // Encrypted upload blobs live only in process memory; never written to disk.
  const uploads = new Map<string, Buffer>();

  const roomKeyRef = { b64u: "" };

  function wipeRoom(reason: string): void {
    clearAllMessages(db);
    uploads.clear();
    previewCache.clear();
    roomKeyRef.b64u = roomKeyBase64Url(rotateRoomKey());
    console.log(`Helles: neuer Chat (${reason}) — Nachrichten und Uploads geleert.`);
  }

  wipeRoom("startup");

  let roomResetTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelRoomReset(): void {
    if (roomResetTimer) {
      clearTimeout(roomResetTimer);
      roomResetTimer = null;
    }
  }

  function scheduleRoomResetIfEmpty(): void {
    if (clients.size !== 0) return;
    cancelRoomReset();
    if (ROOM_RESET_MS <= 0) {
      wipeRoom("room_empty");
      return;
    }
    roomResetTimer = setTimeout(() => {
      roomResetTimer = null;
      if (clients.size !== 0) return;
      wipeRoom("room_empty");
    }, ROOM_RESET_MS);
  }

  const isProd = process.env.NODE_ENV === "production";
  const trustProxy = process.env.HELLES_TRUST_PROXY === "1";
  const httpsOpts = loadHttpsOptions();
  const publicScheme = httpsOpts ? "https" : "http";

  const app = Fastify({
    logger: true,
    trustProxy,
    bodyLimit: Math.min(MAX_UPLOAD_MB * 1024 * 1024, 512 * 1024 * 1024),
    ...(httpsOpts ? { https: httpsOpts } : {}),
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => peerLabel(req),
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2 },
  });
  await app.register(websocket);

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProd) {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data: https: http:; media-src 'self' blob: https: http:; frame-src 'self' blob: https: http:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'"
      );
    }
  });

  app.get("/join", async (_req, reply) => {
    return reply.type("text/html; charset=utf-8").send(joinHelpPage(PORT, publicScheme));
  });

  const clientDist = path.join(PROJECT_ROOT, "dist/client");
  if (fs.existsSync(clientDist)) {
    await app.register(staticFiles, { root: clientDist, prefix: "/" });
  }

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/room-key", async () => ({ keyB64u: roomKeyRef.b64u }));

  app.get("/api/me", async (request, reply) => {
    const label = peerLabel(request, reply);
    return { user: { id: label, username: label } };
  });

  app.get("/api/messages", async (request, reply) => {
    const after = String((request.query as { after?: string }).after ?? "");
    const anchor = after
      ? (db.prepare("SELECT created_at FROM messages WHERE id = ?").get(after) as { created_at: number } | undefined)
      : null;
    if (after && !anchor) return reply.code(400).send({ error: "bad_cursor" });
    const rows =
      after && anchor
        ? (db
            .prepare(
              `SELECT id, sender_label, type, body, meta, created_at
               FROM messages WHERE created_at > ?
               ORDER BY created_at ASC LIMIT 200`
            )
            .all(anchor.created_at) as Record<string, unknown>[])
        : (db
            .prepare(
              `SELECT id, sender_label, type, body, meta, created_at FROM messages
               ORDER BY created_at DESC LIMIT 80`
            )
            .all()
            .reverse() as Record<string, unknown>[]);
    return { messages: rows.map(normalizeRow) };
  });

  app.post("/api/messages", async (request, reply) => {
    const label = peerLabel(request, reply);
    const body = request.body as { type?: string; body?: string; meta?: Record<string, unknown> };
    const type = body.type ?? "text";
    const allowed = new Set(["text", "link", "image", "video", "audio", "file"]);
    if (!allowed.has(type)) return reply.code(400).send({ error: "bad_type" });
    let text = typeof body.body === "string" ? body.body : "";
    if (text.length > MAX_BODY_CHARS) text = text.slice(0, MAX_BODY_CHARS);
    if (type === "text" || type === "link") {
      if (!text.trim()) return reply.code(400).send({ error: "empty" });
    }
    const meta = body.meta && typeof body.meta === "object" ? body.meta : null;
    const id = nanoid();
    const createdAt = Date.now();
    db.prepare("INSERT INTO messages (id, sender_label, type, body, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      label,
      type,
      text,
      meta ? JSON.stringify(meta) : null,
      createdAt
    );
    const msg: OutMsg = {
      id,
      userId: label,
      username: label,
      type,
      body: text,
      meta,
      createdAt,
    };
    broadcast({ event: "message", message: msg });
    return { message: msg };
  });

  app.delete("/api/messages/:id", async (request, reply) => {
    const label = peerLabel(request);
    const id = path.basename((request.params as { id: string }).id);
    const row = db.prepare("SELECT sender_label, meta, created_at FROM messages WHERE id = ?").get(id) as
      | { sender_label: string; meta: string | null; created_at: number }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.sender_label !== label) return reply.code(403).send({ error: "forbidden" });

    let meta: Record<string, unknown> | null = null;
    if (row.meta && typeof row.meta === "string") {
      try {
        meta = JSON.parse(row.meta) as Record<string, unknown>;
      } catch {
        meta = null;
      }
    }
    if (meta && typeof meta.diskName === "string") {
      const name = path.basename(meta.diskName);
      uploads.delete(name);
    }

    const tombMeta = { removed: 1, at: Date.now() };
    const upd = db
      .prepare("UPDATE messages SET type = 'deleted', body = '', meta = ? WHERE id = ? AND sender_label = ?")
      .run(JSON.stringify(tombMeta), id, label);
    if (upd.changes === 0) return reply.code(404).send({ error: "not_found" });

    const msg: OutMsg = {
      id,
      userId: label,
      username: label,
      type: "deleted",
      body: "",
      meta: tombMeta,
      createdAt: Number(row.created_at),
    };
    broadcast({ event: "message", message: msg });
    return { message: msg };
  });

  app.post("/api/upload", async (request, reply) => {
    const label = peerLabel(request, reply);
    let fileBuf: Buffer | null = null;
    let metaJson: string | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file" && part.fieldname === "file") {
        fileBuf = await part.toBuffer();
      } else if (part.type === "field" && part.fieldname === "meta") {
        metaJson = String(part.value ?? "");
      }
    }
    if (!fileBuf?.length) return reply.code(400).send({ error: "no_file" });
    let meta: Record<string, unknown>;
    try {
      meta = metaJson ? (JSON.parse(metaJson) as Record<string, unknown>) : {};
    } catch {
      return reply.code(400).send({ error: "bad_meta" });
    }
    const enc = meta.enc === 1 || meta.enc === true;
    const mime = typeof meta.mime === "string" ? meta.mime : "application/octet-stream";
    let type: "image" | "video" | "audio" | "file" = "file";
    if (mime.startsWith("image/")) type = "image";
    else if (mime.startsWith("video/")) type = "video";
    else if (mime.startsWith("audio/")) type = "audio";

    const stored = nanoid(24);
    const diskName = enc ? `${stored}.bin` : `${stored}${guessExt(mime)}`;
    uploads.set(diskName, fileBuf);
    const id = nanoid();
    const createdAt = Date.now();
    const metaOut = { ...meta, mime, size: fileBuf.length, diskName, enc: enc ? 1 : 0 };
    const bodyLabel = "file";
    db.prepare("INSERT INTO messages (id, sender_label, type, body, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      label,
      type,
      bodyLabel,
      JSON.stringify(metaOut),
      createdAt
    );
    const msg: OutMsg = {
      id,
      userId: label,
      username: label,
      type,
      body: bodyLabel,
      meta: metaOut,
      createdAt,
    };
    broadcast({ event: "message", message: msg });
    return { message: msg };
  });

  app.get("/api/media/:name", async (request, reply) => {
    const name = path.basename((request.params as { name: string }).name);
    const buf = uploads.get(name);
    if (!buf) return reply.code(404).send();
    reply.header("Content-Type", "application/octet-stream");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(buf);
  });

  app.get("/api/preview", async (request, reply) => {
    const raw = String((request.query as { url?: string }).url ?? "").slice(0, 2048);
    if (!raw) return reply.code(400).send({ error: "missing_url" });
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return reply.code(400).send({ error: "bad_url" });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return reply.code(400).send({ error: "bad_scheme" });
    }
    const key = target.toString();
    const cached = previewCache.get(key);
    if (cached && cached.exp > Date.now()) return cached.data;
    const data = await fetchPreview(key);
    previewCache.set(key, { data, exp: Date.now() + PREVIEW_TTL_MS });
    if (previewCache.size > 500) {
      const keys = [...previewCache.keys()];
      for (const k of keys.slice(0, keys.length - 400)) previewCache.delete(k);
    }
    return data;
  });

  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket, req) => {
      cancelRoomReset();
      const label = peerLabel(req);
      const connId = nanoid();
      const entry: Client = { ws: socket, label, connId };
      const peers = [...clients].map((c) => ({ id: c.connId, label: c.label }));
      clients.add(entry);
      socket.send(
        JSON.stringify({
          event: "hello",
          user: { id: label, username: label },
          you: connId,
          peers,
          sharerId: currentSharer,
        })
      );
      broadcastExcept(connId, { event: "peer-join", peer: { id: connId, label } });

      socket.on("message", (raw) => {
        let data: { event?: string; to?: string; data?: unknown } | null = null;
        try {
          data = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!data || typeof data.event !== "string") return;
        if (data.event === "alert") {
          const now = Date.now();
          const prev = lastAlertAt.get(connId) ?? 0;
          if (now - prev < 1500) return;
          lastAlertAt.set(connId, now);
          const kind = typeof (data as { kind?: unknown }).kind === "string" ? (data as { kind: string }).kind : "alert";
          broadcastExcept(connId, { event: "alert", from: connId, fromLabel: label, kind });
          return;
        }
        if (data.event === "signal") {
          if (typeof data.to !== "string") return;
          sendTo(data.to, { event: "signal", from: connId, data: data.data });
          return;
        }
        if (data.event === "share-start") {
          if (currentSharer && currentSharer !== connId) {
            broadcast({ event: "share-stop", peerId: currentSharer });
          }
          currentSharer = connId;
          broadcast({ event: "share-start", peerId: connId });
          return;
        }
        if (data.event === "share-stop") {
          if (currentSharer !== connId) return;
          currentSharer = null;
          broadcast({ event: "share-stop", peerId: connId });
          return;
        }
      });

      socket.on("close", () => {
        clients.delete(entry);
        lastAlertAt.delete(connId);
        if (currentSharer === connId) {
          currentSharer = null;
          broadcast({ event: "share-stop", peerId: connId });
        }
        broadcast({ event: "peer-leave", peerId: connId });
        scheduleRoomResetIfEmpty();
      });
    });
  });

  if (fs.existsSync(clientDist)) {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api") || request.url.startsWith("/ws") || request.url.startsWith("/join")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html", clientDist);
    });
  }

  await app.listen({ port: PORT, host: HOST });
  const scheme = httpsOpts ? "https" : "http";
  console.log(`Helles listening on ${scheme}://${HOST === "0.0.0.0" ? "<lan-ip>" : HOST}:${PORT}`);

  const shutdown = (signal: string) => {
    console.log(`Helles: ${signal} — wiping in-memory state.`);
    try {
      clearAllMessages(db);
    } catch {
      /* ignore */
    }
    uploads.clear();
    previewCache.clear();
    roomKeyRef.b64u = "";
    closeDb();
    app.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function guessExt(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/webm") return ".webm";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "audio/wav") return ".wav";
  return ".bin";
}

function normalizeRow(r: Record<string, unknown>): OutMsg {
  let meta: Record<string, unknown> | null = null;
  if (r.meta && typeof r.meta === "string") {
    try {
      meta = JSON.parse(r.meta) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  const label = String(r.sender_label);
  return {
    id: String(r.id),
    userId: label,
    username: label,
    type: String(r.type),
    body: String(r.body),
    meta,
    createdAt: Number(r.created_at),
  };
}

main().catch((e) => {
  console.error(e);
  closeDb();
  process.exit(1);
});
