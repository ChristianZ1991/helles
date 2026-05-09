import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message, User } from "./types";
import * as api from "./api";
import { getCryptoKey, openBytes, openText, sealBytes, sealText } from "./e2e";
import { LinkRichPreview } from "./linkEmbed";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mediaUrl(diskName: string): string {
  return `/api/media/${encodeURIComponent(diskName)}`;
}

function useDecryptedText(ckey: CryptoKey | null, body: string, isCipher: boolean): string {
  const [t, setT] = useState(() => (isCipher ? "…" : body));
  useEffect(() => {
    if (!ckey || !isCipher) {
      setT(body);
      return;
    }
    let c = false;
    openText(ckey, body).then((p) => {
      if (c) return;
      if (p !== null) setT(p);
      else setT(body.trim().startsWith("{") ? "[cannot decrypt]" : body);
    });
    return () => {
      c = true;
    };
  }, [ckey, body, isCipher]);
  return t;
}

function EncryptedMedia(props: {
  ckey: CryptoKey;
  m: Message;
  kind: "image" | "video" | "audio";
  onImageClick?: (url: string) => void;
}) {
  const { ckey, m, kind, onImageClick } = props;
  const [src, setSrc] = useState<string | null>(null);
  const meta = m.meta;

  useEffect(() => {
    if (!meta || meta.enc !== 1 || typeof meta.diskName !== "string" || typeof meta.ivFile !== "string") return;
    let cancelled = false;
    let blobUrl = "";
    (async () => {
      const res = await fetch(mediaUrl(meta.diskName as string));
      const buf = await res.arrayBuffer();
      const plain = await openBytes(ckey, meta.ivFile as string, buf);
      if (cancelled || !plain) return;
      const mime = (meta.mime as string) || "application/octet-stream";
      const blob = new Blob([plain], { type: mime });
      blobUrl = URL.createObjectURL(blob);
      setSrc(blobUrl);
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [ckey, m.id, meta]);

  if (!src) return <div className="hint">loading…</div>;
  if (kind === "image")
    return (
      <button
        type="button"
        style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in", width: "100%" }}
        onClick={() => onImageClick?.(src)}
      >
        <img src={src} alt="" loading="lazy" />
      </button>
    );
  if (kind === "video") return <video src={src} controls playsInline />;
  return <audio src={src} controls />;
}

function MessageNode(props: {
  m: Message;
  ckey: CryptoKey | null;
  onImageClick: (url: string) => void;
}) {
  const { m, ckey, onImageClick } = props;
  const isCipher = m.type === "text" || m.type === "link";
  const text = useDecryptedText(ckey, m.body, isCipher);

  const [fname, setFname] = useState(m.body);
  useEffect(() => {
    if (!ckey || !m.meta || m.meta.enc !== 1) {
      setFname(m.body);
      return;
    }
    const iv = m.meta.ivName as string | undefined;
    const d = m.meta.nameCt as string | undefined;
    if (!iv || !d) {
      setFname(m.body);
      return;
    }
    openText(ckey, JSON.stringify({ v: 1, iv, d })).then((n) => setFname(n ?? m.body));
  }, [ckey, m.body, m.meta, m.type]);

  return (
    <article className="node">
      <div className="node-meta">
        <span className="node-user">{m.username}</span>
        <span className="node-time">{formatTime(m.createdAt)}</span>
      </div>
      {m.type === "text" ? <div className="node-body">{text}</div> : null}
      {m.type === "link" ? (
        <div className="link-block">
          {text.startsWith("http://") || text.startsWith("https://") ? (
            <a className="link-chip" href={text} target="_blank" rel="noreferrer">
              {text}
            </a>
          ) : (
            <span className="node-body">{text}</span>
          )}
          {text.startsWith("http://") || text.startsWith("https://") ? (
            <LinkRichPreview
              url={text}
              embedPage={m.meta?.embed === 1 || m.meta?.embed === true}
            />
          ) : null}
        </div>
      ) : null}
      {(m.type === "image" || m.type === "video" || m.type === "audio") && m.meta && ckey ? (
        <div className="node-media">
          <EncryptedMedia ckey={ckey} m={m} kind={m.type as "image" | "video" | "audio"} onImageClick={onImageClick} />
        </div>
      ) : null}
      {m.type === "file" ? <div className="node-body">{fname}</div> : null}
    </article>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ckey, setCkey] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [embedPageInLink, setEmbedPageInLink] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [wsOn, setWsOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await api.fetchRoomKey();
        const k = await getCryptoKey(raw);
        if (cancelled) return;
        setCkey(k);
        const { user: u } = await api.getMe();
        if (!cancelled) setUser(u);
      } catch (e) {
        if (!cancelled) setBootErr(e instanceof Error ? e.message : "boot_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mergeMessage = useCallback((m: Message) => {
    setMessages((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev;
      return [...prev, m].sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => {
        attempt = 0;
        setWsOn(true);
      };
      ws.onclose = () => {
        setWsOn(false);
        attempt += 1;
        const delay = Math.min(10_000, 500 + attempt * 400);
        timer = setTimeout(connect, delay);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as { event?: string; message?: Message };
          if (data.event === "message" && data.message) mergeMessage(data.message);
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      clearTimeout(timer);
      ws?.close();
    };
  }, [user, mergeMessage]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api.fetchMessages();
        if (!cancelled) setMessages(list);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const sendChat = async () => {
    if (!ckey) return;
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    try {
      const sealed = await sealText(ckey, t);
      const { message } = await api.sendText(sealed);
      mergeMessage(message);
    } catch {
      setDraft(t);
    }
  };

  const sendLink = async () => {
    if (!ckey) return;
    const u = linkDraft.trim();
    if (!u) return;
    setLinkDraft("");
    setLinkOpen(false);
    const wantEmbed = embedPageInLink;
    setEmbedPageInLink(false);
    try {
      const sealed = await sealText(ckey, u);
      const { message } = await api.sendLink(sealed, wantEmbed ? { embed: 1 } : undefined);
      mergeMessage(message);
    } catch {
      setLinkDraft(u);
      setLinkOpen(true);
      setEmbedPageInLink(wantEmbed);
    }
  };

  const onPickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !ckey) return;
    try {
      const nameJson = await sealText(ckey, f.name);
      const nameParts = JSON.parse(nameJson) as { iv: string; d: string };
      const buf = await f.arrayBuffer();
      const { iv: ivFile, ct } = await sealBytes(ckey, buf);
      const meta = JSON.stringify({
        enc: 1,
        mime: f.type || "application/octet-stream",
        ivName: nameParts.iv,
        nameCt: nameParts.d,
        ivFile,
      });
      const { message } = await api.uploadEncryptedFile(meta, new Blob([new Uint8Array(ct)]));
      mergeMessage(message);
    } catch {
      /* noop */
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const presence = useMemo(
    () => (
      <span className="hint">
        <span className={`status-dot ${wsOn ? "on" : ""}`} />
        {wsOn ? "live" : "connecting…"}
      </span>
    ),
    [wsOn]
  );

  if (loading) {
    return (
      <>
        <div className="mesh" aria-hidden>
          <div className="orb a" />
          <div className="orb b" />
        </div>
        <div className="shell" style={{ justifyContent: "center" }}>
          <p className="hint">connecting to room…</p>
        </div>
      </>
    );
  }

  if (bootErr || !ckey || !user) {
    return (
      <>
        <div className="mesh" aria-hidden>
          <div className="orb a" />
          <div className="orb b" />
        </div>
        <div className="auth-panel" style={{ marginTop: "8vh" }}>
          <h2>Keine Verbindung</h2>
          <p className="sub">{bootErr ?? "unknown"}</p>
          <p className="hint">
            Prüfe, ob der Helles-Server läuft und die Seite über <strong>HTTPS</strong> erreichbar ist (Web Crypto). Bei
            LAN-Zugriff: <code>npm run dev</code> nutzt HTTPS auf Port 5173, oder Production mit{" "}
            <code>HELLES_HTTPS_KEY_PATH</code> / <code>HELLES_HTTPS_CERT_PATH</code>.
          </p>
          <a className="btn" href="/join" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            Hilfe
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mesh" aria-hidden>
        <div className="orb a" />
        <div className="orb b" />
      </div>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <h1>Helles</h1>
            <p>
              LAN · AES-GCM · you as <strong>{user.username}</strong>
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {presence}
            <a className="pill" href="/join" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              help
            </a>
          </div>
        </header>

        <div className="box" style={{ marginBottom: 12, fontSize: "0.85rem", color: "var(--muted)" }}>
          Ephemerer Raum: beim Serverstart und wenn niemand mehr verbunden ist (kurze Pause), ist der Verlauf weg und es
          gibt einen neuen Schlüssel. AES-GCM im Browser; der Hub speichert nur Ciphertext. Siehe <code>/join</code>.
        </div>

        <section className="stream" aria-label="messages">
          <div className="stream-scroll" ref={scrollRef}>
            {messages.map((m) => (
              <MessageNode key={m.id} m={m} ckey={ckey} onImageClick={setLightbox} />
            ))}
          </div>
        </section>

        <footer className="composer">
          {linkOpen ? (
            <div className="composer-col">
              <div className="composer-row">
                <input
                  className="input"
                  style={{ flex: 1, minHeight: 48 }}
                  placeholder="YouTube, Vimeo, .mp4/… oder HTTPS-Seite"
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendLink();
                  }}
                />
                <button type="button" className="btn" onClick={() => void sendLink()}>
                  drop link
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setLinkOpen(false);
                    setEmbedPageInLink(false);
                  }}
                >
                  cancel
                </button>
              </div>
              <label className="embed-page-toggle">
                <input
                  type="checkbox"
                  checked={embedPageInLink}
                  onChange={(e) => setEmbedPageInLink(e.target.checked)}
                />
                Seite per iframe einbetten (Mini-Ansicht; viele Seiten erlauben das nicht)
              </label>
            </div>
          ) : null}
          <div className="composer-row">
            <textarea
              className="input"
              placeholder="encrypted message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            <button type="button" className="btn" onClick={() => void sendChat()} disabled={!draft.trim()}>
              send
            </button>
          </div>
          <div className="composer-row">
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              attach
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setLinkOpen((v) => !v)}>
              link
            </button>
            <span className="hint" style={{ marginLeft: "auto" }}>
              Shift+Enter newline
            </span>
          </div>
          <input
            ref={fileRef}
            className="hidden-input"
            type="file"
            accept="image/*,video/*,audio/*,*/*"
            onChange={(e) => void onPickFile(e.target.files)}
          />
        </footer>
      </div>

      {lightbox ? (
        <button
          type="button"
          className="modal-back"
          aria-label="close"
          onClick={() => setLightbox(null)}
          style={{ border: "none", cursor: "zoom-out" }}
        >
          <div className="modal">
            <img src={lightbox} alt="" />
          </div>
        </button>
      ) : null}
    </>
  );
}
