import confettiLib from 'canvas-confetti';

/**
 * Konfetti i Bonjour Babes-färger (champagneguld, bordeaux, rosé).
 * Ett eget helskärmscanvas ovanpå allt (pekhändelser går igenom).
 * Allt är no-op när användaren föredrar reducerad rörelse, och inget kastar fel.
 */

export const CONFETTI_COLORS = ['#d9b26f', '#f3dca5', '#9b2747', '#f6ead0', '#e8a3a8'];

type Fire = confettiLib.CreateTypes;

let instance: Fire | null = null;
let canvas: HTMLCanvasElement | null = null;
const rains = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function getInstance(): Fire | null {
  if (typeof document === 'undefined') return null;
  if (instance && canvas?.isConnected) return instance;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'bb-confetti';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '1500',
  });
  document.body.appendChild(canvas);
  let worker = false;
  try {
    worker = typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined';
  } catch {
    worker = false;
  }
  instance = confettiLib.create(canvas, { resize: true, useWorker: worker });
  return instance;
}

function fire(opts: confettiLib.Options): void {
  try {
    if (prefersReducedMotion()) return;
    const c = getInstance();
    if (!c) return;
    void c({ colors: CONFETTI_COLORS, disableForReducedMotion: true, ...opts })?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}

function later(ms: number, fn: () => void) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * En explosion från mitten av skärmen. intensity 0–1:
 * 0.2 = diskret skur, 0.5 = rejäl, 1 = vinnaren.
 */
export function burst(intensity = 0.5, origin: { x?: number; y?: number } = {}): void {
  const i = clamp01(intensity);
  const total = Math.round(70 + 380 * i);
  const o = { x: origin.x ?? 0.5, y: origin.y ?? 0.6 };
  const scalar = 1.05 + 0.35 * i;
  const ticks = 220 + Math.round(180 * i);
  const shot = (ratio: number, opts: confettiLib.Options) =>
    fire({ origin: o, scalar, ticks, particleCount: Math.round(total * ratio), ...opts });
  shot(0.25, { spread: 26, startVelocity: 40 + 25 * i });
  shot(0.2, { spread: 60, startVelocity: 32 + 18 * i });
  shot(0.35, { spread: 100, decay: 0.91, scalar: scalar * 0.85 });
  shot(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: scalar * 1.25 });
  shot(0.1, { spread: 120, startVelocity: 45, shapes: i > 0.5 ? ['star'] : ['circle'] });
}

/** Konfettikanoner från båda nedre hörnen, tre salvor. */
export function cannons(): void {
  [0, 260, 560].forEach((delay, k) => {
    later(delay, () => {
      const count = 110 - k * 20;
      const common = { particleCount: count, spread: 58, startVelocity: 72 - k * 6, scalar: 1.3, ticks: 380, gravity: 0.95 };
      fire({ ...common, angle: 60, origin: { x: -0.02, y: 0.92 } });
      fire({ ...common, angle: 120, origin: { x: 1.02, y: 0.92 } });
    });
  });
}

/**
 * Mjukt konfettiregn uppifrån i ms millisekunder.
 * Returnerar en funktion som stoppar regnet i förtid.
 */
export function rain(ms = 4000, density = 1): () => void {
  if (prefersReducedMotion() || typeof window === 'undefined') return () => {};
  const end = Date.now() + Math.max(0, ms);
  const perTick = Math.max(1, Math.round(2 * density));
  const interval = setInterval(() => {
    if (Date.now() > end) {
      stop();
      return;
    }
    for (let k = 0; k < perTick; k++) {
      fire({
        particleCount: 1,
        angle: 270,
        spread: 30,
        startVelocity: 2 + Math.random() * 6,
        gravity: 0.45 + Math.random() * 0.25,
        drift: (Math.random() - 0.5) * 1.2,
        ticks: 600,
        scalar: 1 + Math.random() * 0.5,
        origin: { x: Math.random(), y: -0.05 },
        shapes: Math.random() < 0.2 ? ['circle'] : ['square'],
      });
    }
  }, 90);
  const stop = () => {
    clearInterval(interval);
    rains.delete(stop);
  };
  rains.add(stop);
  return stop;
}

/** Stoppar pågående konfettiregn (bitarna som redan faller får landa). */
export function stopRain(): void {
  try {
    rains.forEach((stop) => stop());
  } catch {
    /* ignore */
  }
}

/** Stoppar regn/kanoner som väntar och tömmer canvaset. */
export function clearConfetti(): void {
  try {
    rains.forEach((stop) => stop());
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    instance?.reset();
  } catch {
    /* ignore */
  }
}
