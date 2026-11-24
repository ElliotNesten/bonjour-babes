import { describe, expect, it } from 'vitest';
import { AWARD_IDS } from '../../src/lib/scoring';
import {
  DEFAULT_SETTINGS,
  awardVoteProgress,
  completedDrinkIds,
  currentDrink,
  effectiveOrder,
  expectedVoters,
  hasVoted,
  isValidVote,
  nextDrinkIndex,
  normalizeGame,
  playerEntries,
  toArray,
  votesForDrink,
  votingPlayerIds,
} from '../../src/lib/selectors';
import type { CurrentRound, RoundPhase } from '../../src/lib/types';
import { allOf, makeGame } from './fixtures';

const cur = (drinkId: string, index: number, phase: RoundPhase = 'preparing'): CurrentRound => ({
  drinkId,
  index,
  phase,
  since: 5,
});

describe('toArray', () => {
  it('hanterar arrayer, RTDB-objekt och tomma värden', () => {
    expect(toArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(toArray(['a', null, 'c'])).toEqual(['a', 'c']);
    expect(toArray({ '1': 'b', '0': 'a', '10': 'k', '2': 'c' })).toEqual(['a', 'b', 'c', 'k']);
    expect(toArray(null)).toEqual([]);
    expect(toArray(undefined)).toEqual([]);
    expect(toArray('abc')).toEqual([]);
  });
});

describe('normalizeGame', () => {
  it('returnerar null för saknade eller trasiga spel', () => {
    expect(normalizeGame(null)).toBeNull();
    expect(normalizeGame(undefined)).toBeNull();
    expect(normalizeGame('spel')).toBeNull();
    expect(normalizeGame({})).toBeNull();
    expect(normalizeGame({ meta: { name: 'Utan PIN' } })).toBeNull();
  });

  it('fyller i standardvärden när fält saknas', () => {
    const g = normalizeGame({ meta: { pin: '123456' } });
    expect(g).toEqual({
      meta: { name: 'Bonjour Babes', pin: '123456', createdAt: 0, status: 'lobby' },
      settings: DEFAULT_SETTINGS,
      players: {},
      order: [],
      current: undefined,
      votes: {},
      awardVotes: {},
      lottery: undefined,
      ceremony: undefined,
    });
  });

  it('gör om ogiltig status till lobby', () => {
    expect(normalizeGame({ meta: { pin: '123456', status: 'banan' } })?.meta.status).toBe('lobby');
    for (const status of ['lobby', 'running', 'awards', 'ceremony', 'finished']) {
      expect(normalizeGame({ meta: { pin: '123456', status } })?.meta.status).toBe(status);
    }
  });

  it('läser ordningen både som array och som RTDB-objekt', () => {
    const base = { meta: { pin: '123456' } };
    expect(normalizeGame({ ...base, order: ['b', 'a', 'c'] })?.order).toEqual(['b', 'a', 'c']);
    expect(normalizeGame({ ...base, order: { '0': 'b', '1': 'a', '2': 'c' } })?.order).toEqual(['b', 'a', 'c']);
    expect(normalizeGame({ ...base, order: { '2': 'c', '0': 'b', '1': 'a' } })?.order).toEqual(['b', 'a', 'c']);
    expect(normalizeGame({ ...base, lottery: { at: 9, order: { '0': 'x', '1': 'y' } } })?.lottery).toEqual({
      at: 9,
      order: ['x', 'y'],
    });
  });

  it('fyller i spelarfält och behåller manual', () => {
    const g = normalizeGame({
      meta: { pin: '123456' },
      players: {
        a: { name: '  Alva ', drink: 'Le Spritz', emoji: '🍹', color: '#123456', joinedAt: 7 },
        b: {},
        c: { name: 'Carl', drink: 'X', manual: true, joinedAt: '12' },
        d: null,
      },
    });
    expect(g?.players).toEqual({
      a: { name: 'Alva', drink: 'Le Spritz', emoji: '🍹', color: '#123456', joinedAt: 7 },
      b: { name: 'Okänd', drink: 'Hemlig drink', emoji: '🍸', color: '#6e1430', joinedAt: 0 },
      c: { name: 'Carl', drink: 'X', emoji: '🍸', color: '#6e1430', joinedAt: 12, manual: true },
    });
  });

  it('slår ihop inställningar med standardvärden', () => {
    const g = normalizeGame({ meta: { pin: '123456' }, settings: { trimExtremes: false } });
    expect(g?.settings).toEqual({ ...DEFAULT_SETTINGS, trimExtremes: false });
  });

  it('läser current, ceremony och meta-tider', () => {
    const g = normalizeGame({
      meta: { pin: '123456', name: 'Fredag', createdAt: 1, startedAt: 2, finishedAt: 3, status: 'finished' },
      current: { index: '2', drinkId: 'b', phase: 'voting', since: 4 },
      ceremony: { step: 0, at: 5 },
    });
    expect(g?.meta).toEqual({ name: 'Fredag', pin: '123456', createdAt: 1, startedAt: 2, finishedAt: 3, status: 'finished' });
    expect(g?.current).toEqual({ index: 2, drinkId: 'b', phase: 'voting', since: 4 });
    expect(g?.ceremony).toEqual({ step: 0, at: 5 });
  });

  it('ignorerar current utan drinkId och okänd fas', () => {
    expect(normalizeGame({ meta: { pin: '123456' }, current: { phase: 'closed' } })?.current).toBeUndefined();
    expect(normalizeGame({ meta: { pin: '123456' }, current: { drinkId: 'a', phase: 'party' } })?.current?.phase).toBe('preparing');
  });

  it('behåller röster och specialprisröster', () => {
    const g = normalizeGame({
      meta: { pin: '123456' },
      votes: { a: { b: allOf(7) } },
      awardVotes: { swamp: { a: 'b' } },
    });
    expect(g?.votes).toEqual({ a: { b: allOf(7) } });
    expect(g?.awardVotes).toEqual({ swamp: { a: 'b' } });
  });
});

describe('playerEntries & effectiveOrder', () => {
  it('sorterar spelare efter joinedAt (och id vid lika)', () => {
    const g = makeGame({ players: [['c', { joinedAt: 5 }], ['a', { joinedAt: 9 }], ['b', { joinedAt: 5 }]] });
    expect(playerEntries(g).map(([id]) => id)).toEqual(['b', 'c', 'a']);
  });

  it('följer den sparade ordningen', () => {
    const g = makeGame({ players: ['a', 'b', 'c'], order: ['c', 'a', 'b'] });
    expect(effectiveOrder(g)).toEqual(['c', 'a', 'b']);
  });

  it('tar bort borttagna spelare och dubbletter', () => {
    const g = makeGame({ players: ['a', 'b', 'c'], order: ['c', 'ghost', 'a', 'c', 'b'] });
    expect(effectiveOrder(g)).toEqual(['c', 'a', 'b']);
  });

  it('lägger sena anslutningar sist i den ordning de gick med', () => {
    const g = makeGame({
      players: ['a', 'b', ['late2', { joinedAt: 50 }], ['late1', { joinedAt: 40 }], 'c'],
      order: ['c', 'a', 'b'],
    });
    expect(effectiveOrder(g)).toEqual(['c', 'a', 'b', 'late1', 'late2']);
  });

  it('utan sparad ordning används anslutningsordningen', () => {
    const g = makeGame({ players: ['a', 'b', 'c'], order: [] });
    expect(effectiveOrder(g)).toEqual(['a', 'b', 'c']);
  });
});

describe('röstare och röster', () => {
  const g = makeGame({
    players: ['a', 'b', ['m', { manual: true }], 'c'],
    votes: { a: { b: allOf(7), a: allOf(10), m: allOf(5), ghost: allOf(5), c: { taste: 0 } } },
  });

  it('expectedVoters utesluter manuella spelare och skaparen', () => {
    expect(votingPlayerIds(g)).toEqual(['a', 'b', 'c']);
    expect(expectedVoters(g, 'a')).toEqual(['b', 'c']);
    expect(expectedVoters(g, 'm')).toEqual(['a', 'b', 'c']);
  });

  it('votesForDrink tar bara med giltiga röster från andra spelare som finns kvar', () => {
    expect(Object.keys(votesForDrink(g, 'a')).sort()).toEqual(['b', 'm']);
    expect(votesForDrink(g, 'b')).toEqual({});
    expect(hasVoted(g, 'a', 'b')).toBe(true);
    expect(hasVoted(g, 'a', 'a')).toBe(false);
    expect(hasVoted(g, 'a', 'c')).toBe(false);
    expect(hasVoted(g, 'a', 'ghost')).toBe(false);
  });

  it('isValidVote kräver heltal 1–10 i alla kategorier', () => {
    expect(isValidVote(allOf(1))).toBe(true);
    expect(isValidVote(allOf(10))).toBe(true);
    expect(isValidVote({ ...allOf(5), taste: 0 })).toBe(false);
    expect(isValidVote({ ...allOf(5), look: 11 })).toBe(false);
    expect(isValidVote({ ...allOf(5), creativity: 5.5 })).toBe(false);
    expect(isValidVote({ taste: 5, look: 5, creativity: 5 })).toBe(false);
    expect(isValidVote(null)).toBe(false);
  });
});

describe('currentDrink', () => {
  it('är null utan aktuell drink', () => {
    expect(currentDrink(makeGame({ players: ['a', 'b'] }))).toBeNull();
  });

  it('returnerar skaparen, positionen i ordningen och totalen', () => {
    const g = makeGame({ players: ['a', 'b', 'c'], order: ['c', 'a', 'b'], current: cur('a', 0, 'voting') });
    const d = currentDrink(g);
    expect(d?.id).toBe('a');
    expect(d?.player.name).toBe('A');
    expect(d?.index).toBe(1); // positionen räknas fram ur ordningen, inte ur current.index
    expect(d?.total).toBe(3);
  });

  it('är null om skaparen har tagits bort', () => {
    expect(currentDrink(makeGame({ players: ['a', 'b'], current: cur('ghost', 0) }))).toBeNull();
  });
});

describe('nextDrinkIndex', () => {
  it('börjar på 0 innan tävlingen startat (null utan spelare)', () => {
    expect(nextDrinkIndex(makeGame({ players: ['a', 'b'] }))).toBe(0);
    expect(nextDrinkIndex(makeGame({ players: [] }))).toBeNull();
  });

  it('pekar på drinken efter den aktuella', () => {
    const g = makeGame({ players: ['a', 'b', 'c'], current: cur('a', 0, 'closed') });
    expect(nextDrinkIndex(g)).toBe(1);
    expect(nextDrinkIndex({ ...g, current: cur('b', 1) })).toBe(2);
  });

  it('är null när sista drinken är aktuell', () => {
    expect(nextDrinkIndex(makeGame({ players: ['a', 'b', 'c'], current: cur('c', 2, 'closed') }))).toBeNull();
  });

  it('räknar från drinkens plats i ordningen även om current.index är inaktuellt', () => {
    // En spelare före den aktuella drinken togs bort → current.index (2) pekar fel, drinkId gäller.
    const g = makeGame({ players: ['a', 'c', 'd'], order: ['a', 'c', 'd'], current: cur('c', 2) });
    expect(nextDrinkIndex(g)).toBe(2);
  });

  it('hoppar inte över någon drink när den aktuella drinkens skapare försvunnit (regression)', () => {
    // Ordningen var a, b, c, d och b var aktuell (index 1). b försvann → c ligger nu på index 1 och har inte visats.
    const g = makeGame({ players: ['a', 'c', 'd'], order: ['a', 'b', 'c', 'd'], current: cur('b', 1, 'voting') });
    expect(effectiveOrder(g)).toEqual(['a', 'c', 'd']);
    expect(nextDrinkIndex(g)).toBe(1);
    // Var den försvunna drinken sist finns ingen nästa.
    const last = makeGame({ players: ['a', 'b'], order: ['a', 'b', 'c'], current: cur('c', 2) });
    expect(nextDrinkIndex(last)).toBeNull();
  });
});

describe('completedDrinkIds', () => {
  const players = ['a', 'b', 'c', 'd'];

  it('är tom innan första drinken', () => {
    expect(completedDrinkIds(makeGame({ players, status: 'lobby' }))).toEqual([]);
  });

  it('innehåller drinkarna före den aktuella, och den aktuella när röstningen är låst', () => {
    expect(completedDrinkIds(makeGame({ players, current: cur('c', 2, 'preparing') }))).toEqual(['a', 'b']);
    expect(completedDrinkIds(makeGame({ players, current: cur('c', 2, 'voting') }))).toEqual(['a', 'b']);
    expect(completedDrinkIds(makeGame({ players, current: cur('c', 2, 'closed') }))).toEqual(['a', 'b', 'c']);
    expect(completedDrinkIds(makeGame({ players, current: cur('a', 0, 'preparing') }))).toEqual([]);
  });

  it('följer den sparade ordningen', () => {
    const g = makeGame({ players, order: ['d', 'c', 'b', 'a'], current: cur('b', 2, 'closed') });
    expect(completedDrinkIds(g)).toEqual(['d', 'c', 'b']);
  });

  it('innehåller alla drinkar efter tävlingen', () => {
    for (const status of ['awards', 'ceremony', 'finished'] as const) {
      expect(completedDrinkIds(makeGame({ players, status, current: cur('b', 1, 'closed') }))).toEqual(players);
    }
  });

  it('räknar drinkarna före den försvunna aktuella drinken som klara (regression)', () => {
    const g = makeGame({ players: ['a', 'c', 'd'], order: ['a', 'b', 'c', 'd'], current: cur('b', 1, 'closed') });
    expect(completedDrinkIds(g)).toEqual(['a']);
  });
});

describe('awardVoteProgress', () => {
  it('räknar giltiga specialprisröster per röstberättigad spelare', () => {
    const g = makeGame({
      status: 'awards',
      players: ['a', 'b', 'c', ['m', { manual: true }]],
      awardVotes: {
        name: { a: 'b', b: 'b', c: 'a' }, // b röstade på sig själv → räknas inte
        daring: { a: 'm', b: 'ghost' }, // ghost finns inte → räknas inte
        swamp: { a: 'c' },
        favorite: { a: 'b', c: 'b' },
      },
    });
    expect(awardVoteProgress(g, AWARD_IDS)).toEqual([
      { playerId: 'a', done: 4, total: 4 },
      { playerId: 'b', done: 0, total: 4 },
      { playerId: 'c', done: 2, total: 4 },
    ]);
    expect(awardVoteProgress(g, ['swamp'])).toEqual([
      { playerId: 'a', done: 1, total: 1 },
      { playerId: 'b', done: 0, total: 1 },
      { playerId: 'c', done: 0, total: 1 },
    ]);
  });
});
