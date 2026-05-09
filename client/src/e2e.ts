/** Eigener `ArrayBuffer` (Kopie), damit Web Crypto / TS nicht über SharedArrayBuffer stolpern. */
function abFromU8(u8: Uint8Array): ArrayBuffer {
  const c = new Uint8Array(u8.byteLength);
  c.set(u8);
  return c.buffer;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", abFromU8(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function getCryptoKey(material: Uint8Array): Promise<CryptoKey> {
  return importAesKey(material);
}

export async function sealText(key: CryptoKey, plain: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const pt = new TextEncoder().encode(plain);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: abFromU8(iv) }, key, abFromU8(pt))
  );
  const b64u = (buf: Uint8Array) => {
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return JSON.stringify({ v: 1, iv: b64u(iv), d: b64u(ct) });
}

export async function openText(key: CryptoKey, body: string): Promise<string | null> {
  const b64uToU8 = (s: string): Uint8Array | null => {
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
  };
  try {
    const o = JSON.parse(body) as { v?: number; iv?: string; d?: string };
    if (o.v !== 1 || !o.iv || !o.d) return null;
    const iv = b64uToU8(o.iv);
    const ct = b64uToU8(o.d);
    if (!iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: abFromU8(iv) }, key, abFromU8(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export async function sealBytes(key: CryptoKey, plain: ArrayBuffer): Promise<{ iv: string; ct: Uint8Array }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const b64u = (buf: Uint8Array) => {
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: abFromU8(iv) }, key, abFromU8(new Uint8Array(plain)))
  );
  return { iv: b64u(iv), ct };
}

export async function openBytes(key: CryptoKey, ivB64: string, ct: ArrayBuffer): Promise<ArrayBuffer | null> {
  const b64uToU8 = (s: string): Uint8Array | null => {
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
  };
  try {
    const iv = b64uToU8(ivB64);
    if (!iv) return null;
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: abFromU8(iv) }, key, abFromU8(new Uint8Array(ct)));
  } catch {
    return null;
  }
}
