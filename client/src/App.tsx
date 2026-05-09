import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message, User } from "./types";
import * as api from "./api";
import { getCryptoKey, openBytes, openText, sealBytes, sealText } from "./e2e";
import { LinkPreviewCard, LinkRichPreview, parseMediaEmbed } from "./linkEmbed";
import { ShareView, useScreenShare } from "./screenshare";

const URL_PATTERN = /^https?:\/\/\S+$/i;
function isPureUrl(s: string): boolean {
  if (!URL_PATTERN.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M8 3v10M3 8h10" strokeLinecap="square" />
    </svg>
  );
}

function IconScreen() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      <rect x="2" y="3" width="12" height="8.5" strokeLinejoin="miter" />
      <path d="M5.5 14h5M8 11.5V14" strokeLinecap="square" />
      <path d="M8 9.5V5.6M6.1 7.5L8 5.6 9.9 7.5" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

type Attachment = { id: string; file: File; previewUrl: string | null };

function makeAttachment(file: File): Attachment {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  return { id, file, previewUrl };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function attachKindTag(file: File): string {
  if (file.type.startsWith("image/")) return "IMG";
  if (file.type.startsWith("video/")) return "VID";
  if (file.type.startsWith("audio/")) return "SND";
  const ext = file.name.split(".").pop();
  return (ext ?? "BIN").toUpperCase().slice(0, 4);
}

function AttachChip(props: { att: Attachment; onRemove: (id: string) => void; pending?: boolean }) {
  const { att, onRemove, pending } = props;
  return (
    <div className={`attach-chip${pending ? " pending" : ""}`} role="listitem">
      <div className="attach-thumb">
        {att.previewUrl ? (
          <img src={att.previewUrl} alt="" />
        ) : (
          <span className="attach-kind">{attachKindTag(att.file)}</span>
        )}
      </div>
      <div className="attach-meta">
        <span className="attach-name" title={att.file.name}>
          {att.file.name}
        </span>
        <span className="attach-size">{formatBytes(att.file.size)}</span>
      </div>
      <button
        type="button"
        className="attach-x"
        aria-label="remove attachment"
        title="remove"
        onClick={() => onRemove(att.id)}
        disabled={pending}
      >
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="square" />
        </svg>
      </button>
    </div>
  );
}

function LinkBlock(props: { url: string }) {
  const { url } = props;
  const isHttp = url.startsWith("http://") || url.startsWith("https://");
  const mediaKind = isHttp ? parseMediaEmbed(url) : null;
  const [expanded, setExpanded] = useState<boolean>(!!mediaKind);

  if (!isHttp) return <span className="node-body">{url}</span>;

  return (
    <div className="link-block">
      <div className="link-row">
        <a className="link-chip" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <button
          type="button"
          className={`link-toggle${expanded ? " on" : ""}`}
          onClick={() => setExpanded((v) => !v)}
          aria-pressed={expanded}
          title={expanded ? "collapse preview" : "expand preview"}
        >
          <span className="link-toggle-glyph" aria-hidden>
            {expanded ? "▣" : "▢"}
          </span>
          <span className="link-toggle-label">embed</span>
        </button>
      </div>
      {expanded ? mediaKind ? <LinkRichPreview url={url} /> : <LinkPreviewCard url={url} /> : null}
    </div>
  );
}

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

function fmtTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onDur = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setTime(a.duration || 0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
  };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    seekFromClientX(e.clientX, rect);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX, rect);
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
  const pct = `${ratio * 100}%`;

  return (
    <div className={`audio-player${playing ? " is-playing" : ""}`}>
      <div className="audio-head">
        <span className="audio-tag">▮ AUDIO INTERCEPT</span>
        <span className="audio-cipher" title="encrypted at rest with AES-GCM-256">
          AES-GCM
        </span>
      </div>
      <div className="audio-row">
        <button
          type="button"
          className="audio-play"
          onClick={toggle}
          aria-label={playing ? "pause" : "play"}
          aria-pressed={playing}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <rect x="3.5" y="3" width="3" height="10" fill="currentColor" />
              <rect x="9.5" y="3" width="3" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M4 2.6 L13 8 L4 13.4 Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <div
          className="audio-track"
          onPointerDown={onTrackPointerDown}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.round(time)}
          aria-label="audio scrub"
          onKeyDown={(e) => {
            const a = audioRef.current;
            if (!a || !duration) return;
            if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + 5);
            else if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5);
          }}
        >
          <div className="audio-track-ticks" aria-hidden>
            {Array.from({ length: 21 }, (_, i) => (
              <span key={i} className={`audio-tick${i % 5 === 0 ? " major" : ""}`} />
            ))}
          </div>
          <div className="audio-track-bar">
            <div className="audio-track-fill" style={{ width: pct }} />
            <div className="audio-track-head" style={{ left: pct }} aria-hidden />
          </div>
        </div>

        <span className="audio-time" aria-live="off">
          <span className="audio-time-cur">{fmtTimecode(time)}</span>
          <span className="audio-time-sep">/</span>
          <span className="audio-time-dur">{fmtTimecode(duration)}</span>
        </span>

        <div className="audio-vu" aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
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
  return <AudioPlayer src={src} />;
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
      {m.type === "link" ? <LinkBlock url={text} /> : null}
      {(m.type === "image" || m.type === "video" || m.type === "audio") && m.meta && ckey ? (
        <div className={`node-media node-media--${m.type}`}>
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [wsOn, setWsOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const wsSend = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
  }, []);

  const share = useScreenShare(wsSend, wsOn);
  const shareIngestRef = useRef(share.ingest);
  useEffect(() => {
    shareIngestRef.current = share.ingest;
  }, [share.ingest]);

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
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setWsOn(true);
      };
      ws.onclose = () => {
        setWsOn(false);
        if (wsRef.current === ws) wsRef.current = null;
        attempt += 1;
        const delay = Math.min(10_000, 500 + attempt * 400);
        timer = setTimeout(connect, delay);
      };
      ws.onmessage = (ev) => {
        let data: { event?: string; message?: Message } & Record<string, unknown>;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (data.event === "message" && data.message) mergeMessage(data.message);
        try {
          shareIngestRef.current(data as Parameters<typeof shareIngestRef.current>[0]);
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      clearTimeout(timer);
      if (wsRef.current === ws) wsRef.current = null;
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

  const addAttachments = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setAttachments((prev) => [...prev, ...list.map(makeAttachment)]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const t = prev.find((a) => a.id === id);
      if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    };
    // attachments captured at unmount-time only — intentional
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadOne = useCallback(
    async (a: Attachment): Promise<Message | null> => {
      if (!ckey) return null;
      const nameJson = await sealText(ckey, a.file.name);
      const nameParts = JSON.parse(nameJson) as { iv: string; d: string };
      const buf = await a.file.arrayBuffer();
      const { iv: ivFile, ct } = await sealBytes(ckey, buf);
      const meta = JSON.stringify({
        enc: 1,
        mime: a.file.type || "application/octet-stream",
        ivName: nameParts.iv,
        nameCt: nameParts.d,
        ivFile,
      });
      const { message } = await api.uploadEncryptedFile(meta, new Blob([new Uint8Array(ct)]));
      return message;
    },
    [ckey]
  );

  const sendChat = async () => {
    if (!ckey || sending) return;
    const t = draft.trim();
    const queued = attachments;
    if (!t && queued.length === 0) return;
    setSending(true);
    setDraft("");

    const failedIds: string[] = [];
    for (const a of queued) {
      try {
        const m = await uploadOne(a);
        if (m) mergeMessage(m);
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      } catch {
        failedIds.push(a.id);
      }
    }
    setAttachments((prev) => prev.filter((a) => failedIds.includes(a.id)));

    if (t) {
      try {
        const sealed = await sealText(ckey, t);
        const { message } = isPureUrl(t) ? await api.sendLink(sealed) : await api.sendText(sealed);
        mergeMessage(message);
      } catch {
        setDraft(t);
      }
    }
    setSending(false);
  };

  const presence = useMemo(
    () => (
      <span className="hint">
        <span className={`status-dot ${wsOn ? "on" : ""}`} />
        {wsOn ? "link · ok" : "linking…"}
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
          <p className="hint">establishing link…</p>
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
          <h2>Signal verloren.</h2>
          <p className="sub">{bootErr ?? "Funkstille — der Hub antwortet nicht."}</p>
          <p className="hint">
            Prüfe, ob der Helles‑Server läuft und die Seite über <strong>HTTPS</strong> erreichbar ist (Web Crypto). Bei
            LAN‑Zugriff: <code>npm run dev</code> nutzt HTTPS auf Port 5173, oder Production mit{" "}
            <code>HELLES_HTTPS_KEY_PATH</code> / <code>HELLES_HTTPS_CERT_PATH</code>.
          </p>
          <a className="btn" href="/join" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            help desk
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
      <div className={`shell${share.sharerId ? " shell--with-share" : ""}`}>
        <header className="topbar">
          <div className="brand">
            <h1 data-text="Helles">Helles</h1>
            <p>
              TX/RX · LAN · AES‑GCM · OPERATOR <strong>{user.username}</strong>
            </p>
          </div>
          <div>
            {presence}
            <a className="pill" href="/join" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              help desk
            </a>
          </div>
        </header>

        <div className="box">
          Ephemerer Raum — beim Serverstart und wenn niemand verbunden bleibt (kurze Pause), wird das Logbuch verbrannt
          und ein frischer Schlüssel ausgegeben. AES‑GCM passiert im Browser; der Hub kennt nur Chiffretext. Siehe{" "}
          <code>/join</code>.
        </div>

        <div className="layout">
          <div className="console">
            <section className="stream" aria-label="messages">
              <div className="stream-scroll" ref={scrollRef}>
                {messages.map((m) => (
                  <MessageNode key={m.id} m={m} ckey={ckey} onImageClick={setLightbox} />
                ))}
              </div>
            </section>

            <footer className="composer">
          <div className="composer-row">
            <div className={`input-shell${attachments.length > 0 ? " has-attach" : ""}`}>
              {attachments.length > 0 ? (
                <div className="attach-tray" role="list" aria-label="staged attachments">
                  <span className="attach-tray-tag">▮ PAYLOAD</span>
                  <div className="attach-tray-scroll">
                    {attachments.map((a) => (
                      <AttachChip
                        key={a.id}
                        att={a}
                        onRemove={removeAttachment}
                        pending={sending}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <textarea
                className="input"
                placeholder="compose a message — sealed before it leaves the room. paste a link to embed."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
              />
              <div className="input-tools" role="toolbar" aria-label="attach">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => fileRef.current?.click()}
                  title="attach file"
                  aria-label="attach file"
                  disabled={sending}
                >
                  <IconPlus />
                </button>
                <button
                  type="button"
                  className={`icon-btn icon-btn--share${share.isLocalSharing ? " on" : ""}`}
                  onClick={() => {
                    if (share.isLocalSharing) share.stop();
                    else void share.start();
                  }}
                  disabled={!wsOn || (!!share.sharerId && !share.isLocalSharing)}
                  title={
                    !wsOn
                      ? "link offline"
                      : share.isLocalSharing
                        ? "cut feed"
                        : share.sharerId
                          ? `${share.sharerLabel ?? "another op"} is transmitting`
                          : "share screen"
                  }
                  aria-label={share.isLocalSharing ? "cut feed" : "share screen"}
                  aria-pressed={share.isLocalSharing}
                >
                  <IconScreen />
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void sendChat()}
              disabled={sending || (!draft.trim() && attachments.length === 0)}
            >
              {sending ? "sending…" : "transmit"}
            </button>
          </div>
          <div className="composer-foot">
            <span className="hint">
              shift + ↵ for newline · paste URL to embed · + queues files for one transmit
            </span>
          </div>
          <input
            ref={fileRef}
            className="hidden-input"
            type="file"
            multiple
            accept="image/*,video/*,audio/*,*/*"
            onChange={(e) => {
              addAttachments(e.target.files);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </footer>
          </div>
          {share.sharerId ? (
            <ShareView
              isLocalSharing={share.isLocalSharing}
              sharerLabel={share.sharerLabel}
              localStream={share.localStream}
              remoteStream={share.remoteStream}
              connState={share.connState}
              error={share.error}
              onStop={share.stop}
            />
          ) : null}
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
