import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_BYTES = 32;

/** Neuer 32-Byte-AES-Rohschlüssel, wird nach `data/room.key` geschrieben (Raum neu / Rotation). */
export function rotateRoomKey(dataDir: string): Buffer {
  fs.mkdirSync(dataDir, { recursive: true });
  const p = path.join(dataDir, "room.key");
  const buf = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(p, buf, { mode: 0o600 });
  console.log(`Neuer Raum-Schlüssel: ${p}`);
  return buf;
}

export function roomKeyBase64Url(key: Buffer): string {
  return key.toString("base64url");
}
