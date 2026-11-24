/**
 * Spel-actions i src/lib/game.ts mot ett databaslager i minnet (se fakeBackend.ts).
 * Varje "mobil" simuleras genom att byta inloggat uid.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/backend', async () => {
  const types = await vi.importActual<typeof import('../../src/lib/backend/types')>('../../src/lib/backend/types');
  const { createFakeBackend } = await import('./fakeBackend');
  return { ...types, backend: createFakeBackend(), isDemoMode: false };
});

import { backend } from '../../src/lib/backend';
import {
  COMMENT_MAX,
  JoinError,
  NAME_MAX,
  addManualPlayer,
  closeVoting,
  createGame,
  deleteGame,
  drawOrder,
  editPlayer,
  findGameByPin,
  finishGame,
  goToDrink,
  jumpToDrink,
  joinGame,
  loadGame,
  moveInOrder,
  nextDrink,
  normalizePin,
  openVoting,
  removePlayer,
  reopenGame,
  setCeremonyStep,
  startAwards,
  startCeremony,
  startGame,
  submitAwardVote,
  submitVote,
} from '../../src/lib/game';
import { computeResults } from '../../src/lib/scoring';
import { completedDrinkIds, DEFAULT_SETTINGS, effectiveOrder, nextDrinkIndex } from '../../src/lib/selectors';
import type { Game, HallOfFameEntry } from '../../src/lib/types';
import type { FakeBackend } from './fakeBackend';
import { allOf } from './fixtures';

const db = backend as unknown as FakeBackend;

function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  db.setUid(uid);
  return fn().finally(() => db.setUid('admin'));
}

async function game(gameId: string): Promise<Game> {
  const g = await loadGame(gameId);
  if (!g) throw new Error('Spelet finns inte');
  return g;
}

/** Skapar ett spel med spelarna (uid = namn i gemener) i den ordningen. */
async function setup(names: string[]): Promise<{ gameId: string; pin: string }> {
  const created = await createGame('Bonjour Babes');
  for (const name of names) await as(name.toLowerCase(), () => joinGame(created.gameId, { name, drink: `${name}s drink` }));
  return created;
}

beforeEach(() => db.reset());

describe('createGame & PIN', () => {
  it('skapar spel, inställningar och PIN i en och samma uppdatering', async () => {
    const { gameId, pin } = await createGame('  ', { trimExtremes: false });
    expect(pin).toMatch(/^[0-9]{6}$/);
    expect(db.updates.at(-1)?.keys.sort()).toEqual([`games/${gameId}/meta`, `games/${gameId}/settings`, `pins/${pin}`].sort());
    const g = await game(gameId);
    expect(g.meta).toMatchObject({ name: 'Bonjour Babes', pin, status: 'lobby' });
    expect(g.meta.createdAt).toBeGreaterThan(0);
    expect(g.settings).toEqual({ ...DEFAULT_SETTINGS, trimExtremes: false });
    expect(await findGameByPin(pin)).toMatchObject({ gameId });
    expect(await findGameByPin(` ${pin.slice(0, 3)}-${pin.slice(3)} `)).toMatchObject({ gameId });
  });

  it('normalizePin och okända PIN-koder', async () => {
    expect(normalizePin(' 12a34-56789')).toBe('123456');
    expect(await findGameByPin('123')).toBeNull();
    expect(await findGameByPin('999999')).toBeNull();
  });
});

describe('joinGame', () => {
  it('sparar namn och drink städade, med avatar och servertid', async () => {
    const { gameId } = await createGame();
    await as('u1', () => joinGame(gameId, { name: '  Alva   Ek ', drink: ' Le   Spritz ' }));
    const p = (await game(gameId)).players.u1;
    expect(p).toMatchObject({ name: 'Alva Ek', drink: 'Le Spritz' });
    expect(p.emoji.length).toBeGreaterThan(0);
    expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(typeof p.joinedAt).toBe('number');
    expect(p.manual).toBeUndefined();
    expect(Object.keys(db.data().games as object)).toEqual([gameId]);
  });

  it('kortar för långa namn', async () => {
    const { gameId } = await createGame();
    await as('u1', () => joinGame(gameId, { name: 'x'.repeat(40), drink: 'y'.repeat(80) }));
    const p = (await game(gameId)).players.u1;
    expect(p.name).toHaveLength(NAME_MAX);
    expect(p.drink).toHaveLength(40);
  });

  it('kräver namn och drink och ett unikt namn', async () => {
    const { gameId } = await setup(['Alva']);
    await expect(as('u2', () => joinGame(gameId, { name: '  ', drink: 'X' }))).rejects.toBeInstanceOf(JoinError);
    await expect(as('u2', () => joinGame(gameId, { name: 'Bo', drink: ' ' }))).rejects.toBeInstanceOf(JoinError);
    await expect(as('u2', () => joinGame(gameId, { name: 'ALVA', drink: 'X' }))).rejects.toThrow(/redan taget/);
    await expect(as('u2', () => joinGame('finns-inte', { name: 'Bo', drink: 'X' }))).rejects.toThrow(/finns inte/);
  });

  it('låter en spelare ändra sig och behåller anslutningstiden och avataren', async () => {
    const { gameId } = await setup(['Alva']);
    const before = (await game(gameId)).players.alva;
    await as('alva', () => joinGame(gameId, { name: 'Alva', drink: 'Ny drink' }));
    const after = (await game(gameId)).players.alva;
    expect(after).toEqual({ ...before, drink: 'Ny drink' });
  });

  it('tar emot sena anslutningar under tävlingen men inte efter', async () => {
    const { gameId } = await setup(['Alva', 'Bo']);
    await startGame(gameId);
    await as('cleo', () => joinGame(gameId, { name: 'Cleo', drink: 'Sen drink' }));
    expect(effectiveOrder(await game(gameId)).at(-1)).toBe('cleo');

    await startAwards(gameId);
    await expect(as('dan', () => joinGame(gameId, { name: 'Dan', drink: 'X' }))).rejects.toBeInstanceOf(JoinError);
    // Den som redan är med får fortfarande ändra sig.
    await as('cleo', () => joinGame(gameId, { name: 'Cleo', drink: 'Ändrad' }));
    expect((await game(gameId)).players.cleo.drink).toBe('Ändrad');
  });
});

describe('ordning', () => {
  it('drawOrder lottar alla och sparar lottningen för storskärmen', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D', 'E']);
    const order = await drawOrder(gameId);
    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const g = await game(gameId);
    expect(g.order).toEqual(order);
    expect(g.lottery?.order).toEqual(order);
    expect(g.lottery?.at).toBeGreaterThan(0);
  });

  it('drawOrder under tävlingen lottar bara om drinkarna som inte visats', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D', 'E', 'F']);
    await startGame(gameId);
    await goToDrink(gameId, 2);
    const before = effectiveOrder(await game(gameId));
    for (let i = 0; i < 5; i++) {
      const order = await drawOrder(gameId);
      expect(order.slice(0, 3)).toEqual(before.slice(0, 3));
      expect([...order.slice(3)].sort()).toEqual([...before.slice(3)].sort());
    }
  });

  it('moveInOrder flyttar ett steg och ignorerar flytt utanför listan', async () => {
    const { gameId } = await setup(['A', 'B', 'C']);
    await moveInOrder(gameId, 'c', -1);
    expect(effectiveOrder(await game(gameId))).toEqual(['a', 'c', 'b']);
    await moveInOrder(gameId, 'a', -1);
    await moveInOrder(gameId, 'b', 1);
    expect(effectiveOrder(await game(gameId))).toEqual(['a', 'c', 'b']);
  });
});

describe('en hel kväll', () => {
  it('från lobby till Hall of Fame', async () => {
    const names = ['Alva', 'Bo', 'Cleo', 'Dan'];
    const { gameId, pin } = await setup(names);
    await expect(startGame((await createGame()).gameId)).rejects.toThrow(/minst två/);

    await startGame(gameId);
    let g = await game(gameId);
    const order = effectiveOrder(g);
    expect(g.meta.status).toBe('running');
    expect(g.meta.startedAt).toBeGreaterThan(0);
    expect(g.current).toMatchObject({ index: 0, drinkId: order[0], phase: 'preparing' });

    for (let i = 0; i < order.length; i++) {
      const drinkId = order[i];
      await openVoting(gameId);
      expect((await game(gameId)).current?.phase).toBe('voting');
      for (const voter of order.filter((id) => id !== drinkId)) {
        await as(voter, () => submitVote(gameId, drinkId, { ...allOf(5 + i), comment: i === 0 ? `  hej från ${voter}  ` : '   ' }));
      }
      await expect(as(drinkId, () => submitVote(gameId, drinkId, allOf(10)))).rejects.toThrow(/egen drink/);
      await closeVoting(gameId);
      expect((await game(gameId)).current?.phase).toBe('closed');
      const more = await nextDrink(gameId);
      expect(more).toBe(i < order.length - 1);
      if (more) expect((await game(gameId)).current).toMatchObject({ index: i + 1, drinkId: order[i + 1], phase: 'preparing' });
    }

    g = await game(gameId);
    const firstVotes = g.votes[order[0]];
    expect(Object.values(firstVotes).map((v) => v.comment).sort()).toEqual(
      order.slice(1).map((id) => `hej från ${id}`).sort(),
    );
    expect(Object.values(g.votes[order[1]]).every((v) => v.comment === undefined)).toBe(true);

    await startAwards(gameId);
    expect((await game(gameId)).meta.status).toBe('awards');
    await expect(as('alva', () => submitAwardVote(gameId, 'favorite', 'alva'))).rejects.toThrow(/dig själv/);
    await as('alva', () => submitAwardVote(gameId, 'favorite', 'bo'));
    await as('cleo', () => submitAwardVote(gameId, 'favorite', 'bo'));
    expect((await game(gameId)).awardVotes.favorite).toEqual({ alva: 'bo', cleo: 'bo' });

    await startCeremony(gameId);
    g = await game(gameId);
    expect(g.meta.status).toBe('ceremony');
    expect(g.ceremony?.step).toBe(0);
    await setCeremonyStep(gameId, 3);
    expect((await game(gameId)).ceremony?.step).toBe(3);
    await setCeremonyStep(gameId, -2);
    expect((await game(gameId)).ceremony?.step).toBe(0);

    await finishGame(gameId);
    g = await game(gameId);
    expect(g.meta.status).toBe('finished');
    expect(g.meta.finishedAt).toBeGreaterThan(0);
    const hof = (db.data().hallOfFame as Record<string, HallOfFameEntry>)[gameId];
    const results = computeResults(g);
    expect(hof).toMatchObject({ name: 'Bonjour Babes', pin, participants: 4, createdAt: g.meta.createdAt });
    expect(hof.ranking).toEqual(
      results.ranking.map((d) => ({ rank: d.rank, name: d.name, drink: d.drink, score: d.score, emoji: d.emoji, color: d.color })),
    );
    // Den sista drinken fick högst betyg (allOf(8)).
    expect(hof.ranking[0]).toMatchObject({ rank: 1, name: g.players[order[3]].name, score: 80 });

    await reopenGame(gameId);
    expect((await game(gameId)).meta.status).toBe('ceremony');
    expect((await game(gameId)).meta.finishedAt).toBeUndefined();
    expect((db.data().hallOfFame as object | undefined)?.[gameId as never]).toBeUndefined();

    await deleteGame(gameId);
    expect(await loadGame(gameId)).toBeNull();
    expect(await findGameByPin(pin)).toBeNull();
  });

  it('submitVote kortar kommentaren till max-längden', async () => {
    const { gameId } = await setup(['Alva', 'Bo']);
    await startGame(gameId);
    await openVoting(gameId);
    const drinkId = (await game(gameId)).current!.drinkId;
    const voter = drinkId === 'alva' ? 'bo' : 'alva';
    await as(voter, () => submitVote(gameId, drinkId, { ...allOf(7), comment: 'ö'.repeat(COMMENT_MAX + 50) }));
    expect((await game(gameId)).votes[drinkId][voter].comment).toHaveLength(COMMENT_MAX);
  });

  it('nextDrink returnerar false för okänt spel och goToDrink ignorerar ogiltiga index', async () => {
    expect(await nextDrink('finns-inte')).toBe(false);
    const { gameId } = await setup(['A', 'B']);
    await startGame(gameId);
    await goToDrink(gameId, 5);
    await goToDrink(gameId, -1);
    expect((await game(gameId)).current?.index).toBe(0);
  });
});

describe('admin: deltagare', () => {
  it('addManualPlayer och editPlayer', async () => {
    const { gameId } = await setup(['Alva']);
    const id = await addManualPlayer(gameId, { name: ' Mormor ', drink: ' Glögg ' });
    expect((await game(gameId)).players[id]).toMatchObject({ name: 'Mormor', drink: 'Glögg', manual: true });
    await expect(addManualPlayer(gameId, { name: 'alva', drink: 'X' })).rejects.toThrow(/redan taget/);
    await expect(addManualPlayer(gameId, { name: 'Ny', drink: ' ' })).rejects.toBeInstanceOf(JoinError);

    await editPlayer(gameId, id, { name: '  Farmor ', drink: 'Punsch' });
    expect((await game(gameId)).players[id]).toMatchObject({ name: 'Farmor', drink: 'Punsch', manual: true });
    await expect(editPlayer(gameId, id, { name: '   ' })).rejects.toThrow();
  });

  it('removePlayer tar bort spelaren och alla röster till och från hen', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D']);
    await startGame(gameId);
    // Rösta på a och b (ordningen är a, b, c, d) och lägg några specialprisröster.
    for (const [drinkId, voters] of [
      ['a', ['b', 'c', 'd']],
      ['b', ['a', 'c', 'd']],
    ] as const) {
      await goToDrink(gameId, effectiveOrder(await game(gameId)).indexOf(drinkId));
      await openVoting(gameId);
      for (const v of voters) await as(v, () => submitVote(gameId, drinkId, allOf(7)));
    }
    await db.update(`games/${gameId}/awardVotes`, { 'name/a': 'c', 'name/c': 'b', 'swamp/d': 'a' });

    await removePlayer(gameId, 'c');
    const g = await game(gameId);
    expect(g.players.c).toBeUndefined();
    expect(g.order).toEqual(['a', 'b', 'd']);
    expect(Object.keys(g.votes.a).sort()).toEqual(['b', 'd']);
    expect(Object.keys(g.votes.b).sort()).toEqual(['a', 'd']);
    expect(g.awardVotes).toEqual({ swamp: { d: 'a' } });
    expect(g.current).toMatchObject({ drinkId: 'b', phase: 'voting' }); // inte den borttagnas drink → orörd
  });

  it('removePlayer på den aktuella drinken går vidare till nästa drink på samma plats', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D']);
    await startGame(gameId);
    await goToDrink(gameId, 1);
    await openVoting(gameId);
    await as('a', () => submitVote(gameId, 'b', allOf(7)));

    await removePlayer(gameId, 'b');
    const g = await game(gameId);
    expect(g.order).toEqual(['a', 'c', 'd']);
    expect(g.votes.b).toBeUndefined();
    expect(g.current).toMatchObject({ index: 1, drinkId: 'c', phase: 'preparing' });
  });

  it('removePlayer på den sista drinken öppnar inte en redan visad drink igen (regression)', async () => {
    const { gameId } = await setup(['A', 'B', 'C']);
    await startGame(gameId);
    await goToDrink(gameId, 2);
    await openVoting(gameId);

    await removePlayer(gameId, 'c');
    const g = await game(gameId);
    expect(g.order).toEqual(['a', 'b']);
    // b har redan visats och röstats på – den ska inte bli "på väg" igen, och det finns ingen nästa drink.
    expect(g.current).toMatchObject({ index: 1, drinkId: 'b', phase: 'closed' });
    expect(await nextDrink(gameId)).toBe(false);
  });

  it('removePlayer på den enda kvarvarande drinken tar bort current', async () => {
    const { gameId } = await setup(['A', 'B']);
    await startGame(gameId);
    await removePlayer(gameId, 'b');
    await removePlayer(gameId, 'a');
    const g = await game(gameId);
    expect(g.players).toEqual({});
    expect(g.current).toBeUndefined();
  });

  it('removePlayer klarar en röst på egen drink utan att bygga en ogiltig uppdatering (regression)', async () => {
    const { gameId } = await setup(['A', 'B', 'C']);
    // Admin-skrivningar går förbi reglerna, så en självröst kan i teorin finnas.
    await db.set(`games/${gameId}/votes/a/a`, allOf(10));
    await db.set(`games/${gameId}/votes/a/b`, allOf(6));
    await expect(removePlayer(gameId, 'a')).resolves.toBeUndefined();
    const g = await game(gameId);
    expect(g.players.a).toBeUndefined();
    expect(g.votes.a).toBeUndefined();
  });

  it('removePlayer gör inget för ett okänt spel', async () => {
    await expect(removePlayer('finns-inte', 'a')).resolves.toBeUndefined();
    expect(db.data()).toEqual({});
  });
});

describe('jumpToDrink', () => {
  it('framåt: hoppar inte över drinkarna emellan', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D', 'E']);
    await startGame(gameId);
    await openVoting(gameId);
    await closeVoting(gameId); // a är klar
    await jumpToDrink(gameId, 'd');
    let g = await game(gameId);
    expect(g.order).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(g.current).toMatchObject({ index: 1, drinkId: 'd', phase: 'preparing' });
    expect(completedDrinkIds(g)).toEqual(['a']);
    expect(nextDrinkIndex(g)).toBe(2); // b står på tur efter d
    await closeVoting(gameId);
    expect(await nextDrink(gameId)).toBe(true);
    g = await game(gameId);
    expect(g.current?.drinkId).toBe('b');
  });

  it('framåt från en drink som bara är "på väg": den drinken kommer direkt efter', async () => {
    const { gameId } = await setup(['A', 'B', 'C']);
    await startGame(gameId); // a på väg
    await jumpToDrink(gameId, 'c');
    const g = await game(gameId);
    expect(g.order).toEqual(['c', 'a', 'b']);
    expect(completedDrinkIds(g)).toEqual([]);
    expect(nextDrinkIndex(g)).toBe(1);
  });

  it('bakåt: redan serverade drinkar räknas fortfarande som klara', async () => {
    const { gameId } = await setup(['A', 'B', 'C', 'D']);
    await startGame(gameId);
    for (let i = 0; i < 2; i++) {
      await openVoting(gameId);
      await closeVoting(gameId);
      await nextDrink(gameId);
    }
    await openVoting(gameId);
    await closeVoting(gameId); // a, b, c klara
    await jumpToDrink(gameId, 'a');
    const g = await game(gameId);
    expect(g.order).toEqual(['b', 'c', 'a', 'd']);
    expect(completedDrinkIds(g)).toEqual(['b', 'c']);
    expect(g.current).toMatchObject({ drinkId: 'a', phase: 'preparing' });
    expect(nextDrinkIndex(g)).toBe(3); // d, inte b igen
  });
});

