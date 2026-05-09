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

  if (parsed?.kind === "youtube") {
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parsed.id)}?modestbranding=1`;
    return (
      <div className="link-embed-shell">
        <div className="link-embed-aspect">
          <iframe
            className="link-embed-iframe"
            src={src}
            title="YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (parsed?.kind === "vimeo") {
    const src = `https://player.vimeo.com/video/${encodeURIComponent(parsed.id)}`;
    return (
      <div className="link-embed-shell">
        <div className="link-embed-aspect">
          <iframe
            className="link-embed-iframe"
            src={src}
            title="Vimeo"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (parsed?.kind === "direct") {
    return (
      <div className="link-embed-shell">
        <video className="link-embed-video" src={parsed.src} controls playsInline preload="metadata" />
      </div>
    );
  }

  return iframePage;
}
