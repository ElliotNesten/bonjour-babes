import { useEffect, useRef, useState } from 'react';
import * as sound from '../../lib/sound';

/** Storskärmen designas för 1920×1080 och skalas för att fylla fönstret. */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

export interface StageSize {
  scale: number;
  /** Logisk bredd/höjd (≥ 1920×1080 – den ena dimensionen växer om fönstret inte är 16:9). */
  width: number;
  height: number;
}

function measure(): StageSize {
  const w = Math.max(1, window.innerWidth || STAGE_W);
  const h = Math.max(1, window.innerHeight || STAGE_H);
  const scale = Math.min(w / STAGE_W, h / STAGE_H);
  return { scale, width: w / scale, height: h / scale };
}

export function useStageSize(): StageSize {
  const [size, setSize] = useState(measure);
  useEffect(() => {
    const onResize = () => setSize(measure());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('fullscreenchange', onResize);
    };
  }, []);
  return size;
}

/** true om användaren föredrar reducerad rörelse (följer ändringar live). */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Ljudets mute-läge som React-state. */
export function useMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMutedState] = useState(sound.isMuted);
  useEffect(() => sound.subscribeMuted(setMutedState), []);
  return [muted, sound.setMuted];
}

/**
 * Anropar onArrive med id:n som tillkommit sedan förra renderingen – men aldrig vid
 * första renderingen (så att ingenting plingar när storskärmen laddas om).
 * När scope ändras (t.ex. ny drink) nollställs jämförelsen utan att något anropas.
 */
export function useArrivals(ids: string[], onArrive: (added: string[]) => void, scope = ''): void {
  const prev = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const cb = useRef(onArrive);
  cb.current = onArrive;
  const key = ids.join('|');
  useEffect(() => {
    const current = new Set(ids);
    const before = prev.current;
    prev.current = { scope, ids: current };
    if (!before || before.scope !== scope) return;
    const added = ids.filter((id) => !before.ids.has(id));
    if (added.length) cb.current(added);
    // ids representeras av key (en stabil sträng) – arrayen i sig är ny vid varje rendering.
  }, [key, scope]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Anropar onEnter när villkoret går från false till true medan komponenten är monterad
 * (inte om det redan är sant vid första renderingen).
 */
export function useBecameTrue(condition: boolean, onEnter: () => void, scope = ''): void {
  const prev = useRef<{ scope: string; value: boolean } | null>(null);
  const cb = useRef(onEnter);
  cb.current = onEnter;
  useEffect(() => {
    const before = prev.current;
    prev.current = { scope, value: condition };
    if (before && before.scope === scope && !before.value && condition) cb.current();
  }, [condition, scope]);
}

export type Schedule = (ms: number, fn: () => void) => void;

/**
 * Kör en tidslinje en gång när komponenten monteras. Alla callbacks schemaläggs med
 * setTimeout och avbryts vid avmontering – så att StrictMode och snabba stegbyten
 * aldrig spelar upp ljud eller effekter två gånger.
 */
export function useTimeline(run: (at: Schedule) => void | (() => void), enabled = true): void {
  const fn = useRef(run);
  fn.current = run;
  useEffect(() => {
    if (!enabled) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at: Schedule = (ms, cb) => {
      timers.push(
        setTimeout(() => {
          try {
            cb();
          } catch {
            /* en effekt får aldrig krascha storskärmen */
          }
        }, Math.max(0, ms)),
      );
    };
    const cleanup = fn.current(at);
    return () => {
      timers.forEach(clearTimeout);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [enabled]);
}

/** Ett steg-index som räknas upp med jämna mellanrum (för rader som avslöjas en i taget). */
export function useStagger(count: number, opts: { enabled: boolean; startMs: number; everyMs: number; onStep?: (i: number) => void }): number {
  const { enabled, startMs, everyMs } = opts;
  const [shown, setShown] = useState(enabled ? 0 : count);
  const onStep = useRef(opts.onStep);
  onStep.current = opts.onStep;
  useTimeline((at) => {
    for (let i = 0; i < count; i++) {
      at(startMs + i * everyMs, () => {
        setShown(i + 1);
        onStep.current?.(i);
      });
    }
  }, enabled);
  return enabled ? shown : count;
}

/** Räknar upp ett tal från 0 till target (easeOutCubic). */
export function useCountUp(target: number | null, opts: { enabled: boolean; durationMs?: number; delayMs?: number }): number | null {
  const { enabled, durationMs = 1400, delayMs = 0 } = opts;
  const [value, setValue] = useState<number | null>(enabled && target !== null ? 0 : target);
  useEffect(() => {
    if (!enabled || target === null) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start = 0;
    setValue(0);
    const timer = setTimeout(() => {
      const step = (t: number) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(target * eased);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, enabled, durationMs, delayMs]);
  return value;
}

/**
 * Teckenstorlek som krymper för långa texter, så att långa namn får plats.
 * ideal = antal tecken som får plats i full storlek.
 */
export function fitSize(text: string, base: number, min: number, ideal: number): number {
  const len = Math.max(1, [...text].length);
  if (len <= ideal) return base;
  return Math.max(min, Math.round(base * Math.pow(ideal / len, 0.85)));
}

/** "482913" → "482 913" */
export function formatPin(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
}

/** Sidans adress utan protokoll, t.ex. "olle.github.io/bonjour-babes". */
export function siteAddress(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.host}${window.location.pathname}`.replace(/\/(index\.html)?$/, '');
}

/** "1 röst" / "5 röster" */
export function votesLabel(n: number): string {
  return `${n} ${n === 1 ? 'röst' : 'röster'}`;
}

export function ordinalWord(rank: number): string {
  return ['första', 'andra', 'tredje', 'fjärde', 'femte'][rank - 1] ?? `${rank}:e`;
}
