import type { Message, User } from "./types";

function b64uToU8(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "request_failed");
  return data;
}

export async function fetchRoomKey(): Promise<Uint8Array> {
  const res = await fetch("/api/room-key");
  let data: { keyB64u?: string; error?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(data.error ?? "room_key_failed");
  }
  const k = data.keyB64u ? b64uToU8(data.keyB64u) : null;
  if (!k || k.length !== 32) throw new Error("bad_room_key");
  return k;
}

export async function getMe(): Promise<{ user: User }> {
  const res = await fetch("/api/me");
  return parse(res);
}

export async function fetchMessages(): Promise<Message[]> {
  const res = await fetch("/api/messages");
  const data = await parse<{ messages: Message[] }>(res);
  return data.messages;
}

export async function sendText(body: string): Promise<{ message: Message }> {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "text", body }),
  });
  return parse(res);
}

export async function sendLink(
  url: string,
  meta?: Record<string, unknown>
): Promise<{ message: Message }> {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "link", body: url, ...(meta ? { meta } : {}) }),
  });
  return parse(res);
}

export async function uploadEncryptedFile(meta: string, cipherBlob: Blob): Promise<{ message: Message }> {
  const fd = new FormData();
  fd.append("meta", meta);
  fd.append("file", cipherBlob, "blob");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  return parse(res);
}

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  error?: string;
};

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
  return parse(res);
}
