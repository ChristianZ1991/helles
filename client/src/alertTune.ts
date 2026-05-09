let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

let armed = false;
export function armAudioOnFirstGesture(): void {
  if (armed) return;
  armed = true;
  const on = () => {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume();
    window.removeEventListener("pointerdown", on);
    window.removeEventListener("keydown", on);
  };
  window.addEventListener("pointerdown", on, { once: true, capture: true });
  window.addEventListener("keydown", on, { once: true, capture: true });
}

function safeVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).vibrate?.(pattern);
    }
  } catch {
    /* ignore */
  }
}

export function playAlertTune(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().catch(() => {});
  }

  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  out.connect(c.destination);

  const mk = (freq: number, start: number, dur: number) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(1.0, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  };

  // "Nice tune": short ascending 4-note ping, CRT-ish.
  mk(440, now + 0.00, 0.10);
  mk(554.37, now + 0.12, 0.10);
  mk(659.25, now + 0.24, 0.12);
  mk(880, now + 0.38, 0.14);
}

export function playPhoneRing(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});

  // Handy vibration pattern: ring…ring…
  safeVibrate([80, 60, 80, 220, 140, 60, 140]);

  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.10, now + 0.01);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  out.connect(c.destination);

  const tone = (freq: number, start: number, dur: number) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(1.0, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  };

  // Classic double-bell-ish ring: two partials, two bursts.
  const burst = (t: number) => {
    tone(440, t, 0.22);
    tone(660, t, 0.22);
  };
  burst(now + 0.00);
  burst(now + 0.30);
  burst(now + 1.00);
  burst(now + 1.30);
}

export function playSirenShock(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});

  // Short "shock" vibration (mobile)
  safeVibrate([30, 30, 30, 60, 40, 30, 40]);

  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
  out.connect(c.destination);

  const osc = c.createOscillator();
  osc.type = "sawtooth";
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(1.0, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
  osc.connect(g);
  g.connect(out);

  // Wail between ~420Hz and ~880Hz.
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.linearRampToValueAtTime(880, now + 0.55);
  osc.frequency.linearRampToValueAtTime(420, now + 1.10);

  osc.start(now);
  osc.stop(now + 1.42);
}

