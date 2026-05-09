import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import type { Message, User } from "./types";
import * as api from "./api";
import { getCryptoKey, openBytes, openText, sealBytes, sealText } from "./e2e";
import { DockedVideoPlayer, LinkRichPreview, parseMediaEmbed } from "./linkEmbed";
import { buildZipFromFiles } from "./zipBundle";

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

function EncryptedFileDownload(props: { ckey: CryptoKey; m: Message; displayName: string }) {
  const { ckey, m, displayName } = props;
  const meta = m.meta;
  const [busy, setBusy] = useState(false);
  if (!meta || meta.enc !== 1 || typeof meta.diskName !== "string" || typeof meta.ivFile !== "string") return null;

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(mediaUrl(meta.diskName as string));
      const buf = await res.arrayBuffer();
      const plain = await openBytes(ckey, meta.ivFile as string, buf);
      if (!plain) return;
      const mime = (meta.mime as string) || "application/octet-stream";
      const blob = new Blob([plain], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = displayName || "download";
      a.rel = "noopener";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn btn-ghost file-dl-btn" disabled={busy} onClick={() => void run()}>
      {busy ? "…" : "Herunterladen"}
    </button>
  );
}

function MessageNode(props: {
  m: Message;
  ckey: CryptoKey | null;
  meId: string;
  onImageClick: (url: string) => void;
  onDelete: (id: string) => void | Promise<void>;
  deletingId: string | null;
  onPinVideo: (url: string) => void;
}) {
  const { m, ckey, meId, onImageClick, onDelete, deletingId, onPinVideo } = props;
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

  const isOwn = m.userId === meId;

  if (m.type === "deleted") {
    return (
      <article className="node node--tombstone">
        <div className="node-meta">
          <span className="node-user">{m.username}</span>
          <span className="node-time-wrap">
            <span className="node-time">{formatTime(m.createdAt)}</span>
          </span>
        </div>
        <p className="node-tombstone-text">Diese Nachricht wurde gelöscht.</p>
      </article>
    );
  }

  return (
    <article className="node">
      <div className="node-meta">
        <span className="node-user">{m.username}</span>
        <span className="node-time-wrap">
          <span className="node-time">{formatTime(m.createdAt)}</span>
          {isOwn ? (
            <button
              type="button"
              className="node-delete-btn"
              disabled={deletingId === m.id}
              aria-label="Nachricht löschen"
              onClick={() => void onDelete(m.id)}
            >
              löschen
            </button>
          ) : null}
        </span>
      </div>
      {m.type === "text" ? <div className="node-body">{text}</div> : null}
      {m.type === "link" ? (
        <div className="link-block">
          {(() => {
            const isHttp = text.startsWith("http://") || text.startsWith("https://");
            const mediaParsed = isHttp ? parseMediaEmbed(text) : null;
            const showInlinePage =
              isHttp &&
              !mediaParsed &&
              (m.meta?.embed === 1 || m.meta?.embed === true);
            return (
              <>
                {isHttp ? (
                  <a
                    className="link-chip"
                    href={text}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (!mediaParsed) return;
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      onPinVideo(text);
                    }}
                  >
                    {text}
                  </a>
                ) : (
                  <span className="node-body">{text}</span>
                )}
                {mediaParsed ? (
                  <span className="hint link-pin-hint">Klick: links anheften · Strg/⌘+Klick: neuer Tab</span>
                ) : null}
                {showInlinePage ? <LinkRichPreview url={text} embedPage /> : null}
              </>
            );
          })()}
        </div>
      ) : null}
      {(m.type === "image" || m.type === "video" || m.type === "audio") && m.meta && ckey ? (
        <div className="node-media">
          <EncryptedMedia ckey={ckey} m={m} kind={m.type as "image" | "video" | "audio"} onImageClick={onImageClick} />
        </div>
      ) : null}
      {m.type === "file" ? (
        <div className="node-file-block">
          <div className="node-body">{fname}</div>
          {m.meta?.bundle === 1 && typeof m.meta.fileCount === "number" ? (
            <p className="hint" style={{ margin: "6px 0 0" }}>
              Archiv mit {m.meta.fileCount} Datei{m.meta.fileCount === 1 ? "" : "en"} (ZIP)
            </p>
          ) : null}
          {m.meta?.enc === 1 && ckey ? <EncryptedFileDownload ckey={ckey} m={m} displayName={fname} /> : null}
        </div>
      ) : null}
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinnedVideoUrl, setPinnedVideoUrl] = useState<string | null>(null);
  const [dockW, setDockW] = useState(() => {
    try {
      const s = sessionStorage.getItem("hellesDockW");
      if (s) {
        const n = Number(s);
        if (Number.isFinite(n)) return Math.min(720, Math.max(220, Math.round(n)));
      }
    } catch {
      /* ignore */
    }
    return 380;
  });
  const [streamH, setStreamH] = useState(() => {
    try {
      const s = sessionStorage.getItem("hellesStreamH");
      if (s) {
        const n = Number(s);
        if (Number.isFinite(n)) return Math.min(900, Math.max(140, Math.round(n)));
      }
    } catch {
      /* ignore */
    }
    return typeof window !== "undefined" ? Math.min(560, Math.max(220, Math.round(window.innerHeight * 0.38))) : 360;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const appLayoutRef = useRef<HTMLDivElement>(null);
  const mainSplitRef = useRef<HTMLDivElement>(null);

  const onPinVideo = useCallback((url: string) => {
    setPinnedVideoUrl(url.trim());
  }, []);

  const startDockResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = dockW;
      const layout = appLayoutRef.current;
      let last = startW;
      const onMove = (ev: MouseEvent) => {
        const maxDock = layout ? Math.floor(layout.clientWidth * 0.78) : 900;
        const next = Math.round(startW + (ev.clientX - startX));
        last = Math.min(maxDock, Math.max(220, next));
        setDockW(last);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          sessionStorage.setItem("hellesDockW", String(last));
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [dockW]
  );

  const startMainResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = streamH;
      const wrap = mainSplitRef.current;
      let last = startH;
      const onMove = (ev: MouseEvent) => {
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        const maxH = Math.floor(rect.height - 140);
        const next = Math.round(startH + (ev.clientY - startY));
        last = Math.min(maxH, Math.max(120, next));
        setStreamH(last);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          sessionStorage.setItem("hellesStreamH", String(last));
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [streamH]
  );

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
      const i = prev.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = m;
        return next.sort((a, b) => a.createdAt - b.createdAt);
      }
      return [...prev, m].sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleDeleteMessage = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const tomb = await api.deleteMessage(id);
        mergeMessage(tomb);
      } catch {
        /* noop */
      } finally {
        setDeletingId((cur) => (cur === id ? null : cur));
      }
    },
    [mergeMessage]
  );

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
          const data = JSON.parse(String(ev.data)) as { event?: string; message?: Message; id?: string };
          if (data.event === "message" && data.message) mergeMessage(data.message);
          if (data.event === "message_deleted" && typeof data.id === "string") removeMessage(data.id);
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
  }, [user, mergeMessage, removeMessage]);

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

  const uploadEncryptedBytes = useCallback(
    async (
      plain: ArrayBuffer,
      displayName: string,
      mime: string,
      extraMeta?: Record<string, unknown>
    ) => {
      if (!ckey) return;
      const nameJson = await sealText(ckey, displayName);
      const nameParts = JSON.parse(nameJson) as { iv: string; d: string };
      const { iv: ivFile, ct } = await sealBytes(ckey, plain);
      const meta = JSON.stringify({
        enc: 1,
        mime,
        ivName: nameParts.iv,
        nameCt: nameParts.d,
        ivFile,
        ...(extraMeta ?? {}),
      });
      const { message } = await api.uploadEncryptedFile(meta, new Blob([new Uint8Array(ct)]));
      mergeMessage(message);
    },
    [ckey, mergeMessage]
  );

  const onPickFiles = async (list: FileList | null) => {
    if (!list?.length || !ckey) return;
    const files = Array.from(list);
    try {
      const singleFlat = files.length === 1 && !files[0]!.webkitRelativePath;
      if (singleFlat) {
        const f = files[0]!;
        await uploadEncryptedBytes(await f.arrayBuffer(), f.name, f.type || "application/octet-stream");
      } else {
        const { u8, archiveName } = await buildZipFromFiles(files);
        const copy = new Uint8Array(u8.byteLength);
        copy.set(u8);
        await uploadEncryptedBytes(copy.buffer, archiveName, "application/zip", {
          bundle: 1,
          fileCount: files.length,
        });
      }
    } catch {
      /* noop */
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
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
      <div className={`app-root${pinnedVideoUrl ? " app-root--docked" : ""}`} ref={appLayoutRef}>
        {pinnedVideoUrl ? (
          <aside className="video-dock" style={{ width: dockW }}>
            <div className="video-dock-head">
              <span className="video-dock-title">Video</span>
              <button
                type="button"
                className="video-dock-close"
                aria-label="Video-Panel schließen"
                onClick={() => setPinnedVideoUrl(null)}
              >
                ×
              </button>
            </div>
            <div className="video-dock-body">
              <DockedVideoPlayer url={pinnedVideoUrl} />
            </div>
          </aside>
        ) : null}
        {pinnedVideoUrl ? (
          <div
            className="splitter splitter--ew"
            role="separator"
            aria-orientation="vertical"
            aria-label="Video-Breite anpassen"
            onMouseDown={startDockResize}
          />
        ) : null}

        <div className="shell shell--in-app">
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
            Ephemerer Raum: beim Serverstart und wenn niemand mehr verbunden ist (kurze Pause), ist der Verlauf weg und
            es gibt einen neuen Schlüssel. AES-GCM im Browser; der Hub speichert nur Ciphertext. YouTube/Vimeo/Video-URL:
            Klick auf den Link heftet links an. Siehe <code>/join</code>.
          </div>

          <div className="main-split" ref={mainSplitRef}>
            <section
              className="stream stream--sized"
              aria-label="messages"
              style={{ height: streamH, flex: "none", minHeight: 120 }}
            >
              <div className="stream-scroll" ref={scrollRef}>
                {messages.map((m) => (
                  <MessageNode
                    key={m.id}
                    m={m}
                    ckey={ckey}
                    meId={user.id}
                    onImageClick={setLightbox}
                    onDelete={handleDeleteMessage}
                    deletingId={deletingId}
                    onPinVideo={onPinVideo}
                  />
                ))}
              </div>
            </section>

            <div
              className="splitter splitter--ns"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Chat-Höhe anpassen"
              onMouseDown={startMainResize}
            />

            <footer className="composer composer--in-split">
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
              Dateien
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => folderRef.current?.click()}>
              Ordner
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setLinkOpen((v) => !v)}>
              link
            </button>
            <span className="hint" style={{ marginLeft: "auto" }}>
              ZIP/Ordner · Video-Link: Klick = links · Balken = Größe Chat/Composer
            </span>
          </div>
          <input
            ref={fileRef}
            className="hidden-input"
            type="file"
            multiple
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <input
            ref={folderRef}
            className="hidden-input"
            type="file"
            multiple
            {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)}
            onChange={(e) => void onPickFiles(e.target.files)}
          />
            </footer>
          </div>
        </div>
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
