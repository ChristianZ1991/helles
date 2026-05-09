export type RumbleOptions = {
  durationMs?: number;
};

export function rumble(el: HTMLElement | null, opts: RumbleOptions = {}): void {
  if (!el) return;
  const durationMs = opts.durationMs ?? 340;

  // Restart animation reliably even if called repeatedly.
  el.classList.remove("rumble");
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetWidth;
  el.classList.add("rumble");

  window.setTimeout(() => {
    el.classList.remove("rumble");
  }, durationMs);
}

