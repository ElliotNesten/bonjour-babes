import { useEffect, useState } from 'react';
import { backend } from '../../lib/backend';
import type { CategoryId } from '../../lib/types';

/** Kort vibration i mobilen (där det stöds – iOS Safari ignorerar det tyst). */
export function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Webbläsaren blockerar (och loggar ett fel) om sidan inte har fått någon tryckning än.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Mjuk scroll till ett element (respekterar reducerad rörelse). */
export function scrollToId(id: string, block: ScrollLogicalPosition = 'nearest') {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block });
}

/**
 * true när servertiden har passerat `target` (ms). Renderar om exakt en gång när tiden nås
 * i stället för att ticka varje sekund. null = aldrig.
 */
export function useTimeReached(target: number | null): boolean {
  const [, force] = useState(0);
  const reached = target !== null && backend.now() >= target;
  useEffect(() => {
    if (target === null) return;
    const ms = target - backend.now();
    if (ms <= 0) return;
    const t = setTimeout(() => force((x) => x + 1), ms + 40);
    return () => clearTimeout(t);
  }, [target]);
  return reached;
}

/** En liten reaktion per betyg – gör röstningen roligare. */
export const REACTIONS: Record<number, { emoji: string; word: string }> = {
  1: { emoji: '🤢', word: 'Beurk !' },
  2: { emoji: '😖', word: 'Oh là là…' },
  3: { emoji: '😬', word: 'Bof' },
  4: { emoji: '😕', word: 'Mouais' },
  5: { emoji: '🙂', word: 'Pas mal' },
  6: { emoji: '😊', word: 'Bien !' },
  7: { emoji: '😋', word: 'Très bien' },
  8: { emoji: '😋', word: 'Délicieux' },
  9: { emoji: '🤩', word: 'Magnifique' },
  10: { emoji: '🤩', word: 'Parfait !' },
};

export function reactionFor(n: number | undefined | null): { emoji: string; word: string } | null {
  if (!n) return null;
  return REACTIONS[Math.max(1, Math.min(10, Math.round(n)))] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Utkast till röst – överlever en oavsiktlig omladdning               */
/* ------------------------------------------------------------------ */

export type Scores = Partial<Record<CategoryId, number>>;

export interface VoteDraft {
  scores: Scores;
  comment: string;
}

const draftKey = (gameId: string, drinkId: string) => `bonjour-babes:vote-draft:${gameId}:${drinkId}`;

export function loadDraft(gameId: string, drinkId: string): VoteDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(gameId, drinkId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VoteDraft>;
    const scores: Scores = {};
    for (const [k, v] of Object.entries(parsed.scores ?? {})) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10) scores[k as CategoryId] = v;
    }
    return { scores, comment: typeof parsed.comment === 'string' ? parsed.comment : '' };
  } catch {
    return null;
  }
}

export function saveDraft(gameId: string, drinkId: string, draft: VoteDraft) {
  try {
    sessionStorage.setItem(draftKey(gameId, drinkId), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft(gameId: string, drinkId: string) {
  try {
    sessionStorage.removeItem(draftKey(gameId, drinkId));
  } catch {
    /* ignore */
  }
}

/** "123456" → "123 456" */
export function formatPin(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
}
