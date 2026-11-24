import { describe, expect, it } from 'vitest';
import { buildCeremonySteps, revealedPositions, stepLabel, type CeremonyStep } from '../../src/lib/ceremony';
import { formatScore } from '../../src/lib/format';
import { computeResults } from '../../src/lib/scoring';
import { fullGame, makeGame } from './fixtures';

const ON = { awardsEnabled: true };
const OFF = { awardsEnabled: false };

const TAIL_WITH_AWARDS: CeremonyStep[] = [
  { kind: 'award', awardId: 'name' },
  { kind: 'award', awardId: 'daring' },
  { kind: 'award', awardId: 'swamp' },
  { kind: 'award', awardId: 'favorite' },
  { kind: 'categories' },
  { kind: 'stats' },
  { kind: 'comments' },
  { kind: 'finale' },
];

const PODIUM: CeremonyStep[] = [
  { kind: 'place', position: 2 },
  { kind: 'place', position: 1 },
  { kind: 'place', position: 0 },
  { kind: 'podium' },
];

describe('buildCeremonySteps', () => {
  it('2 drinkar: silver och guld, ingen brons och inga övriga placeringar', () => {
    const r = computeResults(fullGame(2, { comments: true, awards: true }));
    expect(buildCeremonySteps(r, ON)).toEqual([
      { kind: 'intro' },
      { kind: 'place', position: 1 },
      { kind: 'place', position: 0 },
      { kind: 'podium' },
      ...TAIL_WITH_AWARDS,
    ]);
  });

  it('3 drinkar: brons, silver, guld', () => {
    const r = computeResults(fullGame(3, { comments: true, awards: true }));
    expect(buildCeremonySteps(r, ON)).toEqual([{ kind: 'intro' }, ...PODIUM, ...TAIL_WITH_AWARDS]);
  });

  it('4 drinkar: plats 4 avslöjas först', () => {
    const r = computeResults(fullGame(4, { comments: true, awards: true }));
    expect(buildCeremonySteps(r, ON)).toEqual([
      { kind: 'intro' },
      { kind: 'rest', positions: [3] },
      ...PODIUM,
      ...TAIL_WITH_AWARDS,
    ]);
  });

  it('10 drinkar: plats 10–4 avslöjas nedifrån och upp', () => {
    const r = computeResults(fullGame(10, { comments: true, awards: true }));
    expect(buildCeremonySteps(r, ON)).toEqual([
      { kind: 'intro' },
      { kind: 'rest', positions: [9, 8, 7, 6, 5, 4, 3] },
      ...PODIUM,
      ...TAIL_WITH_AWARDS,
    ]);
  });

  it('hoppar över specialpriserna när de är avstängda', () => {
    const r = computeResults(fullGame(4, { comments: true, awards: true }));
    const steps = buildCeremonySteps(r, OFF);
    expect(steps.some((s) => s.kind === 'award')).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(['intro', 'rest', 'place', 'place', 'place', 'podium', 'categories', 'stats', 'comments', 'finale']);
  });

  it('tar bara med specialpris som har en vinnare', () => {
    const game = fullGame(4, { comments: true });
    game.awardVotes = { swamp: { p1: 'p2' }, favorite: { p2: 'p2' } }; // favorite: bara en självröst → ingen vinnare
    const steps = buildCeremonySteps(computeResults(game), ON);
    expect(steps.filter((s) => s.kind === 'award')).toEqual([{ kind: 'award', awardId: 'swamp' }]);
  });

  it('utan kommentarer blir det inget kommentarssteg', () => {
    const r = computeResults(fullGame(4, { comments: false, awards: true }));
    const steps = buildCeremonySteps(r, ON);
    expect(steps.some((s) => s.kind === 'comments')).toBe(false);
    expect(steps[steps.length - 1]).toEqual({ kind: 'finale' });
    expect(steps[steps.length - 2]).toEqual({ kind: 'stats' });
  });

  it('utan röster blir det bara placeringar, prispall och final', () => {
    const r = computeResults(fullGame(3, { votes: false }));
    expect(buildCeremonySteps(r, ON)).toEqual([{ kind: 'intro' }, ...PODIUM, { kind: 'finale' }]);
  });

  it('utan drinkar blir det bara intro och final', () => {
    const r = computeResults(makeGame({ players: [] }));
    expect(buildCeremonySteps(r, ON)).toEqual([{ kind: 'intro' }, { kind: 'finale' }]);
  });
});

describe('revealedPositions', () => {
  const r = computeResults(fullGame(6, { comments: true, awards: true }));
  const steps = buildCeremonySteps(r, ON);

  it('avslöjar placeringarna steg för steg', () => {
    expect(steps.slice(0, 6).map((s) => s.kind)).toEqual(['intro', 'rest', 'place', 'place', 'place', 'podium']);
    const at = (i: number) => [...revealedPositions(steps, i)].sort((a, b) => a - b);
    expect(at(-1)).toEqual([]);
    expect(at(0)).toEqual([]);
    expect(at(1)).toEqual([3, 4, 5]);
    expect(at(2)).toEqual([2, 3, 4, 5]);
    expect(at(3)).toEqual([1, 2, 3, 4, 5]);
    expect(at(4)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(at(5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(at(steps.length - 1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(at(steps.length + 5)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('avslöjar inget i förväg', () => {
    for (let i = 0; i < steps.length; i++) {
      const revealed = revealedPositions(steps, i);
      const winnerShown = steps.slice(0, i + 1).some((s) => (s.kind === 'place' && s.position === 0) || s.kind === 'podium' || s.kind === 'finale');
      expect(revealed.has(0)).toBe(winnerShown);
    }
  });

  it('allt är avslöjat på prispallen och i finalen', () => {
    const podium = steps.findIndex((s) => s.kind === 'podium');
    const finale = steps.findIndex((s) => s.kind === 'finale');
    expect(revealedPositions(steps, podium).size).toBe(6);
    expect(revealedPositions(steps, finale).size).toBe(6);
  });
});

describe('stepLabel', () => {
  const names = ['Zlatan', 'Beyoncé', 'Rihanna', 'Pippi', 'Ragnar', 'Greta', 'Märta', 'Björn', 'Agnetha', 'Frida'];

  it('avslöjar aldrig namn, drinkar eller poäng', () => {
    const r = computeResults(fullGame(10, { comments: true, awards: true, names }));
    const steps = buildCeremonySteps(r, ON);
    const labels = steps.map((s) => stepLabel(s, r));
    const forbidden = [
      ...r.ranking.flatMap((d) => [d.name, d.drink]),
      ...r.ranking.filter((d) => d.score !== null).map((d) => formatScore(d.score)),
    ];
    expect(forbidden).toContain('Zlatan');
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      for (const word of forbidden) expect(label).not.toContain(word);
    }
  });

  it('har tydliga etiketter för varje steg', () => {
    const r = computeResults(fullGame(10, { comments: true, awards: true, names }));
    const labels = buildCeremonySteps(r, ON).map((s) => stepLabel(s, r));
    expect(labels).toEqual([
      'Intro – Mesdames et messieurs',
      'Avslöja plats 4–10',
      'Avslöja 3:e plats 🥉',
      'Avslöja 2:a plats 🥈',
      'Avslöja 1:a plats 🥇',
      'Visa prispallen',
      'Specialpris: Bästa namn 🏷️',
      'Specialpris: Mest vågad 🌶️',
      'Specialpris: Träskmonstret 💀',
      'Specialpris: Publikens favorit ⭐',
      'Bäst i varje kategori',
      'Kvällens statistik',
      'Anonyma kommentarer',
      'Final – Santé !',
    ]);
  });

  it('skriver "plats 4" (inte "plats 4–4") när bara en placering är kvar (regression)', () => {
    const r = computeResults(fullGame(4, { comments: true }));
    const rest = buildCeremonySteps(r, ON).find((s) => s.kind === 'rest')!;
    expect(stepLabel(rest, r)).toBe('Avslöja plats 4');
  });
});

describe('stepLabel vid delade placeringar', () => {
  it('avslöjar inte att det finns delade placeringar', () => {
    const r = computeResults(fullGame(5, {}));
    // Tvinga fram en delad förstaplats i resultatet.
    const tied = { ...r, ranking: r.ranking.map((d, i) => (i < 3 ? { ...d, rank: 1 } : d)) };
    const labels = buildCeremonySteps(tied, ON).map((s) => stepLabel(s, tied));
    expect(labels).toContain('Avslöja 3:e plats 🥉');
    expect(labels).toContain('Avslöja 2:a plats 🥈');
    expect(labels).toContain('Avslöja 1:a plats 🥇');
    expect(labels).toContain('Avslöja plats 4–5');
  });
});
