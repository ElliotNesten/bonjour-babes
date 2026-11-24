import { AWARDS, getAward, type Results } from './scoring';
import type { AwardId, GameSettings } from './types';
import { placeLabel } from './format';

/**
 * Prisutdelningen är en serie steg som admin bläddrar igenom från mobilen.
 * Storskärmen renderar steget game.ceremony.step. Stegen räknas fram ur
 * resultatet, så alla enheter är överens om vad steg N är.
 */
export type CeremonyStep =
  /** "Mesdames et messieurs…" */
  | { kind: 'intro' }
  /** Avslöjar placering 4 och nedåt (positions = index i results.ranking), från sista uppåt. */
  | { kind: 'rest'; positions: number[] }
  /** Avslöjar en pallplats. position = index i results.ranking (2 = brons, 1 = silver, 0 = guld). */
  | { kind: 'place'; position: number }
  /** Hela prispallen. */
  | { kind: 'podium' }
  /** Ett specialpris. */
  | { kind: 'award'; awardId: AwardId }
  /** Bäst i varje kategori. */
  | { kind: 'categories' }
  /** Rolig statistik: hårdaste/snällaste domaren m.m. */
  | { kind: 'stats' }
  /** Anonyma kommentarer. */
  | { kind: 'comments' }
  /** Avslutning med prispall och QR-kod till resultatsidan. */
  | { kind: 'finale' };

export function buildCeremonySteps(results: Results, settings: Pick<GameSettings, 'awardsEnabled'>): CeremonyStep[] {
  const steps: CeremonyStep[] = [{ kind: 'intro' }];
  const n = results.ranking.length;
  if (n > 3) {
    const positions: number[] = [];
    for (let i = n - 1; i >= 3; i--) positions.push(i);
    steps.push({ kind: 'rest', positions });
  }
  for (const position of [2, 1, 0]) {
    if (position < n) steps.push({ kind: 'place', position });
  }
  if (n > 0) steps.push({ kind: 'podium' });
  if (settings.awardsEnabled) {
    for (const a of AWARDS) {
      const r = results.awards.find((x) => x.id === a.id);
      if (r && r.winners.length) steps.push({ kind: 'award', awardId: a.id });
    }
  }
  if (results.categoryWinners.length) steps.push({ kind: 'categories' });
  const s = results.stats;
  if (s.harshest || s.kindest || s.mostDivisive || s.mostTens || s.highestSingle) steps.push({ kind: 'stats' });
  if (results.ranking.some((d) => d.comments.length)) steps.push({ kind: 'comments' });
  steps.push({ kind: 'finale' });
  return steps;
}

/** Etikett för admins kontrollpanel. Avslöjar aldrig vem som vinner. */
export function stepLabel(step: CeremonyStep, results: Results): string {
  switch (step.kind) {
    case 'intro':
      return 'Intro – Mesdames et messieurs';
    case 'rest': {
      const first = results.ranking[step.positions[step.positions.length - 1]];
      const last = results.ranking[step.positions[0]];
      return `Avslöja plats ${first ? first.rank : 4}–${last ? last.rank : results.ranking.length}`;
    }
    case 'place': {
      const rank = results.ranking[step.position]?.rank ?? step.position + 1;
      return `Avslöja ${placeLabel(rank)} plats ${['🥇', '🥈', '🥉'][step.position] ?? ''}`.trim();
    }
    case 'podium':
      return 'Visa prispallen';
    case 'award': {
      const a = getAward(step.awardId);
      return `Specialpris: ${a.title} ${a.emoji}`;
    }
    case 'categories':
      return 'Bäst i varje kategori';
    case 'stats':
      return 'Kvällens statistik';
    case 'comments':
      return 'Anonyma kommentarer';
    case 'finale':
      return 'Final – Santé !';
  }
}

/**
 * Vilka positioner i results.ranking som har avslöjats när steg stepIndex visas.
 * (Används t.ex. av mobilerna för att visa "Du kom 4:a!" först när det avslöjats.)
 */
export function revealedPositions(steps: CeremonyStep[], stepIndex: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i <= Math.min(stepIndex, steps.length - 1); i++) {
    const s = steps[i];
    if (s.kind === 'rest') s.positions.forEach((p) => out.add(p));
    if (s.kind === 'place') out.add(s.position);
    if (s.kind === 'podium' || s.kind === 'finale') {
      for (const step of steps) {
        if (step.kind === 'place') out.add(step.position);
        if (step.kind === 'rest') step.positions.forEach((p) => out.add(p));
      }
    }
  }
  return out;
}
