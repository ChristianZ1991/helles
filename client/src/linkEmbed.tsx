import { useEffect, useState } from "react";
import * as api from "./api";
import type { LinkPreview } from "./api";

export type ParsedMediaEmbed =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  | { kind: "direct"; src: string };

function parseYouTubeId(u: URL): string | null {
  const h = u.hostname.replace(/^www\./, "").toLowerCase();
  if (h === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{6,}$/.test(id) ? id : null;
  }
  if (h === "youtube.com" || h === "m.youtube.com" || h === "youtube-nocookie.com") {
    if (u.pathname.startsWith("/embed/")) {
      const id = u.pathname.slice("/embed/".length).split("/")[0];
      return id && /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (u.pathname === "/watch" || u.pathname.startsWith("/watch/")) {
      const v = u.searchParams.get("v");
      return v && /^[\w-]{6,}$/.test(v) ? v : null;
    }
    if (u.pathname.startsWith("/shorts/")) {
      const id = u.pathname.slice("/shorts/".length).split("/")[0];
      return id && /^[\w-]{6,}$/.test(id) ? id : null;
    }
  }
  return null;
}

function parseVimeoId(u: URL): string | null {
  const h = u.hostname.replace(/^www\./, "").toLowerCase();
  if (h === "vimeo.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
  }
  if (h === "player.vimeo.com") {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (m) return m[1];
  }
  return null;
}

const DIRECT_VIDEO_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv)(\?|#|$)/i;

export function parseMediaEmbed(raw: string): ParsedMediaEmbed | null {
  const t = raw.trim();
  if (!t.startsWith("http://") && !t.startsWith("https://")) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  const yt = parseYouTubeId(u);
  if (yt) return { kind: "youtube", id: yt };
  const vm = parseVimeoId(u);
  if (vm) return { kind: "vimeo", id: vm };
  if (DIRECT_VIDEO_RE.test(u.pathname)) return { kind: "direct", src: t };
  return null;
}

function isHttpsPageUrl(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith("https://") || t.startsWith("http://");
}

/** youtube-nocookie + fehlender Referrer führt oft zu „Video nicht verfügbar“ — Standard-Embed + origin. */
function youtubeEmbedSrc(videoId: string): string {
  const o =
    typeof window !== "undefined" && window.location?.origin
      ? `&origin=${encodeURIComponent(window.location.origin)}`
      : "";
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?modestbranding=1&rel=0${o}`;
}

/** YouTube / Vimeo / direkte Video-URL — `grow` für das linke Dock, sonst kompakte Vorschau. */
export function MediaEmbedFrame(props: { parsed: ParsedMediaEmbed; grow?: boolean; className?: string }) {
  const { parsed, grow, className } = props;
  const root = ["media-embed-frame", className].filter(Boolean).join(" ");
  const aspectCx = grow ? "link-embed-aspect link-embed-aspect--grow" : "link-embed-aspect";
  const videoCx = grow ? "link-embed-video link-embed-video--grow" : "link-embed-video";

  if (parsed.kind === "youtube") {
    const src = youtubeEmbedSrc(parsed.id);
    return (
      <div className={root}>
        <div className={aspectCx}>
          <iframe
            className="link-embed-iframe"
            src={src}
            title="YouTube"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (parsed.kind === "vimeo") {
    const src = `https://player.vimeo.com/video/${encodeURIComponent(parsed.id)}`;
    return (
      <div className={root}>
        <div className={aspectCx}>
          <iframe
            className="link-embed-iframe"
            src={src}
            title="Vimeo"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={root}>
      <video className={videoCx} src={parsed.src} controls playsInline preload="metadata" />
    </div>
  );
}

/** Linkes Dock — füllt die Höhe, Key erzwingt Reload bei neuem Link. */
export function DockedVideoPlayer(props: { url: string }) {
  const { url } = props;
  const parsed = parseMediaEmbed(url);
  if (!parsed) {
    return <p className="hint docked-video-fallback">Diese URL kann hier nicht eingebettet werden.</p>;
  }
  return <MediaEmbedFrame key={url} parsed={parsed} grow className="docked-video-frame" />;
}

/**
 * Renders an inline media embed for sources that explicitly allow it
 * (YouTube, Vimeo, direct video files). With `embedPage`, also attempts an
 * iframe preview for arbitrary HTTPS pages — most sites refuse this via
 * X-Frame-Options/CSP, so for general links use {@link LinkPreviewCard}.
 */
export function LinkRichPreview(props: { url: string; embedPage?: boolean }) {
  const { url, embedPage } = props;

  const parsed = parseMediaEmbed(url);

  const iframePage =
    embedPage && isHttpsPageUrl(url) && !parsed ? (
      <div className="link-embed-shell link-embed-shell--page">
        <iframe
          className="link-embed-iframe-page"
          src={url.trim()}
          title="Seitenvorschau"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms"
        />
        <p className="link-embed-note">
          Viele Seiten blockieren die Einbettung — dann bleibt nur der Link oben.
        </p>
      </div>
    ) : null;

  if (parsed) {
    return (
      <div className="link-embed-shell">
        <MediaEmbedFrame parsed={parsed} />
      </div>
    );
  }

  return iframePage;
}

export function LinkPreviewCard(props: { url: string }) {
  const { url } = props;
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setPreview(null);
    api
      .fetchLinkPreview(url)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }

  if (state === "loading") {
    return (
      <div className="link-card link-card--loading" aria-busy="true">
        <span className="link-card-tag">▶ TARGET DOSSIER</span>
        <span className="link-card-host">{host}</span>
        <div className="link-card-loadbar" aria-hidden>
          <span />
        </div>
        <span className="link-card-loadtxt">fetching ・ openGraph scrape in flight</span>
      </div>
    );
  }

  if (state === "error" || !preview) {
    return (
      <div className="link-card link-card--error">
        <span className="link-card-tag">✕ DOSSIER UNREACHABLE</span>
        <span className="link-card-host">{host}</span>
        <span className="link-card-errtxt">target refused or timed out — link still drops above</span>
      </div>
    );
  }

  if (preview.error === "bot_block") {
    return (
      <div className="link-card link-card--blocked">
        <span className="link-card-tag">▲ DOSSIER GATED</span>
        <span className="link-card-host">{preview.siteName ?? host}</span>
        <span className="link-card-errtxt">
          site served an anti-bot challenge instead of metadata. opens normally in the browser ↗
        </span>
      </div>
    );
  }

  const hasContent = preview.title || preview.description || preview.image;
  if (!hasContent) {
    return (
      <div className="link-card link-card--empty">
        <span className="link-card-tag">▮ NO METADATA</span>
        <span className="link-card-host">{preview.siteName ?? host}</span>
        <span className="link-card-errtxt">site exposes no openGraph or {`<title>`} — only the link drop</span>
      </div>
    );
  }

  return (
    <a
      className={`link-card${preview.image ? " has-image" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <header className="link-card-head">
        <span className="link-card-tag">▶ TARGET DOSSIER</span>
        <span className="link-card-host">{preview.siteName ?? host}</span>
      </header>
      <div className="link-card-body">
        {preview.image ? (
          <div className="link-card-thumb" aria-hidden>
            <img
              src={preview.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const img = e.currentTarget;
                img.style.display = "none";
              }}
            />
          </div>
        ) : null}
        <div className="link-card-text">
          {preview.title ? <h4 className="link-card-title">{preview.title}</h4> : null}
          {preview.description ? <p className="link-card-desc">{preview.description}</p> : null}
        </div>
      </div>
      <footer className="link-card-foot">
        <span className="link-card-arrow" aria-hidden>↗</span>
        <span className="link-card-link">{url}</span>
      </footer>
    </a>
  );
}

