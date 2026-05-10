import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Peer = { id: string; label: string };

type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit | null };

type Send = (payload: unknown) => void;

type WsEvent =
  | { event: "hello"; you: string; peers: Peer[]; sharerId: string | null }
  | { event: "peer-join"; peer: Peer }
  | { event: "peer-leave"; peerId: string }
  | { event: "share-start"; peerId: string }
  | { event: "share-stop"; peerId: string }
  | { event: "signal"; from: string; data: SignalPayload }
  | { event: string; [k: string]: unknown };

export type ConnState = "idle" | "connecting" | "connected" | "failed" | "closed";

export type ScreenShareState = {
  selfId: string | null;
  sharerId: string | null;
  sharerLabel: string | null;
  isLocalSharing: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connState: ConnState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  ingest: (data: WsEvent) => void;
};

// Public STUN servers — used to gather server-reflexive ICE candidates so
// peers can connect even when host candidates are anonymised by Chromium's
// mDNS protection. Required for two-browsers-on-same-host testing on Linux
// hosts without a working mDNS resolver. For an air-gapped LAN with no
// internet, swap these for a self-hosted STUN (e.g. coturn on the helles
// host) — in that case the only data leaving the LAN is the room key, which
// already never leaves the server's RAM.
const PC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 2,
};

export function useScreenShare(send: Send, wsOn: boolean): ScreenShareState {
  const [selfId, setSelfId] = useState<string | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const [sharerId, setSharerId] = useState<string | null>(null);
  const [sharerLabel, setSharerLabel] = useState<string | null>(null);
  const [isLocalSharing, setIsLocalSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const sharerPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const closeViewer = useCallback(() => {
    const pc = viewerPcRef.current;
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      viewerPcRef.current = null;
    }
    pendingIceRef.current.clear();
    setRemoteStream(null);
    setConnState("idle");
  }, []);

  const closeAllSharer = useCallback(() => {
    for (const pc of sharerPcsRef.current.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    sharerPcsRef.current.clear();
    pendingIceRef.current.clear();
    const stream = localStreamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    localStreamRef.current = null;
    setLocalStream(null);
    setConnState("idle");
  }, []);

  const offerToPeer = useCallback(
    async (peerId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return;
      const pc = new RTCPeerConnection(PC_CONFIG);
      sharerPcsRef.current.set(peerId, pc);
      pc.onicecandidate = (ev) => {
        send({
          event: "signal",
          to: peerId,
          data: { kind: "ice", candidate: ev.candidate ? ev.candidate.toJSON() : null },
        });
      };
      pc.onconnectionstatechange = () => {
        const cs = pc.connectionState;
        if (cs === "connected") setConnState("connected");
        else if (cs === "connecting" || cs === "new") setConnState("connecting");
        else if (cs === "failed") {
          setConnState("failed");
          sharerPcsRef.current.delete(peerId);
          try {
            pc.close();
          } catch {
            /* ignore */
          }
        } else if (cs === "closed") {
          sharerPcsRef.current.delete(peerId);
        }
      };
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({
          event: "signal",
          to: peerId,
          data: { kind: "offer", sdp: offer.sdp ?? "" },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "offer_failed");
      }
    },
    [send]
  );

  const start = useCallback(async () => {
    if (isLocalSharing) return;
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setError("display capture not supported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError(e instanceof Error ? e.message : "share_failed");
      }
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsLocalSharing(true);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        send({ event: "share-stop" });
      });
    }
    send({ event: "share-start" });
    for (const peerId of peersRef.current.keys()) {
      void offerToPeer(peerId);
    }
  }, [isLocalSharing, offerToPeer, send]);

  const stop = useCallback(() => {
    if (isLocalSharing) {
      send({ event: "share-stop" });
    }
    closeAllSharer();
    closeViewer();
    setIsLocalSharing(false);
  }, [closeAllSharer, closeViewer, isLocalSharing, send]);

  const ensureViewerPc = useCallback(
    (fromId: string): RTCPeerConnection => {
      const existing = viewerPcRef.current;
      if (existing) return existing;
      const pc = new RTCPeerConnection(PC_CONFIG);
      viewerPcRef.current = pc;
      const stream = new MediaStream();
      pc.ontrack = (ev) => {
        for (const track of ev.streams[0]?.getTracks() ?? [ev.track]) {
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
        }
        setRemoteStream(stream);
      };
      pc.onicecandidate = (ev) => {
        send({
          event: "signal",
          to: fromId,
          data: { kind: "ice", candidate: ev.candidate ? ev.candidate.toJSON() : null },
        });
      };
      pc.onconnectionstatechange = () => {
        const cs = pc.connectionState;
        if (cs === "connected") setConnState("connected");
        else if (cs === "connecting" || cs === "new") setConnState("connecting");
        else if (cs === "failed") setConnState("failed");
        else if (cs === "closed") setConnState("closed");
      };
      return pc;
    },
    [send]
  );

  const handleSignal = useCallback(
    async (from: string, data: SignalPayload) => {
      if (data.kind === "offer") {
        // Always start fresh per offer — avoids stale signaling state from a
        // previous share or a duplicate offer racing on the same pc.
        if (viewerPcRef.current) {
          try {
            viewerPcRef.current.close();
          } catch {
            /* ignore */
          }
          viewerPcRef.current = null;
          setRemoteStream(null);
        }
        const pc = ensureViewerPc(from);
        try {
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
          if (pc.signalingState !== "have-remote-offer") return;
          const buffered = pendingIceRef.current.get(from);
          if (buffered) {
            for (const c of buffered) {
              try {
                await pc.addIceCandidate(c);
              } catch {
                /* ignore */
              }
            }
            pendingIceRef.current.delete(from);
          }
          if (pc.signalingState !== "have-remote-offer") return;
          const answer = await pc.createAnswer();
          if (pc.signalingState !== "have-remote-offer") return;
          await pc.setLocalDescription(answer);
          send({
            event: "signal",
            to: from,
            data: { kind: "answer", sdp: answer.sdp ?? "" },
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "answer_failed");
        }
        return;
      }
      if (data.kind === "answer") {
        const pc = sharerPcsRef.current.get(from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
          const buffered = pendingIceRef.current.get(from);
          if (buffered) {
            for (const c of buffered) {
              try {
                await pc.addIceCandidate(c);
              } catch {
                /* ignore */
              }
            }
            pendingIceRef.current.delete(from);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "set_remote_failed");
        }
        return;
      }
      if (data.kind === "ice") {
        const pc = sharerPcsRef.current.get(from) ?? viewerPcRef.current;
        if (!data.candidate) return;
        if (!pc || !pc.remoteDescription) {
          const arr = pendingIceRef.current.get(from) ?? [];
          arr.push(data.candidate);
          pendingIceRef.current.set(from, arr);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore */
        }
      }
    },
    [ensureViewerPc, send]
  );

  const ingest = useCallback(
    (data: WsEvent) => {
      switch (data.event) {
        case "hello": {
          const ev = data as Extract<WsEvent, { event: "hello" }>;
          setSelfId(ev.you);
          peersRef.current.clear();
          for (const p of ev.peers) peersRef.current.set(p.id, p);
          if (ev.sharerId) {
            setSharerId(ev.sharerId);
            const p = peersRef.current.get(ev.sharerId);
            setSharerLabel(p ? p.label : null);
          } else {
            setSharerId(null);
            setSharerLabel(null);
          }
          return;
        }
        case "peer-join": {
          const ev = data as Extract<WsEvent, { event: "peer-join" }>;
          peersRef.current.set(ev.peer.id, ev.peer);
          if (isLocalSharing) void offerToPeer(ev.peer.id);
          return;
        }
        case "peer-leave": {
          const ev = data as Extract<WsEvent, { event: "peer-leave" }>;
          peersRef.current.delete(ev.peerId);
          const pc = sharerPcsRef.current.get(ev.peerId);
          if (pc) {
            try {
              pc.close();
            } catch {
              /* ignore */
            }
            sharerPcsRef.current.delete(ev.peerId);
          }
          pendingIceRef.current.delete(ev.peerId);
          return;
        }
        case "share-start": {
          const ev = data as Extract<WsEvent, { event: "share-start" }>;
          // If we somehow have a stale viewer pc (e.g. from a prior share),
          // clear it so the next offer starts on a clean RTCPeerConnection.
          if (ev.peerId !== selfId && viewerPcRef.current) {
            try {
              viewerPcRef.current.close();
            } catch {
              /* ignore */
            }
            viewerPcRef.current = null;
            pendingIceRef.current.clear();
            setRemoteStream(null);
          }
          setSharerId(ev.peerId);
          setConnState("connecting");
          const p = peersRef.current.get(ev.peerId);
          setSharerLabel(p ? p.label : ev.peerId === selfId ? "you" : null);
          return;
        }
        case "share-stop": {
          const ev = data as Extract<WsEvent, { event: "share-stop" }>;
          setSharerId((cur) => (cur === ev.peerId ? null : cur));
          setSharerLabel(null);
          if (ev.peerId === selfId) {
            closeAllSharer();
            setIsLocalSharing(false);
          } else {
            closeViewer();
          }
          return;
        }
        case "signal": {
          const ev = data as Extract<WsEvent, { event: "signal" }>;
          void handleSignal(ev.from, ev.data);
          return;
        }
      }
    },
    [closeAllSharer, closeViewer, handleSignal, isLocalSharing, offerToPeer, selfId]
  );

  useEffect(() => {
    if (wsOn) return;
    closeAllSharer();
    closeViewer();
    setIsLocalSharing(false);
    setSharerId(null);
    setSharerLabel(null);
    peersRef.current.clear();
  }, [wsOn, closeAllSharer, closeViewer]);

  // Hard timeout on a stalled handshake — Chromium's own ICE timeout can
  // be 30+ seconds. We'd rather surface the failure clearly within a few
  // seconds so the user can react.
  useEffect(() => {
    if (connState !== "connecting") return;
    const t = setTimeout(() => {
      setConnState((cur) => (cur === "connecting" ? "failed" : cur));
    }, 12_000);
    return () => clearTimeout(t);
  }, [connState]);

  useEffect(() => {
    return () => {
      closeAllSharer();
      closeViewer();
    };
  }, [closeAllSharer, closeViewer]);

  return useMemo(
    () => ({
      selfId,
      sharerId,
      sharerLabel,
      isLocalSharing,
      localStream,
      remoteStream,
      connState,
      error,
      start,
      stop,
      ingest,
    }),
    [
      selfId,
      sharerId,
      sharerLabel,
      isLocalSharing,
      localStream,
      remoteStream,
      connState,
      error,
      start,
      stop,
      ingest,
    ]
  );
}

function IconAudioOn() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M3.5 6h2.3L8.6 4v8L5.8 10H3.5z" fill="currentColor" />
      <path
        d="M11.2 5.6c1 0.7 1.6 1.7 1.6 2.4 0 0.7-0.6 1.7-1.6 2.4"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAudioOff() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M3.5 6h2.3L8.6 4v8L5.8 10H3.5z" fill="currentColor" />
      <path
        d="M11 6l3 4M14 6l-3 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFsEnter() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}

function IconFsExit() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}

function ShareControls(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  isLocalPreview: boolean;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { videoRef, stageRef, isLocalPreview, muted, setMuted } = props;
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFs(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stageRef]);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
    // The click that toggles us off-mute counts as the user gesture
    // autoplay-with-audio needs — re-issue play() so audio actually starts.
    const v = videoRef.current;
    v?.play().catch(() => {
      /* ignore */
    });
  }, [setMuted, videoRef]);

  const toggleFs = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement === stage) {
      void document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      void stage.requestFullscreen();
    }
  }, [stageRef]);

  return (
    <div className="share-controls" role="toolbar" aria-label="screen share controls">
      {isLocalPreview ? (
        <span className="share-ctrl-idle" aria-hidden>
          ▮ LOCAL FEED
        </span>
      ) : (
        <button
          type="button"
          className={`share-ctrl share-ctrl--audio${muted ? " is-muted" : ""}`}
          onClick={toggleMute}
          aria-label={muted ? "enable audio" : "mute audio"}
          aria-pressed={!muted}
          title={muted ? "enable audio" : "mute audio"}
        >
          {muted ? <IconAudioOff /> : <IconAudioOn />}
          <span className="share-ctrl-label">{muted ? "MUTED" : "AUDIO"}</span>
        </button>
      )}
      <span className="share-ctrl-spacer" aria-hidden />
      <button
        type="button"
        className={`share-ctrl share-ctrl--fs${isFs ? " is-on" : ""}`}
        onClick={toggleFs}
        aria-label={isFs ? "exit fullscreen" : "enter fullscreen"}
        aria-pressed={isFs}
        title={isFs ? "exit fullscreen" : "fullscreen"}
      >
        {isFs ? <IconFsExit /> : <IconFsEnter />}
        <span className="share-ctrl-label">{isFs ? "EXIT" : "FULL"}</span>
      </button>
    </div>
  );
}

export function ShareView(props: {
  isLocalSharing: boolean;
  sharerLabel: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connState: ConnState;
  onStop: () => void;
  error: string | null;
}) {
  const { isLocalSharing, sharerLabel, localStream, remoteStream, connState, onStop, error } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const activeStream = isLocalSharing ? localStream : remoteStream;
  const isLocalPreview = isLocalSharing && !!localStream;
  // Always start muted so autoplay isn't blocked. The viewer can unmute via
  // the audio control in the overlay (a user gesture is required for audio).
  const [muted, setMuted] = useState(true);

  // Re-mute whenever the underlying stream is replaced (new share session).
  useEffect(() => {
    setMuted(true);
  }, [activeStream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = activeStream;
    if (activeStream) {
      v.play().catch(() => {
        /* may need a user gesture; the audio control handles that */
      });
    }
  }, [activeStream]);

  const showConnecting = !!sharerLabel && !activeStream && (connState === "connecting" || connState === "idle");
  const showFailed = !activeStream && connState === "failed";
  const effectiveMuted = isLocalPreview ? true : muted;

  return (
    <aside className={`share-panel state-${connState}`} aria-label="screen share">
      <header className="share-head">
        <span className="share-tag">▮ VIS-RELAY</span>
        <span className="share-source">
          {isLocalSharing
            ? "transmitting · you"
            : sharerLabel
              ? `incoming · ${sharerLabel}`
              : "idle"}
        </span>
        <span className={`share-state share-state--${connState}`} title={`connection: ${connState}`}>
          {connState === "connected"
            ? "● LINK"
            : connState === "connecting"
              ? "◐ HANDSHAKE"
              : connState === "failed"
                ? "✕ FAILED"
                : connState === "closed"
                  ? "○ CLOSED"
                  : "○ IDLE"}
        </span>
        {isLocalSharing ? (
          <button type="button" className="btn btn-ghost share-stop" onClick={onStop}>
            cut feed
          </button>
        ) : null}
      </header>
      <div className="share-stage" ref={stageRef}>
        {activeStream ? (
          <>
            <video
              ref={videoRef}
              className="share-video"
              autoPlay
              playsInline
              muted={effectiveMuted}
              onClick={() => {
                if (!isLocalPreview) setMuted((m) => !m);
              }}
            />
            {isLocalPreview ? (
              <span className="share-self-badge">▶ LIVE · LOCAL PREVIEW</span>
            ) : null}
            <ShareControls
              videoRef={videoRef}
              stageRef={stageRef}
              isLocalPreview={isLocalPreview}
              muted={muted}
              setMuted={setMuted}
            />
          </>
        ) : showConnecting ? (
          <div className="share-idle share-idle--connecting">
            <span className="share-idle-mark">◐ HANDSHAKE</span>
            <span className="share-idle-sub">negotiating · ICE in flight</span>
          </div>
        ) : showFailed ? (
          <div className="share-idle share-idle--failed">
            <span className="share-idle-mark">✕ LINK DOWN</span>
            <span className="share-idle-sub">ice negotiation failed</span>
            <p className="share-idle-help">
              Same-host testing in Chromium often fails because host ICE candidates are mDNS-anonymised.
              Try the second peer in <strong>Firefox</strong>, or disable
              <code>chrome://flags/#enable-webrtc-hide-local-ips-with-mdns</code>.
              Cross-machine LAN: ensure both peers can reach each other (firewall / UDP).
            </p>
          </div>
        ) : (
          <div className="share-idle">
            <span className="share-idle-mark">○ NO FEED</span>
            <span className="share-idle-sub">awaiting transmission</span>
          </div>
        )}
      </div>
      {error ? <p className="share-err">{error}</p> : null}
    </aside>
  );
}
