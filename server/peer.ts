import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";

const COOKIE_NAME = "helles_op";
const CALLSIGN_RE = /^[A-Z]{4,9}-\d{1,3}$/;

const PHONETIC = [
  "ALPHA",
  "BRAVO",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
  "MIKE",
  "NOVEMBER",
  "OSCAR",
  "PAPA",
  "QUEBEC",
  "ROMEO",
  "SIERRA",
  "TANGO",
  "UNIFORM",
  "VICTOR",
  "WHISKEY",
  "XRAY",
  "YANKEE",
  "ZULU",
];

function pickCallsign(): string {
  const buf = randomBytes(2);
  const word = PHONETIC[buf[0] % PHONETIC.length] ?? "ALPHA";
  const num = (buf[1] % 90) + 10;
  return `${word}-${num}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}

function rawIp(req: FastifyRequest): string {
  const raw = req.socket.remoteAddress ?? req.ip ?? "unknown";
  return (typeof raw === "string" ? raw : String(raw)).replace(/^::ffff:/i, "");
}

/**
 * Stable per-browser identifier. For non-loopback connections we surface the
 * source IP (so a real LAN deployment shows the 192.168.x.y address). For
 * loopback we mint a NATO-phonetic callsign (ALPHA-7, ROMEO-42, …) and pin
 * it to a cookie so two tabs on the same host stay distinguishable; the
 * callsign is regenerated on the next browser session, matching the
 * ephemeral-room ethos.
 */
export function peerLabel(req: FastifyRequest, reply?: FastifyReply): string {
  const ip = rawIp(req);
  if (!isLoopback(ip)) return ip.slice(0, 128);
  const cookies = parseCookies(req.headers.cookie);
  let cs = cookies[COOKIE_NAME];
  if (!cs || !CALLSIGN_RE.test(cs)) {
    cs = pickCallsign();
    if (reply) {
      reply.header(
        "Set-Cookie",
        `${COOKIE_NAME}=${encodeURIComponent(cs)}; Path=/; SameSite=Strict; Max-Age=86400`
      );
    }
  }
  return cs;
}
