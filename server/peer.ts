import type { FastifyRequest } from "fastify";

/** Client-Kennung für die UI: bevorzugt IPv4 aus der Socket-Verbindung. */
export function peerLabel(req: FastifyRequest): string {
  const raw = req.socket.remoteAddress ?? req.ip ?? "unknown";
  const s = typeof raw === "string" ? raw : String(raw);
  return s.replace(/^::ffff:/i, "").slice(0, 128);
}
