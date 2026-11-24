/**
 * Säkerhetsreglerna (server/rules.ts) genom hela API:t: handle() med riktiga Request-objekt.
 * Portade från de tidigare testerna mot Firebase-emulatorn – samma scenarier och samma förväntningar.
 * Sökvägar och data speglar exakt vad src/lib/game.ts och src/lib/admin.ts skriver.
 *
 * Körs mot lagret i minnet, och dessutom mot Postgres om TEST_DATABASE_URL är satt (npm run test:pg).
 * Varje simulerad användare är en egen klient med en egen session (uid + token).
 *
 * Skillnad mot Firebase: en oinloggad klient (ingen token) får 401 unauthenticated vid skrivning
 * i stället för permission_denied. Att reglerna i sig också nekar auth = null testas direkt mot
 * regelmotorn längst ner.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { canRead, checkWrite, docSource, RULES, type RuleNode } from '../../server/rules';
import type { Store } from '../../server/store';
import { docKeyOf, SERVER_TIME } from '../../src/lib/backend/protocol';
import { getAt, normalize, setAt } from '../../src/lib/backend/tree';
import { splitPath } from '../../src/lib/backend/types';
import { DEFAULT_SETTINGS } from '../../src/lib/selectors';
import type { GameStatus, Player, RoundPhase, Vote } from '../../src/lib/types';
import { client, ownerGet as storeGet, ownerPut as storePut, requirePostgresIfAsked, testBackends, type TestClient } from './helpers';

requirePostgresIfAsked();

const serverTimestamp = () => ({ ...SERVER_TIME });

async function allowed(op: Promise<unknown>) {
  await expect(op).resolves.not.toThrow();
}

async function denied(op: Promise<unknown>) {
  await expect(op).rejects.toThrow(/permission[_ ]denied/i);
}

/** Oinloggad klient: servern kräver en token för att skriva. */
async function unauthenticated(op: Promise<unknown>) {
  await expect(op).rejects.toThrow(/unauthenticated/);
}

// Samma hash som appens hashPassword() (det testas i tests/unit/admin.test.ts).
const SALT = 'bonjour-babes:v1:';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PASSWORD = 'santé';
const HASH = sha256(SALT + PASSWORD);

/** Som setupAdminPassword() i admin.ts (utan inloggningen). */
const setupPayload = (hash = HASH) => ({ 'secret/adminHash': hash, 'setup/adminConfigured': true });

/** Som createGame() i game.ts. */
function createGamePayload(gameId: string, pin: string) {
  return {
    [`games/${gameId}/meta`]: { name: 'Bonjour Babes', pin, createdAt: serverTimestamp(), status: 'lobby' },
    [`games/${gameId}/settings`]: { ...DEFAULT_SETTINGS },
    [`pins/${pin}`]: gameId,
  };
}

/** Som joinGame() i game.ts. */
function joinPayload(name: string, extra: Partial<Record<keyof Player, unknown>> = {}) {
  return { name, drink: `${name}s drink`, emoji: '🍸', color: '#6e1430', joinedAt: serverTimestamp(), ...extra };
}

/** Som submitVote() i game.ts. */
function votePayload(n = 7, extra: Partial<Record<keyof Vote | string, unknown>> = {}) {
  return { taste: n, look: n, creativity: n, again: n, at: serverTimestamp(), ...extra };
}

interface SeedOptions {
  status?: GameStatus;
  players?: TestClient[];
  current?: { drinkId: string; phase: RoundPhase; index?: number };
}

for (const backend of testBackends('bb_docs_test_rules')) {
  describe(`regler (${backend.name})`, () => {
    let store: Store;
    let admin: TestClient;
    let alice: TestClient;
    let bob: TestClient;
    let carol: TestClient;
    let eve: TestClient; // inloggad men inte med i något spel
    let anon: TestClient; // inte inloggad alls

    const ownerGet = <T = unknown>(path: string) => storeGet<T>(store, path);
    const ownerPut = (path: string, value: unknown) => storePut(store, path, value);

    /** Väljer adminlösenord (som ägare) och loggar in klienten som admin (via reglerna, som adminLogin()). */
    async function makeAdmin(c: TestClient) {
      await ownerPut('secret/adminHash', HASH);
      await ownerPut('setup/adminConfigured', true);
      await c.set(`adminSessions/${c.uid}`, HASH);
    }

    let gameCounter = 0;
    /** Lägger in ett spel direkt som ägare (snabbt, utan regler). */
    async function seedGame(opts: SeedOptions = {}): Promise<{ gameId: string; pin: string }> {
      gameCounter++;
      const gameId = `game${gameCounter}`;
      const pin = String(100000 + gameCounter);
      const players: Record<string, Player> = {};
      (opts.players ?? []).forEach((c, i) => {
        players[c.uid] = { name: `Spelare ${i + 1}`, drink: `Drink ${i + 1}`, emoji: '🍹', color: '#2f4f4f', joinedAt: 1000 + i };
      });
      await ownerPut(`games/${gameId}`, {
        meta: { name: 'Bonjour Babes', pin, createdAt: 1, status: opts.status ?? 'lobby' },
        settings: DEFAULT_SETTINGS,
        ...(Object.keys(players).length ? { players, order: Object.keys(players) } : {}),
        ...(opts.current
          ? { current: { index: opts.current.index ?? 0, drinkId: opts.current.drinkId, phase: opts.current.phase, since: 1 } }
          : {}),
      });
      await ownerPut(`pins/${pin}`, gameId);
      return { gameId, pin };
    }

    beforeEach(async () => {
      store = await backend.fresh();
      [admin, alice, bob, carol, eve, anon] = await Promise.all([
        client(store),
        client(store),
        client(store),
        client(store),
        client(store),
        client(store, false),
      ]);
    });

    afterAll(async () => {
      await backend.close();
    });

    /* ------------------------------------------------------------------ */
    /*  Admin                                                               */
    /* ------------------------------------------------------------------ */

    describe('adminlösenord och inloggning', () => {
      it('hashen i testerna har samma form som appens hashPassword()', () => {
        expect(HASH).toMatch(/^[0-9a-f]{64}$/);
      });

      it('första gången får vem som helst (inloggad) välja lösenord – en gång', async () => {
        await allowed(alice.update('', setupPayload()));
        expect(await ownerGet('secret/adminHash')).toBe(HASH);
        expect(await ownerGet('setup/adminConfigured')).toBe(true);

        // Andra försöket nekas – oavsett vem och vilket lösenord.
        await denied(bob.update('', setupPayload(sha256(`${SALT}annat`))));
        await denied(alice.update('', setupPayload()));
        await denied(bob.set('secret/adminHash', sha256(`${SALT}annat`)));
        await denied(bob.remove('secret/adminHash'));
        await denied(bob.set('setup/adminConfigured', true));
        await denied(bob.remove('setup'));
        expect(await ownerGet('secret/adminHash')).toBe(HASH);
      });

      it('kräver inloggning, en giltig hash och båda nycklarna', async () => {
        await unauthenticated(anon.update('', setupPayload()));
        await denied(alice.update('', setupPayload('kort')));
        await denied(alice.update('', setupPayload('z'.repeat(64)))); // inte hex
        await denied(alice.update('', setupPayload(HASH.toUpperCase()))); // hashPassword ger gemener
        // hashen får inte sättas utan setup-flaggan (då skulle appen tro att inget lösenord är valt)
        await denied(alice.set('secret/adminHash', HASH));
        await denied(alice.update('', { 'secret/adminHash': HASH, 'setup/adminConfigured': 'ja' }));
        // setup-flaggan får inte sättas utan att hashen finns
        await denied(alice.set('setup/adminConfigured', true));
        await denied(alice.update('', { ...setupPayload(), 'setup/annat': true }));
        await denied(alice.update('', { ...setupPayload(), 'secret/annat': 'x' }));
        expect(await ownerGet('secret')).toBeNull();
      });

      it('hashen går inte att läsa, men setup-flaggan är publik', async () => {
        await alice.update('', setupPayload());
        for (const c of [alice, bob, anon]) {
          await denied(c.get('secret'));
          await denied(c.get('secret/adminHash'));
          await denied(c.get(''));
          expect(await c.get('setup/adminConfigured')).toBe(true);
        }
        await makeAdmin(admin);
        await denied(admin.get('secret/adminHash'));
      });

      it('inloggning kräver rätt hash', async () => {
        await ownerPut('secret/adminHash', HASH);
        await ownerPut('setup/adminConfigured', true);
        await denied(alice.set(`adminSessions/${alice.uid}`, sha256(`${SALT}fel`)));
        await denied(alice.set(`adminSessions/${alice.uid}`, 42));
        await allowed(alice.set(`adminSessions/${alice.uid}`, HASH));
        expect(await ownerGet(`adminSessions/${alice.uid}`)).toBe(HASH);
      });

      it('inloggning nekas innan något lösenord är valt', async () => {
        await denied(alice.set(`adminSessions/${alice.uid}`, HASH));
      });

      it('man kan bara skriva och läsa sin egen session', async () => {
        await makeAdmin(admin);
        await denied(bob.set(`adminSessions/${alice.uid}`, HASH));
        expect(await admin.get(`adminSessions/${admin.uid}`)).toBe(HASH);
        await denied(bob.get(`adminSessions/${admin.uid}`));
        await denied(anon.get(`adminSessions/${admin.uid}`));
        await denied(admin.get('adminSessions'));
        await denied(bob.remove(`adminSessions/${admin.uid}`));
        // Logga ut (adminLogout)
        await allowed(admin.remove(`adminSessions/${admin.uid}`));
        expect(await ownerGet(`adminSessions/${admin.uid}`)).toBeNull();
      });

      it('en session slutar gälla när lösenordet byts', async () => {
        await makeAdmin(admin);
        const { gameId } = await seedGame();
        await allowed(admin.set(`games/${gameId}/meta/name`, 'Före bytet'));

        const newHash = sha256(`${SALT}nytt lösenord`);
        await ownerPut('secret/adminHash', newHash);
        await denied(admin.set(`games/${gameId}/meta/name`, 'Efter bytet'));
        await denied(admin.update('', createGamePayload('nytt', '654321')));
        // Gamla lösenordet fungerar inte längre, det nya gör det.
        await denied(admin.set(`adminSessions/${admin.uid}`, HASH));
        await allowed(admin.set(`adminSessions/${admin.uid}`, newHash));
        await allowed(admin.set(`games/${gameId}/meta/name`, 'Efter bytet'));
      });

      it('en session slutar gälla när lösenordet återställs (secret raderas)', async () => {
        await makeAdmin(admin);
        const { gameId } = await seedGame();
        await ownerPut('secret', null);
        await denied(admin.set(`games/${gameId}/meta/name`, 'Efter återställning'));
      });
    });

    /* ------------------------------------------------------------------ */
    /*  Spel – bara admin styr                                              */
    /* ------------------------------------------------------------------ */

    describe('spel: skapa och styra', () => {
      it('admin skapar ett spel (meta + settings + PIN i en uppdatering)', async () => {
        await makeAdmin(admin);
        const gameId = admin.pushKey();
        await allowed(admin.update('', createGamePayload(gameId, '123456')));
        expect(await ownerGet(`pins/123456`)).toBe(gameId);
        const meta = await ownerGet<{ status: string; createdAt: number }>(`games/${gameId}/meta`);
        expect(meta?.status).toBe('lobby');
        expect(typeof meta?.createdAt).toBe('number');
      });

      it('andra kan inte skapa spel', async () => {
        await makeAdmin(admin);
        await denied(alice.update('', createGamePayload('g1', '123456')));
        await unauthenticated(anon.update('', createGamePayload('g1', '123456')));
        await denied(alice.set('games/g1/meta', { name: 'X', pin: '123456', createdAt: 1, status: 'lobby' }));
        await denied(alice.set('pins/123456', 'g1'));
      });

      it('PIN-nyckeln måste vara 6 siffror och peka på ett spel-id', async () => {
        await makeAdmin(admin);
        await denied(admin.update('', createGamePayload('g1', '12345')));
        await denied(admin.update('', createGamePayload('g1', '1234567')));
        await denied(admin.update('', createGamePayload('g1', 'abcdef')));
        await denied(admin.set('pins/123456', 42));
        await allowed(admin.set('pins/123456', 'g1'));
        // deleteGame tar bort PIN:en
        await allowed(admin.remove('pins/123456'));
      });

      it('spelare kan inte ändra meta, inställningar, ordning, current, lottning, prisutdelning, PIN eller Hall of Fame', async () => {
        await makeAdmin(admin);
        const { gameId, pin } = await seedGame({ status: 'running', players: [alice, bob], current: { drinkId: alice.uid, phase: 'preparing' } });
        const g = `games/${gameId}`;
        // Thunks: varje försök startas först när det föregående är klart.
        const attempts: [string, () => Promise<unknown>][] = [
          ['meta/status', () => alice.set(`${g}/meta/status`, 'finished')],
          ['meta', () => alice.update(`${g}/meta`, { name: 'Hackad' })],
          ['settings', () => alice.update(`${g}/settings`, { trimExtremes: false })],
          ['order', () => alice.set(`${g}/order`, [bob.uid, alice.uid])],
          ['current', () => alice.update(`${g}/current`, { phase: 'voting' })],
          ['lottery', () => alice.set(`${g}/lottery`, { at: 1, order: [bob.uid] })],
          ['ceremony', () => alice.set(`${g}/ceremony`, { step: 3, at: 1 })],
          ['startGame', () => alice.update(g, { 'meta/status': 'running', 'meta/startedAt': serverTimestamp() })],
          ['pins', () => alice.set(`pins/${pin}`, 'annat')],
          ['ny pin', () => alice.set('pins/999999', gameId)],
          ['hallOfFame', () => alice.set(`hallOfFame/${gameId}`, { name: 'Fusk' })],
          ['hela spelet', () => alice.set(g, null)],
          ['annans spelare', () => alice.remove(`${g}/players/${bob.uid}`)],
          ['okänd nod', () => alice.set(`${g}/annat`, true)],
          ['rot', () => alice.set('annat', true)],
        ];
        for (const [label, op] of attempts) {
          await expect(op(), label).rejects.toThrow(/permission[_ ]denied/i);
        }
        expect(await ownerGet(`${g}/meta/status`)).toBe('running');
      });

      it('allt utom hemligheter och sessioner är publikt läsbart', async () => {
        await makeAdmin(admin);
        const { gameId, pin } = await seedGame({ players: [alice] });
        await ownerPut(`hallOfFame/${gameId}`, { name: 'Bonjour Babes' });
        for (const c of [anon, eve]) {
          expect(await c.get(`pins/${pin}`)).toBe(gameId);
          expect(await c.get<{ meta: { pin: string } }>(`games/${gameId}`)).toMatchObject({ meta: { pin } });
          expect(await c.get('games')).not.toBeNull();
          expect(await c.get(`hallOfFame/${gameId}`)).toEqual({ name: 'Bonjour Babes' });
        }
      });
    });

    /* ------------------------------------------------------------------ */
    /*  Spelare                                                             */
    /* ------------------------------------------------------------------ */

    describe('spelare: gå med och ändra sig', () => {
      it('går att gå med i lobbyn och medan tävlingen pågår', async () => {
        const lobby = await seedGame({ status: 'lobby' });
        await allowed(alice.set(`games/${lobby.gameId}/players/${alice.uid}`, joinPayload('Alice')));
        const p = await ownerGet<Player>(`games/${lobby.gameId}/players/${alice.uid}`);
        expect(p?.name).toBe('Alice');
        expect(typeof p?.joinedAt).toBe('number');

        const running = await seedGame({ status: 'running', players: [bob], current: { drinkId: bob.uid, phase: 'voting' } });
        await allowed(alice.set(`games/${running.gameId}/players/${alice.uid}`, joinPayload('Alice')));
      });

      it('nya spelare nekas efter tävlingen, men den som redan är med får ändra sig', async () => {
        for (const status of ['awards', 'ceremony', 'finished'] as const) {
          const { gameId } = await seedGame({ status, players: [bob] });
          await denied(alice.set(`games/${gameId}/players/${alice.uid}`, joinPayload('Alice')));
          // joinGame för en befintlig spelare skickar med den gamla joinedAt
          await allowed(bob.set(`games/${gameId}/players/${bob.uid}`, joinPayload('Bob', { joinedAt: 1000 })));
          // setAvatar
          await allowed(bob.update(`games/${gameId}/players/${bob.uid}`, { emoji: '🍒', color: '#244b4f' }));
          expect(await ownerGet(`games/${gameId}/players/${bob.uid}/emoji`)).toBe('🍒');
        }
      });

      it('en spelare kan lämna spelet', async () => {
        const { gameId } = await seedGame({ status: 'running', players: [alice, bob], current: { drinkId: bob.uid, phase: 'preparing' } });
        await allowed(alice.remove(`games/${gameId}/players/${alice.uid}`));
        expect(await ownerGet(`games/${gameId}/players/${alice.uid}`)).toBeNull();
      });

      it('validerar fälten', async () => {
        const { gameId } = await seedGame({ status: 'lobby' });
        const path = `games/${gameId}/players/${alice.uid}`;
        const bad: [string, unknown][] = [
          ['tomt namn', joinPayload('')],
          ['namn 25 tecken', joinPayload('x'.repeat(25))],
          ['namn som tal', joinPayload('Alice', { name: 42 })],
          ['tom drink', joinPayload('Alice', { drink: '' })],
          ['drink 41 tecken', joinPayload('Alice', { drink: 'y'.repeat(41) })],
          ['tom emoji', joinPayload('Alice', { emoji: '' })],
          ['lång emoji', joinPayload('Alice', { emoji: 'x'.repeat(17) })],
          ['färg utan #', joinPayload('Alice', { color: '6e1430' })],
          ['färg för kort', joinPayload('Alice', { color: '#12345' })],
          ['färg för lång', joinPayload('Alice', { color: '#1234567' })],
          ['färgnamn', joinPayload('Alice', { color: 'red' })],
          ['joinedAt som text', joinPayload('Alice', { joinedAt: 'nu' })],
          ['manual som text', joinPayload('Alice', { manual: 'ja' })],
          ['extra fält', { ...joinPayload('Alice'), admin: true }],
          ['saknar joinedAt', { name: 'Alice', drink: 'X', emoji: '🍸', color: '#6e1430' }],
          ['saknar emoji', { name: 'Alice', drink: 'X', color: '#6e1430', joinedAt: serverTimestamp() }],
          ['inte ett objekt', 'Alice'],
        ];
        for (const [label, value] of bad) {
          await expect(alice.set(path, value), label).rejects.toThrow(/permission[_ ]denied/i);
        }
        expect(await ownerGet(path)).toBeNull();
        // Gränsvärdena är tillåtna
        await allowed(alice.set(path, joinPayload('x'.repeat(24), { drink: 'y'.repeat(40), emoji: '🌶️', color: '#ABCdef' })));
      });

      it('man kan inte skriva någon annans spelare', async () => {
        const { gameId } = await seedGame({ status: 'lobby', players: [bob] });
        await denied(alice.set(`games/${gameId}/players/${bob.uid}`, joinPayload('Alice')));
        await denied(alice.set(`games/${gameId}/players/${carol.uid}`, joinPayload('Carol')));
        await denied(alice.update(`games/${gameId}/players/${bob.uid}`, { name: 'Bob 2' }));
      });

      it('spelet måste finnas och man måste vara inloggad', async () => {
        await denied(alice.set(`games/finns-inte/players/${alice.uid}`, joinPayload('Alice')));
        const { gameId } = await seedGame({ status: 'lobby' });
        await unauthenticated(anon.set(`games/${gameId}/players/anon`, joinPayload('Anon')));
      });
    });

    /* ------------------------------------------------------------------ */
    /*  Röster                                                              */
    /* ------------------------------------------------------------------ */

    describe('röster', () => {
      async function votingGame(phase: RoundPhase = 'voting', status: GameStatus = 'running') {
        const created = await seedGame({ status, players: [alice, bob, carol], current: { drinkId: alice.uid, phase } });
        return { ...created, path: (drinkId: string, voterId: string) => `games/${created.gameId}/votes/${drinkId}/${voterId}` };
      }

      it('man röstar på den aktuella drinken medan röstningen är öppen', async () => {
        const { path } = await votingGame();
        await allowed(bob.set(path(alice.uid, bob.uid), votePayload(7, { comment: 'Ooh là là' })));
        await allowed(carol.set(path(alice.uid, carol.uid), votePayload(1)));
        await allowed(carol.set(path(alice.uid, carol.uid), votePayload(10))); // ändra sig medan den är öppen
        const v = await ownerGet<Vote>(path(alice.uid, bob.uid));
        expect(v).toMatchObject({ taste: 7, comment: 'Ooh là là' });
        expect(typeof v?.at).toBe('number');
        expect(await ownerGet(`${path(alice.uid, carol.uid)}/taste`)).toBe(10);
      });

      it('nekas när röstningen inte är öppen', async () => {
        for (const phase of ['preparing', 'closed'] as const) {
          const { path } = await votingGame(phase);
          await denied(bob.set(path(alice.uid, bob.uid), votePayload()));
        }
        for (const status of ['lobby', 'awards', 'ceremony', 'finished'] as const) {
          const { path } = await votingGame('voting', status);
          await denied(bob.set(path(alice.uid, bob.uid), votePayload()));
        }
      });

      it('nekas efter att admin låst röstningen', async () => {
        await makeAdmin(admin);
        const { gameId, path } = await votingGame();
        await allowed(bob.set(path(alice.uid, bob.uid), votePayload(6)));
        await allowed(admin.update(`games/${gameId}/current`, { phase: 'closed', since: serverTimestamp() })); // closeVoting
        await denied(bob.set(path(alice.uid, bob.uid), votePayload(9)));
        await denied(carol.set(path(alice.uid, carol.uid), votePayload(9)));
        await denied(bob.remove(path(alice.uid, bob.uid)));
        expect(await ownerGet(`${path(alice.uid, bob.uid)}/taste`)).toBe(6);
      });

      it('nekas för andra drinkar än den aktuella', async () => {
        const { path } = await votingGame();
        await denied(alice.set(path(carol.uid, alice.uid), votePayload()));
        await denied(bob.set(path(carol.uid, bob.uid), votePayload()));
      });

      it('nekas på egen drink, för någon annan och för den som inte är med', async () => {
        const { path } = await votingGame();
        await denied(alice.set(path(alice.uid, alice.uid), votePayload(10)));
        await denied(bob.set(path(alice.uid, carol.uid), votePayload(1)));
        await denied(eve.set(path(alice.uid, eve.uid), votePayload()));
        await unauthenticated(anon.set(path(alice.uid, 'anon'), votePayload()));
      });

      it('validerar betygen', async () => {
        const { path } = await votingGame();
        const p = path(alice.uid, bob.uid);
        const bad: [string, unknown][] = [
          ['0', votePayload(0)],
          ['11', votePayload(11)],
          ['7,5', votePayload(7, { look: 7.5 })],
          ['negativt', votePayload(7, { again: -1 })],
          ['text', votePayload(7, { creativity: '7' })],
          ['saknar smak', { look: 5, creativity: 5, again: 5, at: serverTimestamp() }],
          ['saknar at', { taste: 5, look: 5, creativity: 5, again: 5 }],
          ['at som text', votePayload(7, { at: 'nu' })],
          ['extra fält', votePayload(7, { bonus: 10 })],
          ['kommentar 281 tecken', votePayload(7, { comment: 'x'.repeat(281) })],
          ['kommentar som tal', votePayload(7, { comment: 5 })],
          ['inte ett objekt', 7],
        ];
        for (const [label, value] of bad) {
          await expect(bob.set(p, value), label).rejects.toThrow(/permission[_ ]denied/i);
        }
        expect(await ownerGet(p)).toBeNull();
        await allowed(bob.set(p, votePayload(1, { comment: 'x'.repeat(280) })));
        await allowed(bob.set(p, votePayload(10)));
      });
    });

    /* ------------------------------------------------------------------ */
    /*  Specialpriser                                                       */
    /* ------------------------------------------------------------------ */

    describe('specialpriser', () => {
      async function awardsGame(status: GameStatus = 'awards') {
        const created = await seedGame({ status, players: [alice, bob, carol] });
        return { ...created, path: (awardId: string, voterId: string) => `games/${created.gameId}/awardVotes/${awardId}/${voterId}` };
      }

      it('röstas i mobilen under specialprisrundan', async () => {
        const { path } = await awardsGame();
        for (const awardId of ['name', 'daring', 'swamp', 'favorite']) {
          await allowed(alice.set(path(awardId, alice.uid), bob.uid));
        }
        await allowed(alice.set(path('favorite', alice.uid), carol.uid)); // ändra sig
        expect(await ownerGet(path('favorite', alice.uid))).toBe(carol.uid);
      });

      it('bara under specialprisrundan', async () => {
        for (const status of ['lobby', 'running', 'ceremony', 'finished'] as const) {
          const { path } = await awardsGame(status);
          await denied(alice.set(path('favorite', alice.uid), bob.uid));
        }
      });

      it('inte på sig själv, bara på befintliga spelare och bara giltiga priser', async () => {
        const { path } = await awardsGame();
        await denied(alice.set(path('favorite', alice.uid), alice.uid));
        await denied(alice.set(path('favorite', alice.uid), eve.uid));
        await denied(alice.set(path('favorite', alice.uid), 'finns-inte'));
        await denied(alice.set(path('favorite', alice.uid), 42));
        await denied(alice.set(path('best', alice.uid), bob.uid));
        // (nytt) inga trick med sökvägar eller ärvda nycklar som "constructor"
        await denied(alice.set(path('favorite', alice.uid), ''));
        await denied(alice.set(path('favorite', alice.uid), `${bob.uid}/name`));
        await denied(alice.set(path('favorite', alice.uid), 'constructor'));
      });

      it('bara registrerade spelare, och bara sin egen röst', async () => {
        const { path } = await awardsGame();
        await denied(eve.set(path('favorite', eve.uid), bob.uid));
        await unauthenticated(anon.set(path('favorite', 'anon'), bob.uid));
        await denied(alice.set(path('favorite', carol.uid), bob.uid));
      });
    });

    /* ------------------------------------------------------------------ */
    /*  Admin kan allt i spelet                                             */
    /* ------------------------------------------------------------------ */

    describe('admin styr hela kvällen', () => {
      it('från skapat spel till Hall of Fame och radering', async () => {
        await makeAdmin(admin);
        const gameId = admin.pushKey();
        const pin = '424242';
        const g = `games/${gameId}`;
        await allowed(admin.update('', createGamePayload(gameId, pin)));

        // Spelarna går med (admin spelar också) + en manuell spelare
        for (const [c, name] of [
          [admin, 'Värden'],
          [alice, 'Alice'],
          [bob, 'Bob'],
          [carol, 'Carol'],
        ] as const) {
          await allowed(c.set(`${g}/players/${c.uid}`, joinPayload(name)));
        }
        const manualId = admin.pushKey();
        await allowed(admin.set(`${g}/players/${manualId}`, { ...joinPayload('Mormor'), manual: true })); // addManualPlayer
        await allowed(admin.update(`${g}/players/${bob.uid}`, { name: 'Bobby', drink: 'Ny drink' })); // editPlayer
        await allowed(admin.update(`${g}/settings`, { trimExtremes: false })); // updateSettings
        await allowed(admin.set(`${g}/meta/name`, 'Bonjour Babes vol. 2')); // renameGame

        // drawOrder
        const order = [carol.uid, alice.uid, admin.uid, manualId, bob.uid];
        await allowed(admin.update(g, { order, lottery: { at: serverTimestamp(), order } }));
        await allowed(admin.set(`${g}/order`, [alice.uid, carol.uid, admin.uid, manualId, bob.uid])); // setOrder/moveInOrder
        await allowed(admin.update(g, { order, lottery: { at: serverTimestamp(), order } }));

        // startGame
        await allowed(
          admin.update(g, {
            order,
            'meta/status': 'running',
            'meta/startedAt': serverTimestamp(),
            current: { index: 0, drinkId: order[0], phase: 'preparing', since: serverTimestamp() },
          }),
        );
        // openVoting → alla röstar, även admin som spelare
        await allowed(admin.update(`${g}/current`, { phase: 'voting', since: serverTimestamp() }));
        for (const c of [admin, alice, bob]) await allowed(c.set(`${g}/votes/${carol.uid}/${c.uid}`, votePayload(8)));
        // closeVoting
        await allowed(admin.update(`${g}/current`, { phase: 'closed', since: serverTimestamp() }));
        // nextDrink / goToDrink
        await allowed(
          admin.update(g, { order, 'meta/status': 'running', current: { index: 1, drinkId: order[1], phase: 'preparing', since: serverTimestamp() } }),
        );
        await allowed(admin.update(`${g}/current`, { phase: 'voting', since: serverTimestamp() }));
        for (const c of [admin, bob, carol]) await allowed(c.set(`${g}/votes/${alice.uid}/${c.uid}`, votePayload(6)));

        // removePlayer(bob) mitt i röstningen: spelare, röster till/från, ordning och specialprisröster i en uppdatering
        await allowed(
          admin.update(g, {
            [`players/${bob.uid}`]: null,
            [`votes/${bob.uid}`]: null,
            order: order.filter((id) => id !== bob.uid),
            [`votes/${carol.uid}/${bob.uid}`]: null,
            [`votes/${alice.uid}/${bob.uid}`]: null,
          }),
        );
        expect(await ownerGet(`${g}/players/${bob.uid}`)).toBeNull();
        expect(Object.keys((await ownerGet<object>(`${g}/votes/${carol.uid}`)) ?? {}).sort()).toEqual([admin.uid, alice.uid].sort());

        // removePlayer på den aktuella drinken (alice) → nästa drink på samma plats blir "på väg"
        const orderWithoutBob = order.filter((id) => id !== bob.uid);
        const remaining = orderWithoutBob.filter((id) => id !== alice.uid);
        await allowed(
          admin.update(g, {
            [`players/${alice.uid}`]: null,
            [`votes/${alice.uid}`]: null,
            order: remaining,
            [`votes/${carol.uid}/${alice.uid}`]: null,
            current: { index: 1, drinkId: remaining[1], phase: 'preparing', since: serverTimestamp() },
          }),
        );
        expect(await ownerGet(`${g}/current/drinkId`)).toBe(admin.uid);

        // startAwards
        await allowed(admin.update(g, { 'meta/status': 'awards', 'current/phase': 'closed' }));
        await allowed(carol.set(`${g}/awardVotes/favorite/${carol.uid}`, admin.uid));
        await allowed(admin.set(`${g}/awardVotes/favorite/${admin.uid}`, carol.uid));
        // removePlayer rensar även specialprisröster
        await allowed(admin.update(g, { [`awardVotes/favorite/${carol.uid}`]: null }));
        await allowed(admin.set(`${g}/awardVotes/favorite/${carol.uid}`, admin.uid)); // (admin-skrivningar går förbi villkoren)

        // startCeremony + setCeremonyStep
        await allowed(
          admin.update(g, { 'meta/status': 'ceremony', 'current/phase': 'closed', ceremony: { step: 0, at: serverTimestamp() } }),
        );
        await allowed(admin.set(`${g}/ceremony`, { step: 4, at: serverTimestamp() }));

        // finishGame: status + tid + Hall of Fame i en uppdatering från roten
        await allowed(
          admin.update('', {
            [`${g}/meta/status`]: 'finished',
            [`${g}/meta/finishedAt`]: serverTimestamp(),
            [`hallOfFame/${gameId}`]: {
              name: 'Bonjour Babes vol. 2',
              pin,
              createdAt: 1,
              finishedAt: serverTimestamp(),
              participants: 3,
              ranking: [
                { rank: 1, name: 'Carol', drink: 'Carols drink', score: 80, emoji: '🍸', color: '#6e1430' },
                { rank: 2, name: 'Värden', drink: 'Värdens drink', score: null, emoji: '🍸', color: '#6e1430' },
              ],
            },
          }),
        );
        expect(await anon.get(`hallOfFame/${gameId}/ranking/0/name`)).toBe('Carol');

        // reopenGame
        await allowed(
          admin.update('', { [`${g}/meta/status`]: 'ceremony', [`${g}/meta/finishedAt`]: null, [`hallOfFame/${gameId}`]: null }),
        );
        expect(await ownerGet(`hallOfFame/${gameId}`)).toBeNull();

        // deleteGame
        await allowed(admin.update('', { [g]: null, [`hallOfFame/${gameId}`]: null, [`pins/${pin}`]: null }));
        expect(await ownerGet(g)).toBeNull();
        expect(await ownerGet(`pins/${pin}`)).toBeNull();
      });

      it('admins skrivningar valideras fortfarande', async () => {
        await makeAdmin(admin);
        const { gameId } = await seedGame({ status: 'running', players: [alice, bob], current: { drinkId: alice.uid, phase: 'voting' } });
        await denied(admin.set(`games/${gameId}/players/x`, joinPayload('X', { color: 'röd' })));
        await denied(admin.update(`games/${gameId}/players/${alice.uid}`, { name: '' }));
        await denied(admin.set(`games/${gameId}/votes/${alice.uid}/${bob.uid}`, votePayload(11)));
        await denied(admin.set(`games/${gameId}/awardVotes/best/${bob.uid}`, alice.uid));
      });

      it('admin kan inte röra hemligheten eller andras sessioner', async () => {
        await makeAdmin(admin);
        await denied(admin.set('secret/adminHash', sha256(`${SALT}kapat`)));
        await denied(admin.remove('secret/adminHash'));
        await denied(admin.set(`adminSessions/${alice.uid}`, HASH));
        await denied(admin.remove('setup/adminConfigured'));
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Regelmotorn direkt (utan HTTP)                                      */
/* ------------------------------------------------------------------ */

describe('regelmotorn', () => {
  const segs = (p: string) => splitPath(p);
  /** Kontrollerar en set() mot en databas given som dokument (nyckel → data). */
  function canSet(docs: Record<string, unknown>, auth: { uid: string } | null, path: string, value: unknown, rules: RuleNode = RULES) {
    const old = new Map(Object.entries(docs));
    const key = docKeyOf(path)!;
    const tree = setAt(setAt({}, key, old.get(key) ?? null), path, value);
    const next = new Map(old).set(key, normalize(getAt(tree, key), 1234));
    return checkWrite({ auth, locations: [segs(path)], oldRoot: docSource(old), newRoot: docSource(next), now: 1234 }, rules).ok;
  }

  const game = (status: GameStatus, extra: Record<string, unknown> = {}) => ({
    meta: { name: 'X', pin: '123456', createdAt: 1, status },
    players: { alice: { name: 'A', drink: 'D', emoji: 'e', color: '#000000', joinedAt: 1 }, bob: { name: 'B', drink: 'D', emoji: 'e', color: '#000000', joinedAt: 1 } },
    ...extra,
  });

  it('nekar auth = null även om token-kontrollen skulle släppas förbi', () => {
    const docs = {
      'games/g': game('running', { current: { index: 0, drinkId: 'alice', phase: 'voting', since: 1 } }),
      secret: null,
      setup: null,
      'adminSessions/bob': null,
    };
    const vote = { taste: 5, look: 5, creativity: 5, again: 5, at: 1 };
    expect(canSet(docs, { uid: 'bob' }, 'games/g/votes/alice/bob', vote)).toBe(true);
    expect(canSet(docs, null, 'games/g/votes/alice/bob', vote)).toBe(false);
    expect(canSet({ 'games/g': game('lobby') }, null, 'games/g/players/carol', { name: 'C', drink: 'D', emoji: 'e', color: '#000000', joinedAt: 1 })).toBe(false);
    expect(canSet({ secret: null, setup: { adminConfigured: true } }, null, 'secret/adminHash', 'a'.repeat(64))).toBe(false);
    expect(canSet({ secret: { adminHash: 'a'.repeat(64) }, setup: null }, null, 'setup/adminConfigured', true)).toBe(false);
    expect(canSet({ 'adminSessions/x': null, secret: { adminHash: 'a'.repeat(64) } }, null, 'adminSessions/x', 'a'.repeat(64))).toBe(false);
  });

  it('läsrättigheter kaskaderar nedåt och kan inte tas bort längre ner', () => {
    expect(canRead(segs(''), null)).toBe(false);
    expect(canRead(segs('games'), null)).toBe(true);
    expect(canRead(segs('games/g/players/alice/name'), null)).toBe(true);
    expect(canRead(segs('secret'), { uid: 'a' })).toBe(false);
    expect(canRead(segs('adminSessions'), { uid: 'a' })).toBe(false);
    expect(canRead(segs('adminSessions/a'), { uid: 'a' })).toBe(true);
    expect(canRead(segs('adminSessions/a'), { uid: 'b' })).toBe(false);
    expect(canRead(segs('okänd'), { uid: 'a' })).toBe(false);
    const rules: RuleNode = { a: { '.read': true, b: { '.read': false } } };
    expect(canRead(segs('a/b'), null, rules)).toBe(true);
  });

  it('skrivrättigheter kaskaderar, namngivna barn går före $jokrar och .validate körs uppåt', () => {
    const rules: RuleNode = {
      x: {
        '.write': true,
        $id: { '.validate': ({ newData }) => newData.hasChildren(['a']) },
        named: { '.validate': ({ newData }) => newData.isString() },
      },
    };
    const docs = { 'x/k': { a: 1, b: 2 } };
    expect(canSet(docs, null, 'x/k/b', 3, rules)).toBe(true);
    // Skrivningen på x/k/a validerar även x/k ($id) med det sammanslagna nya datat: { b } saknar a
    expect(canSet(docs, null, 'x/k/a', null, rules)).toBe(false);
    expect(canSet(docs, null, 'x/k', null, rules)).toBe(true); // borttagning valideras inte
    expect(canSet({ 'x/named': null }, null, 'x/named', 'text', rules)).toBe(true);
    expect(canSet({ 'x/named': null }, null, 'x/named', { a: 1 }, rules)).toBe(false); // namngivet barn, inte $id
  });
});
