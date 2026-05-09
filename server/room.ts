import crypto from "node:crypto";

const KEY_BYTES = 32;

/** Fresh 32-byte AES key. Held only in process memory — never written to disk. */
export function rotateRoomKey(): Buffer {
  return crypto.randomBytes(KEY_BYTES);
}

export function roomKeyBase64Url(key: Buffer): string {
  return key.toString("base64url");
}
