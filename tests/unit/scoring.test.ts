import { describe, expect, it } from 'vitest';
import { AWARD_IDS, AWARDS, CATEGORIES, TRIM_MIN_VOTES, WEIGHT_SUM, computeResults, voteTotal } from '../../src/lib/scoring';
import type { Vote } from '../../src/lib/types';
import { allOf, fullGame, ids, makeGame, vote, voteWithWeightedSum, weightedSum } from './fixtures';

const byId = (results: ReturnType<typeof computeResults>, id: string) => {
  const d = results.ranking.find((x) => x.playerId === id);
  if (!d) throw new Error(`Drinken ${id} saknas i resultatet`);
  return d;
};

/** Spel där drinken "d" får de givna rösterna (en per domare j1, j2, …). */
function gameWithVotesOn(votes: Vote[], settings: { trimExtremes?: boolean } = {}) {
  const judges = ids(votes.length, 'j');
  return makeGame({
    players: ['d', ...judges],
    votes: { d: Object.fromEntries(judges.map((j, i) => [j, votes[i]])) },
    settings,
  });
}

describe('voteTotal', () => {
  it('viktar kategorierna 4/2/2/1 (summa 9)', () => {
    expect(CATEGORIES.map((c) => [c.id, c.weight])).toEqual([
      ['taste', 4],
      ['look', 2],
      ['creativity', 2],
      ['again', 1],
    ]);
    expect(WEIGHT_SUM).toBe(9);
  });

  it('ger 100 när allt är 10 och 10 när allt är 1', () => {
    expect(voteTotal(allOf(10))).toBe(100);
    expect(voteTotal(allOf(1))).toBe(10);
    expect(voteTotal(allOf(7))).toBeCloseTo(70, 10);
  });

  it('räknar varje kategori med sin vikt', () => {
    // (4·10 + 2 + 2 + 1) / 9 · 10 = 50
    expect(voteTotal(vote(10, 1, 1, 1))).toBeCloseTo(50, 10);
    // (4 + 2·10 + 2 + 1) / 9 · 10 = 30
    expect(voteTotal(vote(1, 10, 1, 1))).toBeCloseTo(30, 10);
    expect(voteTotal(vote(1, 1, 10, 1))).toBeCloseTo(30, 10);
    // (4 + 2 + 2 + 10) / 9 · 10 = 20
    expect(voteTotal(vote(1, 1, 1, 10))).toBeCloseTo(20, 10);
    // (28 + 16 + 12 + 9) / 9 · 10 = 72,22…
    expect(voteTotal(vote(7, 8, 6, 9))).toBeCloseTo(650 / 9, 10);
  });
});

describe('computeResults – poäng', () => {
  it('räknar snittet av domarnas totalpoäng', () => {
    const r = computeResults(gameWithVotesOn([allOf(8), allOf(6)]));
    const d = byId(r, 'd');
    expect(d.score).toBe(70);
    expect(d.voteCount).toBe(2);
    expect(d.trimmed).toBe(false);
    expect(d.categoryAvg).toEqual({ taste: 7, look: 7, creativity: 7, again: 7 });
    expect(d.judges.map((j) => j.voterId)).toEqual(['j1', 'j2']); // högst först
    expect(d.judges.every((j) => !j.dropped)).toBe(true);
    expect(d.stdDev).toBeCloseTo(10, 10);
    expect(r.totalVotes).toBe(2);
    expect(r.trimApplied).toBe(false);
  });

  it('OS-regeln stryker exakt en högsta och en lägsta när drinken har minst 5 röster', () => {
    expect(TRIM_MIN_VOTES).toBe(5);
    const r = computeResults(gameWithVotesOn([allOf(10), allOf(8), allOf(7), allOf(6), allOf(1)]));
    const d = byId(r, 'd');
    expect(d.trimmed).toBe(true);
    expect(r.trimApplied).toBe(true);
    expect(d.score).toBe(70); // (80 + 70 + 60) / 3
    expect(d.voteCount).toBe(5); // strukna röster räknas fortfarande som röster
    expect(d.judges.filter((j) => j.dropped).map((j) => j.voterId)).toEqual(['j1', 'j5']);
    expect(d.judges[0].dropped).toBe(true);
    expect(d.judges[d.judges.length - 1].dropped).toBe(true);
  });

  it('OS-regeln stryker bara en av flera lika höga/låga betyg', () => {
    const r = computeResults(gameWithVotesOn([allOf(10), allOf(10), allOf(5), allOf(5), allOf(5)]));
    const d = byId(r, 'd');
    expect(d.judges.filter((j) => j.dropped)).toHaveLength(2);
    expect(d.score).toBe(66.7); // (100 + 50 + 50) / 3 = 66,67
  });

  it('OS-regeln tillämpas inte med färre än 5 röster', () => {
    const r = computeResults(gameWithVotesOn([allOf(10), allOf(8), allOf(6), allOf(1)]));
    const d = byId(r, 'd');
    expect(d.trimmed).toBe(false);
    expect(r.trimApplied).toBe(false);
    expect(d.judges.some((j) => j.dropped)).toBe(false);
    expect(d.score).toBe(62.5); // (100 + 80 + 60 + 10) / 4
  });

  it('OS-regeln tillämpas inte när den är avstängd', () => {
    const r = computeResults(gameWithVotesOn([allOf(10), allOf(8), allOf(7), allOf(6), allOf(1)], { trimExtremes: false }));
    const d = byId(r, 'd');
    expect(d.trimmed).toBe(false);
    expect(r.trimApplied).toBe(false);
    expect(d.score).toBe(64); // (100 + 80 + 70 + 60 + 10) / 5
  });

  it('kategorisnitten räknar med alla röster, även de strukna', () => {
    const r = computeResults(gameWithVotesOn([allOf(10), allOf(8), allOf(7), allOf(6), allOf(1)]));
    expect(byId(r, 'd').categoryAvg.taste).toBeCloseTo(6.4, 10);
  });

  it('avrundar slutpoängen till en decimal', () => {
    // 70 och 78,89 → 74,44 → 74,4
    const r = computeResults(gameWithVotesOn([allOf(7), vote(8, 8, 8, 7)]));
    expect(byId(r, 'd').score).toBe(74.4);
    // 70 och 72,22 → 71,11 → 71,1
    const r2 = computeResults(gameWithVotesOn([allOf(7), vote(7, 8, 6, 9)]));
    expect(byId(r2, 'd').score).toBe(71.1);
    // 1/3-delar avrundas uppåt korrekt: (100 + 50 + 50) / 3 = 66,666… → 66,7 (se ovan)
  });

  it('avrundar exakta halvor uppåt trots flyttalsfel (regression)', () => {
    // Viktade summor med exakt snitt 423 / 72 · 10 = 58,75. Naivt flyttalssnitt blir 58,74999… → 58,7.
    const sums = [28, 19, 69, 71, 62, 75, 12, 87];
    expect(sums.reduce((a, b) => a + b, 0)).toBe(423);
    const votes = sums.map(voteWithWeightedSum);
    votes.forEach((v, i) => expect(weightedSum(v)).toBe(sums[i]));

    const plain = computeResults(gameWithVotesOn(votes, { trimExtremes: false }));
    expect(byId(plain, 'd').score).toBe(58.8);

    // Samma åtta domare + en extremt hög och en extremt låg som stryks av OS-regeln.
    const trimmed = computeResults(gameWithVotesOn([allOf(10), ...votes, allOf(1)]));
    const d = byId(trimmed, 'd');
    expect(d.trimmed).toBe(true);
    expect(d.score).toBe(58.8);
  });

  it('ger två drinkar med matematiskt samma snitt samma slutpoäng (regression)', () => {
    // Olika betyg men samma exakta snitt (58,75). Naivt flyttalssnitt gav 58,8 resp. 58,7.
    const sumsX = [26, 62, 67, 87, 63, 53, 18, 47];
    const sumsY = [28, 19, 69, 71, 62, 75, 12, 87];
    expect(sumsX.reduce((a, b) => a + b, 0)).toBe(sumsY.reduce((a, b) => a + b, 0));
    const judges = ids(8, 'j');
    const game = makeGame({
      players: ['x', 'y', ...judges],
      votes: {
        x: Object.fromEntries(judges.map((j, i) => [j, voteWithWeightedSum(sumsX[i])])),
        y: Object.fromEntries(judges.map((j, i) => [j, voteWithWeightedSum(sumsY[i])])),
      },
      settings: { trimExtremes: false },
    });
    const r = computeResults(game);
    expect(byId(r, 'x').score).toBe(58.8);
    expect(byId(r, 'y').score).toBe(58.8);
  });
});

describe('computeResults – ogiltiga och otillåtna röster', () => {
  it('ignorerar röst på egen drink och röster från borttagna spelare', () => {
    const game = makeGame({
      players: ['a', 'b'],
      votes: { a: { a: allOf(10), b: allOf(6), ghost: allOf(1) } },
    });
    const d = byId(computeResults(game), 'a');
    expect(d.voteCount).toBe(1);
    expect(d.score).toBe(60);
    expect(d.judges.map((j) => j.voterId)).toEqual(['b']);
  });

  it('ignorerar ogiltiga röster', () => {
    const invalid: unknown[] = [
      { taste: 0, look: 5, creativity: 5, again: 5, at: 1 },
      { taste: 11, look: 5, creativity: 5, again: 5, at: 1 },
      { taste: 7.5, look: 5, creativity: 5, again: 5, at: 1 },
      { taste: '8', look: 5, creativity: 5, again: 5, at: 1 },
      { look: 5, creativity: 5, again: 5, at: 1 },
      null,
      'tio',
    ];
    const voters = ids(invalid.length, 'v');
    const game = makeGame({
      players: ['a', 'ok', ...voters],
      votes: { a: { ok: allOf(9), ...Object.fromEntries(voters.map((v, i) => [v, invalid[i]])) } },
    });
    const r = computeResults(game);
    const d = byId(r, 'a');
    expect(d.voteCount).toBe(1);
    expect(d.score).toBe(90);
    expect(r.totalVotes).toBe(1);
  });

  it('tar inte med drinkar från borttagna spelare', () => {
    const game = makeGame({ players: ['a', 'b'], order: ['ghost', 'a', 'b'], votes: { ghost: { a: allOf(10) } } });
    const r = computeResults(game);
    expect(r.ranking.map((d) => d.playerId).sort()).toEqual(['a', 'b']);
    expect(byId(r, 'a').orderIndex).toBe(0);
    expect(byId(r, 'b').orderIndex).toBe(1);
  });
});

describe('computeResults – placering', () => {
  it('sorterar på slutpoäng', () => {
    const game = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { b: allOf(5) }, b: { c: allOf(9) }, c: { a: allOf(7) } },
    });
    const r = computeResults(game);
    expect(r.ranking.map((d) => [d.playerId, d.rank])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('vid lika poäng vinner högst snitt på smak', () => {
    // Båda 50 poäng: a har smak 1, b har smak 10. a presenterades först men b vinner.
    expect(voteTotal(vote(1, 10, 10, 1))).toBeCloseTo(voteTotal(vote(10, 1, 1, 1)), 10);
    const game = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { c: vote(1, 10, 10, 1) }, b: { c: vote(10, 1, 1, 1) } },
    });
    const r = computeResults(game);
    expect(byId(r, 'a').score).toBe(byId(r, 'b').score);
    expect(r.ranking.map((d) => [d.playerId, d.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });

  it('vid lika poäng och smak vinner flest 10:or', () => {
    // Båda viktad summa 49 och smak 5; b har en 10:a.
    const noTens = vote(5, 6, 6, 5);
    const oneTen = vote(5, 10, 2, 5);
    expect(weightedSum(noTens)).toBe(weightedSum(oneTen));
    const game = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { c: noTens }, b: { c: oneTen } },
    });
    const r = computeResults(game);
    expect(byId(r, 'b').tens).toBe(1);
    expect(byId(r, 'a').tens).toBe(0);
    expect(r.ranking.map((d) => [d.playerId, d.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });

  it('delar placering när allt är lika (och nästa placering hoppar över)', () => {
    const game = makeGame({
      players: ['a', 'b', 'c', 'd'],
      votes: { a: { d: allOf(8) }, b: { d: allOf(8) }, c: { a: allOf(5) }, d: { a: allOf(9) } },
    });
    const r = computeResults(game);
    expect(r.ranking.map((d) => [d.playerId, d.rank])).toEqual([
      ['d', 1],
      ['a', 2],
      ['b', 2], // samma betyg som a → delad placering, ordningen följer presentationsordningen
      ['c', 4],
    ]);
  });

  it('drinkar utan röster får poäng null och hamnar sist (med delad placering)', () => {
    const game = makeGame({
      players: ['a', 'b', 'c', 'd'],
      votes: { c: { a: allOf(2) } },
    });
    const r = computeResults(game);
    expect(r.ranking.map((d) => d.playerId)).toEqual(['c', 'a', 'b', 'd']);
    expect(byId(r, 'c').rank).toBe(1);
    for (const id of ['a', 'b', 'd']) {
      const d = byId(r, id);
      expect(d.score).toBeNull();
      expect(d.voteCount).toBe(0);
      expect(d.stdDev).toBeNull();
      expect(d.categoryAvg).toEqual({ taste: null, look: null, creativity: null, again: null });
      expect(d.rank).toBe(2);
    }
  });

  it('en drink med låg poäng placeras före drinkar utan röster', () => {
    const game = makeGame({ players: ['a', 'b'], votes: { b: { a: allOf(1) } } });
    const r = computeResults(game);
    expect(r.ranking.map((d) => [d.playerId, d.score, d.rank])).toEqual([
      ['b', 10, 1],
      ['a', null, 2],
    ]);
  });
});

describe('computeResults – specialpriser', () => {
  const players = ['a', 'b', 'c', 'd'];

  it('räknar röster och utser vinnaren', () => {
    const game = makeGame({
      players,
      status: 'awards',
      awardVotes: { favorite: { a: 'c', b: 'c', c: 'a', d: 'c' } },
    });
    const r = computeResults(game);
    expect(r.awards.map((a) => a.id)).toEqual(AWARD_IDS);
    expect(AWARDS.map((a) => a.id)).toEqual(['name', 'daring', 'swamp', 'favorite']);
    const fav = r.awards.find((a) => a.id === 'favorite')!;
    expect(fav.totalVotes).toBe(4);
    expect(fav.winners.map((w) => [w.playerId, w.votes, w.name])).toEqual([['c', 3, 'C']]);
    for (const a of r.awards.filter((x) => x.id !== 'favorite')) {
      expect(a.winners).toEqual([]);
      expect(a.totalVotes).toBe(0);
    }
  });

  it('ger flera vinnare vid lika antal röster (i presentationsordning)', () => {
    const game = makeGame({
      players,
      order: ['d', 'c', 'b', 'a'],
      awardVotes: { swamp: { a: 'b', b: 'd', c: 'b', d: 'a', e: 'a' } },
    });
    // e finns inte → rösten räknas inte. b: 2, d: 1, a: 1
    const swamp = computeResults(game).awards.find((a) => a.id === 'swamp')!;
    expect(swamp.winners.map((w) => w.playerId)).toEqual(['b']);

    const tied = makeGame({
      players,
      order: ['d', 'c', 'b', 'a'],
      awardVotes: { name: { a: 'b', b: 'd', c: 'd', d: 'b' } },
    });
    const name = computeResults(tied).awards.find((a) => a.id === 'name')!;
    expect(name.winners.map((w) => [w.playerId, w.votes])).toEqual([
      ['d', 2],
      ['b', 2],
    ]);
    expect(name.totalVotes).toBe(4);
  });

  it('ignorerar röster på sig själv, från borttagna och på borttagna spelare', () => {
    const game = makeGame({
      players,
      awardVotes: { daring: { a: 'a', b: 'ghost', ghost: 'c', c: 'd' } },
    });
    const daring = computeResults(game).awards.find((a) => a.id === 'daring')!;
    expect(daring.totalVotes).toBe(1);
    expect(daring.winners.map((w) => [w.playerId, w.votes])).toEqual([['d', 1]]);
  });
});

describe('computeResults – kategorivinnare', () => {
  it('utser bäst i varje kategori bland drinkar med röster', () => {
    const game = makeGame({
      players: ['a', 'b', 'c', 'd'],
      votes: {
        a: { d: vote(9, 2, 5, 5) },
        b: { d: vote(5, 9, 5, 9) },
        c: { d: vote(5, 5, 9, 5) },
      },
    });
    const r = computeResults(game);
    expect(r.categoryWinners.map((w) => [w.categoryId, w.playerId, w.avg])).toEqual([
      ['taste', 'a', 9],
      ['look', 'b', 9],
      ['creativity', 'c', 9],
      ['again', 'b', 9],
    ]);
    // d har inga röster och kan inte vinna något
    expect(r.categoryWinners.some((w) => w.playerId === 'd')).toBe(false);
  });

  it('vid lika kategorisnitt vinner den med bäst placering', () => {
    const game = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { c: vote(8, 5, 5, 5) }, b: { c: vote(8, 9, 9, 9) } },
    });
    const taste = computeResults(game).categoryWinners.find((w) => w.categoryId === 'taste')!;
    expect(taste.playerId).toBe('b');
  });

  it('är tom när ingen har röstat', () => {
    expect(computeResults(makeGame({ players: ['a', 'b'] })).categoryWinners).toEqual([]);
  });
});

describe('computeResults – domare och statistik', () => {
  it('räknar domarstatistik och sorterar snällast först', () => {
    const game = makeGame({
      players: ['a', 'b', 'c'],
      votes: {
        a: { b: allOf(10), c: allOf(4) },
        b: { a: allOf(6), c: allOf(2) },
        c: { a: allOf(8), b: vote(10, 10, 9, 9) },
      },
    });
    const r = computeResults(game);
    expect(r.judges.map((j) => [j.playerId, j.votesGiven, j.tensGiven])).toEqual([
      ['b', 2, 6],
      ['a', 2, 0],
      ['c', 2, 0],
    ]);
    expect(r.judges[0].avgGiven).toBeCloseTo((100 + voteTotal(vote(10, 10, 9, 9))) / 2, 10);
    expect(r.stats.kindest?.playerId).toBe('b');
    expect(r.stats.harshest?.playerId).toBe('c');
    expect(r.stats.mostTens?.playerId).toBe('b');
    expect(r.stats.highestSingle?.judge.playerId).toBe('b');
    expect(r.stats.highestSingle?.drink.playerId).toBe('a');
    expect(r.stats.highestSingle?.total).toBe(100);
  });

  it('snällast/hårdast kräver minst två domare med minst två röster', () => {
    const oneEligible = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { b: allOf(9), c: allOf(3) }, b: { c: allOf(5) } },
    });
    const r = computeResults(oneEligible);
    expect(r.judges.find((j) => j.playerId === 'c')?.votesGiven).toBe(2);
    expect(r.judges.find((j) => j.playerId === 'b')?.votesGiven).toBe(1);
    expect(r.stats.kindest).toBeUndefined();
    expect(r.stats.harshest).toBeUndefined();

    const twoEligible = makeGame({
      players: ['a', 'b', 'c'],
      votes: { a: { b: allOf(9), c: allOf(3) }, b: { c: allOf(5) }, c: { b: allOf(7) } },
    });
    const r2 = computeResults(twoEligible);
    expect(r2.stats.kindest?.playerId).toBe('b'); // 90 + 70
    expect(r2.stats.harshest?.playerId).toBe('c'); // 30 + 50
  });

  it('mest oense/eniga kräver minst två drinkar med minst tre röster', () => {
    const players = ['a', 'b', 'c', 'd'];
    const oneDrink = makeGame({
      players,
      votes: { a: { b: allOf(1), c: allOf(5), d: allOf(10) }, b: { a: allOf(5), c: allOf(5) } },
    });
    const r = computeResults(oneDrink);
    expect(r.stats.mostDivisive).toBeUndefined();
    expect(r.stats.mostUnanimous).toBeUndefined();

    const twoDrinks = makeGame({
      players,
      votes: {
        a: { b: allOf(1), c: allOf(5), d: allOf(10) },
        b: { a: allOf(5), c: allOf(5), d: allOf(6) },
        c: { a: allOf(2), b: allOf(9) }, // bara två röster → räknas inte
      },
    });
    const r2 = computeResults(twoDrinks);
    expect(r2.stats.mostDivisive?.playerId).toBe('a');
    expect(r2.stats.mostUnanimous?.playerId).toBe('b');
  });

  it('har ingen statistik alls utan röster', () => {
    const r = computeResults(makeGame({ players: ['a', 'b', 'c'] }));
    expect(r.stats).toEqual({});
    expect(r.judges).toEqual([]);
    expect(r.totalVotes).toBe(0);
  });

  it('mostTens saknas när ingen har gett en 10:a', () => {
    const r = computeResults(makeGame({ players: ['a', 'b'], votes: { a: { b: allOf(9) }, b: { a: allOf(3) } } }));
    expect(r.stats.mostTens).toBeUndefined();
    expect(r.stats.highestSingle?.total).toBe(90);
  });
});

describe('computeResults – kommentarer', () => {
  const voters = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];

  function commentGame(voterOrder: string[]) {
    return makeGame({
      players: ['d', ...voters],
      votes: { d: Object.fromEntries(voterOrder.map((v) => [v, allOf(7, `från ${v}`)])) },
    });
  }

  it('har en stabil ordning som inte beror på i vilken ordning rösterna kom', () => {
    const a = byId(computeResults(commentGame(voters)), 'd').comments;
    const b = byId(computeResults(commentGame([...voters].reverse())), 'd').comments;
    expect(a).toHaveLength(voters.length);
    expect(b).toEqual(a);
  });

  it('följer inte röstarnas ordning', () => {
    const comments = byId(computeResults(commentGame(voters)), 'd').comments;
    const inVoterOrder = voters.map((v) => `från ${v}`);
    expect(comments).not.toEqual(inVoterOrder);
    expect(comments).not.toEqual([...inVoterOrder].reverse());
    expect([...comments].sort()).toEqual([...inVoterOrder].sort());
  });

  it('trimmar och hoppar över tomma kommentarer', () => {
    const game = makeGame({
      players: ['d', 'a', 'b', 'c'],
      votes: { d: { a: allOf(7, '  Santé !  '), b: allOf(7, '   '), c: allOf(7) } },
    });
    expect(byId(computeResults(game), 'd').comments).toEqual(['Santé !']);
  });

  it('tar inte med kommentarer från ogiltiga röster', () => {
    const game = makeGame({
      players: ['d', 'a'],
      votes: { d: { d: allOf(7, 'egen'), ghost: allOf(7, 'spöke'), a: allOf(7, 'ok') } },
    });
    expect(byId(computeResults(game), 'd').comments).toEqual(['ok']);
  });
});

describe('computeResults – deterministiskt', () => {
  it('ger samma resultat för samma data', () => {
    const g = fullGame(8, { comments: true, awards: true });
    expect(computeResults(g)).toEqual(computeResults(structuredClone(g)));
  });
});
