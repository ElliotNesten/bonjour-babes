import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './backend';
import { normalizeGame } from './selectors';
import type { Game, HallOfFameEntry } from './types';

/** Inloggat uid. Garanterat satt inuti <BackendGate> (se App.tsx). */
export function useUid(): string {
  const uid = backend.uid();
  if (!uid) throw new Error('useUid används utanför BackendGate');
  return uid;
}

/**
 * Prenumererar på ett värde i databasen.
 * undefined = laddar, null = finns inte.
 */
export function useDbValue<T>(path: string | null): T | null | undefined {
  const [state, setState] = useState<{ path: string | null; value: T | null | undefined }>({ path, value: undefined });
  useEffect(() => {
    if (!path) {
      setState({ path, value: null });
      return;
    }
    setState({ path, value: undefined });
    return backend.subscribe<T>(
      path,
      (value) => setState({ path, value }),
      () => setState({ path, value: null }),
    );
  }, [path]);
  // Returnera aldrig ett värde från en tidigare sökväg.
  return state.path === path ? state.value : undefined;
}

/** Live-uppdaterat spel. undefined = laddar, null = finns inte. */
export function useGame(gameId: string | null | undefined): Game | null | undefined {
  const raw = useDbValue<unknown>(gameId ? `games/${gameId}` : null);
  return useMemo(() => (raw === undefined ? undefined : normalizeGame(raw)), [raw]);
}

export function useHallOfFame(): Record<string, HallOfFameEntry> | null | undefined {
  return useDbValue<Record<string, HallOfFameEntry>>('hallOfFame');
}

/** Servertid som tickar (default varje sekund). */
export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => backend.now());
  useEffect(() => {
    const t = setInterval(() => setNow(backend.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** true när databasen är ansluten (med 2 s fördröjning innan vi visar frånkopplad). */
export function useConnected(): boolean {
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let everConnected = false;
    const unsub = backend.onConnection((c) => {
      if (timer) clearTimeout(timer);
      if (c) {
        everConnected = true;
        setConnected(true);
      } else {
        timer = setTimeout(() => setConnected(false), everConnected ? 2000 : 6000);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
  return connected;
}

/** Föregående värde av något (t.ex. för att upptäcka ändringar och spela ljud). */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/** Håller skärmen vaken (Screen Wake Lock) medan komponenten är monterad, där det stöds. */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const request = () => {
      nav.wakeLock
        ?.request('screen')
        .then((s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        })
        .catch(() => {});
    };
    request();
    const onVis = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}
