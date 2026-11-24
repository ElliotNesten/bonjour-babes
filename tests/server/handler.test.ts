/**
 * API:t (server/handler.ts) enligt protokollet i src/lib/backend/protocol.ts: sessioner och tokens,
 * läsningar i klump med rev, servertid, storleksgräns, spärr mot gissade adminlösenord, interna
 * "__"-dokument och samtidiga skrivningar.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_MS, MAX_BODY_BYTES } from '../../server/handler';
import { createFileStore } from '../../server/store-file';
import type { Store } from '../../server/store';
import type { ReadResult } from '../../src/lib/backend/protocol';
import { call, client, ownerGet, ownerPut, requirePostgresIfAsked, testBackends, type TestClient } from './helpers';

requirePostgresIfAsked();

const HASH = createHash('sha256').update('bonjour-babes:v1:santé', 'utf8').digest('hex');
const WRONG = createHash('sha256').update('bonjour-babes:v1:fel', 'utf8').digest('hex');

/** ReadResult (protocol.ts) som en enda typ, för att slippa smalna av i varje test. */
type AnyReadResult = { path: string; rev: number; value?: unknown; unchanged?: boolean; error?: ReadResult extends { error: infer E } ? E : never };
type ReadBody = { results: AnyReadResult[]; now: number };

async function read(store: Store, reads: { path: string; rev?: number }[], token?: string | null) {
  const res = await call<ReadBody>(store, 'read', { reads }, { token });
  expect(res.status).toBe(200);
  return res.body.results;
}

for (const backend of testBackends('bb_docs_test_handler')) {
  describe(`API (${backend.name})`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await backend.fresh();
    });
    afterAll(async () => {
      await backend.close();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Admin med lösenord och session, plus ett spel som pågår med röstning öppen på `creator`s drink. */
    async function setupGame(players: TestClient[], creator: TestClient) {
      const all: Record<string, unknown> = {};
      for (const c of [creator, ...players]) all[c.uid] = { name: c.uid.slice(0, 6), drink: 'D', emoji: '🍸', color: '#6e1430', joinedAt: 1 };
      await ownerPut(store, 'games/g', {
        meta: { name: 'Fest', pin: '123456', createdAt: 1, status: 'running' },
        players: all,
        current: { index: 0, drinkId: creator.uid, phase: 'voting', since: 1 },
      });
    }

    describe('sessioner', () => {
      it('ger ett slumpat uid och en token, som JSON utan cache och med serverns tid', async () => {
        const before = Date.now();
        const res = await call<{ uid: string; token: string; now: number }>(store, 'session');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.body.uid).toMatch(/^[A-Za-z0-9]{28}$/);
        expect(res.body.token.startsWith(`${res.body.uid}.`)).toBe(true);
        expect(res.body.now).toBeGreaterThanOrEqual(before);
        const other = await call<{ uid: string }>(store, 'session');
        expect(other.body.uid).not.toBe(res.body.uid);
      });

      it('skrivning kräver en giltig token (annars 401), läsning utan token går bra', async () => {
        const alice = await client(store);
        const bob = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        const write = (token: string | null) => call(store, 'write', { op: 'set', path: `adminSessions/${alice.uid}`, value: HASH }, { token });
        const sig = alice.token!.split('.')[1];
        for (const token of [
          null,
          'skräp',
          `${alice.uid}.`,
          `${alice.uid}.${sig.slice(0, -2)}AA`, // fel signatur
          `${bob.uid}.${sig}`, // annans uid med Alices signatur
          `${alice.uid}x.${sig}`,
          `${alice.token}.${sig}`,
        ]) {
          const res = await write(token);
          expect(res.status, String(token)).toBe(401);
          expect(res.body).toMatchObject({ error: 'unauthenticated' });
        }
        expect((await call(store, 'write', { op: 'remove', path: 'x/y' }, { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
        expect(await ownerGet(store, `adminSessions/${alice.uid}`)).toBeNull();
        expect((await write(alice.token)).status).toBe(200);

        // En förfalskad token vid läsning: läser som oinloggad (ingen 401)
        const forged = await read(store, [{ path: `adminSessions/${alice.uid}` }, { path: 'setup' }], `${alice.uid}.${sig.slice(0, -2)}AA`);
        expect(forged[0]).toEqual({ path: `adminSessions/${alice.uid}`, error: 'permission_denied' });
        expect(forged[1]).toMatchObject({ path: 'setup', value: null });
        expect((await read(store, [{ path: `adminSessions/${alice.uid}` }], alice.token))[0]).toMatchObject({ value: HASH });
      });

      it('hemligheten sparas i "__server" och överlever omstarter; SESSION_SECRET går före', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bb-secret-'));
        try {
          const file = join(dir, 'db.json');
          const a = createFileStore({ file });
          const s = await call<{ uid: string; token: string }>(a, 'session');
          await a.close();
          const b = createFileStore({ file });
          const ok = await call(b, 'write', { op: 'remove', path: `adminSessions/${s.body.uid}` }, { token: s.body.token });
          expect(ok.status).toBe(200);

          vi.stubEnv('SESSION_SECRET', 'en-hemlighet-från-miljön');
          try {
            const c = await call<{ uid: string; token: string }>(createFileStore(), 'session');
            const d = await call(createFileStore(), 'write', { op: 'remove', path: `adminSessions/${c.body.uid}` }, { token: c.body.token });
            expect(d.status).toBe(200);
            // Token från den sparade hemligheten gäller inte längre
            const e = await call(b, 'write', { op: 'remove', path: `adminSessions/${s.body.uid}` }, { token: s.body.token });
            expect(e.status).toBe(401);
          } finally {
            vi.unstubAllEnvs();
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });

    describe('läsning', () => {
      it('läser flera sökvägar i ett anrop, i samma ordning, med fel per sökväg', async () => {
        const alice = await client(store);
        await ownerPut(store, 'games/g', { meta: { name: 'Fest', status: 'lobby' }, order: ['a', 'b'] });
        await ownerPut(store, 'setup', { adminConfigured: true });
        const results = await read(
          store,
          [
            { path: 'games/g/meta/name' },
            { path: 'secret' },
            { path: 'setup/adminConfigured' },
            { path: 'games/g/order' },
            { path: 'games/saknas' },
            { path: 'games/g/meta.name' },
            { path: '' },
            { path: '/games//g/meta/status/' },
          ],
          alice.token,
        );
        const gameRev = results[0].rev;
        expect(gameRev).toBeGreaterThan(0);
        expect(results).toEqual([
          { path: 'games/g/meta/name', rev: gameRev, value: 'Fest' },
          { path: 'secret', error: 'permission_denied' },
          { path: 'setup/adminConfigured', rev: expect.any(Number), value: true },
          { path: 'games/g/order', rev: gameRev, value: ['a', 'b'] },
          { path: 'games/saknas', rev: 0, value: null },
          { path: 'games/g/meta.name', error: 'bad_request' },
          { path: '', error: 'permission_denied' },
          { path: '/games//g/meta/status/', rev: gameRev, value: 'lobby' },
        ]);
      });

      it('svarar "unchanged" när rev är oförändrad, och skickar värdet när något ändrats', async () => {
        await ownerPut(store, 'games/g', { meta: { name: 'A' } });
        const [first] = await read(store, [{ path: 'games/g' }]);
        const [same, saknas] = await read(store, [
          { path: 'games/g', rev: first.rev },
          { path: 'games/x', rev: 0 },
        ]);
        expect(same).toEqual({ path: 'games/g', rev: first.rev, unchanged: true });
        expect(saknas).toEqual({ path: 'games/x', rev: 0, unchanged: true });

        await ownerPut(store, 'games/g/meta/name', 'B');
        const [changed, sub, sub2] = await read(store, [
          { path: 'games/g', rev: first.rev },
          { path: 'games/g/meta', rev: first.rev },
          { path: 'games/g/meta/name' }, // samma dokument, ingen rev → datat hämtas ändå
        ]);
        expect(changed).toMatchObject({ value: { meta: { name: 'B' } } });
        expect(changed.rev).toBeGreaterThan(first.rev);
        expect(sub).toEqual({ path: 'games/g/meta', rev: changed.rev, value: { name: 'B' } });
        expect(sub2).toEqual({ path: 'games/g/meta/name', rev: changed.rev, value: 'B' });

        // Olika kända rev för samma dokument i samma anrop
        const mixed = await read(store, [
          { path: 'games/g', rev: changed.rev },
          { path: 'games/g/meta', rev: first.rev },
        ]);
        expect(mixed[0]).toEqual({ path: 'games/g', rev: changed.rev, unchanged: true });
        expect(mixed[1]).toEqual({ path: 'games/g/meta', rev: changed.rev, value: { name: 'B' } });
      });

      it('samlingar (games, hallOfFame, pins) ger alla levande dokument, och rev ändras även vid borttagning', async () => {
        const [empty] = await read(store, [{ path: 'hallOfFame' }]);
        expect(empty).toEqual({ path: 'hallOfFame', rev: 0, value: null });

        await ownerPut(store, 'hallOfFame/a', { name: 'A' });
        await ownerPut(store, 'hallOfFame/b', { name: 'B' });
        const [both] = await read(store, [{ path: 'hallOfFame' }]);
        expect(both).toMatchObject({ value: { a: { name: 'A' }, b: { name: 'B' } } });
        expect((await read(store, [{ path: 'hallOfFame', rev: both.rev }]))[0]).toEqual({ path: 'hallOfFame', rev: both.rev, unchanged: true });

        await ownerPut(store, 'hallOfFame/a', null);
        const [afterDelete] = await read(store, [{ path: 'hallOfFame', rev: both.rev }]);
        expect(afterDelete.rev).not.toBe(both.rev);
        expect(afterDelete).toMatchObject({ value: { b: { name: 'B' } } });

        await ownerPut(store, 'hallOfFame/b', null);
        const [none] = await read(store, [{ path: 'hallOfFame', rev: afterDelete.rev }]);
        expect(none.rev).not.toBe(afterDelete.rev);
        expect(none).toMatchObject({ value: null });

        // pins och games är också publika samlingar; adminSessions är det inte
        await ownerPut(store, 'pins/123456', 'g');
        const coll = await read(store, [{ path: 'pins' }, { path: 'games' }, { path: 'adminSessions' }]);
        expect(coll[0]).toMatchObject({ value: { '123456': 'g' } });
        expect(coll[1]).toMatchObject({ value: null });
        expect(coll[2]).toEqual({ path: 'adminSessions', error: 'permission_denied' });
      });

      it('ogiltiga förfrågningar ger 400', async () => {
        for (const body of [{}, { reads: [] }, { reads: 'games' }, { reads: [{ rev: 1 }] }, { reads: [{ path: 'games', rev: -1 }] }, { reads: [{ path: 'games', rev: 'x' }] }]) {
          const res = await call(store, 'read', body);
          expect(res.status, JSON.stringify(body)).toBe(400);
          expect(res.body).toMatchObject({ error: 'bad_request', now: expect.any(Number) });
        }
        expect((await call(store, 'read', { reads: Array.from({ length: 201 }, () => ({ path: 'games' })) })).status).toBe(400);
        expect((await call(store, 'read', undefined, { raw: '{ inte json' })).status).toBe(400);
        expect((await call(store, 'read', undefined, { raw: new Uint8Array([0xff, 0xfe]) })).status).toBe(400);
      });
    });

    describe('skrivning', () => {
      it('servertid ersätts med serverns klocka, även djupt ner och i arrayer', async () => {
        const admin = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        const before = Date.now();
        const res = await call<{ ok: boolean; rev: number; now: number }>(
          store,
          'write',
          { op: 'update', path: 'games/g', values: { 'meta/createdAt': { '.sv': 'timestamp' }, lottery: { at: { '.sv': 'timestamp' }, order: ['a'] }, list: [{ at: { '.sv': 'timestamp' } }] } },
          { token: admin.token },
        );
        const after = Date.now();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, rev: expect.any(Number), now: expect.any(Number) });
        const game = await ownerGet<{ meta: { createdAt: number }; lottery: { at: number }; list: { at: number }[] }>(store, 'games/g');
        for (const t of [game!.meta.createdAt, game!.lottery.at, game!.list[0].at]) {
          expect(t).toBeGreaterThanOrEqual(before);
          expect(t).toBeLessThanOrEqual(after);
        }
        expect(game!.meta.createdAt).toBe(game!.lottery.at); // samma tid för hela skrivningen
      });

      it('null tar bort, tomma objekt försvinner och en fler-sökvägsuppdatering är allt eller inget', async () => {
        const admin = await client(store);
        const alice = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        await ownerPut(store, 'games/g', { meta: { name: 'A', status: 'lobby' }, settings: { x: true } });
        await admin.update('games/g', { settings: null, 'meta/tom': {}, extra: { a: null } });
        expect(await ownerGet(store, 'games/g')).toEqual({ meta: { name: 'A', status: 'lobby' } });

        // Alice får skriva sin spelare men inte meta – inget av det sparas
        await expect(
          alice.update('', { [`games/g/players/${alice.uid}`]: { name: 'A', drink: 'D', emoji: 'e', color: '#000000', joinedAt: 1 }, 'games/g/meta/name': 'X' }),
        ).rejects.toThrow(/permission_denied/);
        expect(await ownerGet(store, 'games/g')).toEqual({ meta: { name: 'A', status: 'lobby' } });

        // Allt borttaget → dokumentet försvinner
        await admin.remove('games/g/meta');
        expect(await ownerGet(store, 'games/g')).toBeNull();
        expect((await read(store, [{ path: 'games' }]))[0]).toMatchObject({ value: null });
      });

      it('en skrivning som inte ändrar något ger ingen ny rev', async () => {
        const admin = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        await ownerPut(store, 'games/g', { meta: { name: 'A' } });
        const [before] = await read(store, [{ path: 'games/g' }]);
        const res = await call<{ rev: number }>(store, 'write', { op: 'set', path: 'games/g/meta/name', value: 'A' }, { token: admin.token });
        expect(res.status).toBe(200);
        expect(res.body.rev).toBe(before.rev);
        expect((await read(store, [{ path: 'games/g', rev: before.rev }]))[0]).toMatchObject({ unchanged: true });
        // update med tomt objekt: inget att göra
        expect((await call(store, 'write', { op: 'update', path: 'games/g', values: {} }, { token: admin.token })).status).toBe(200);
      });

      it('ogiltiga skrivningar ger 400 (sökvägar, nycklar, tecken, överlapp, form)', async () => {
        const admin = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        const bad: unknown[] = [
          { op: 'set', path: 'games/g/a.b', value: 1 },
          { op: 'set', path: 'games/g/a#b', value: 1 },
          { op: 'set', path: 'games/g/$x', value: 1 },
          { op: 'set', path: 'games/g/a[0]', value: 1 },
          { op: 'set', path: 'games/g/x', value: { 'a.b': 1 } },
          { op: 'set', path: 'games/g/x', value: { '': 1 } },
          { op: 'set', path: 'games/g/x', value: 'nul\u0000tecken' },
          { op: 'set', path: 'games/g/x', value: 'ensam \ud800 surrogat' },
          { op: 'set', path: 'games/g/x', value: { '.sv': 'increment' } },
          { op: 'set', path: 'games/g/x', value: JSON.parse('['.repeat(40) + ']'.repeat(40)) },
          { op: 'set', path: 'games/g/x' },
          { op: 'update', path: 'games/g', values: { meta: { a: 1 }, 'meta/name': 'x' } },
          { op: 'update', path: 'games/g', values: { 'meta/name': 1, '/meta//name/': 2 } },
          { op: 'update', path: 'games/g', values: { '': 1 } },
          { op: 'update', path: 'games/g', values: ['x'] },
          { op: 'remove' },
          { op: 'push', path: 'games/g' },
          'set',
        ];
        for (const body of bad) {
          const res = await call(store, 'write', body, { token: admin.token });
          expect(res.status, JSON.stringify(body)).toBe(400);
          expect(res.body).toMatchObject({ error: 'bad_request', message: expect.any(String) });
        }
        expect(await ownerGet(store, 'games/g')).toBeNull();
      });

      it('skrivningar ovanför dokumentnivå nekas (även för admin)', async () => {
        const admin = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        await expect(admin.set('games', { g: { meta: { name: 'x' } } })).rejects.toThrow(/permission_denied/);
        await expect(admin.remove('')).rejects.toThrow(/permission_denied/);
        await expect(admin.update('', { games: null })).rejects.toThrow(/permission_denied/);
        await expect(admin.update('', { 'pins/111111': 'g', hallOfFame: null })).rejects.toThrow(/permission_denied/);
        expect(await ownerGet(store, 'pins/111111')).toBeNull();
      });

      it('10 mobiler röstar samtidigt i samma spel – alla röster sparas', async () => {
        const creator = await client(store);
        const voters = await Promise.all(Array.from({ length: 10 }, () => client(store)));
        await setupGame(voters, creator);
        await Promise.all(
          voters.map((v, i) => v.set(`games/g/votes/${creator.uid}/${v.uid}`, { taste: i + 1, look: 5, creativity: 5, again: 5, at: { '.sv': 'timestamp' } })),
        );
        const votes = await ownerGet<Record<string, { taste: number }>>(store, `games/g/votes/${creator.uid}`);
        expect(Object.keys(votes!).sort()).toEqual(voters.map((v) => v.uid).sort());
        expect(Object.values(votes!).map((v) => v.taste).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      });
    });

    describe('storleksgräns', () => {
      it('413 för för stora förfrågningar (med och utan Content-Length)', async () => {
        const alice = await client(store);
        const big = JSON.stringify({ op: 'set', path: `adminSessions/${alice.uid}`, value: 'x'.repeat(MAX_BODY_BYTES) });
        const withLength = await call(store, 'write', undefined, { token: alice.token, raw: big, headers: { 'Content-Length': String(big.length) } });
        expect(withLength.status).toBe(413);
        expect(withLength.body).toMatchObject({ error: 'too_large' });

        const encoded = new TextEncoder().encode(big);
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            for (let i = 0; i < encoded.length; i += 16_384) ctrl.enqueue(encoded.slice(i, i + 16_384));
            ctrl.close();
          },
        });
        const res = await handle(
          new Request('http://localhost/api/write', {
            method: 'POST',
            headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
            body: stream,
            duplex: 'half',
          } as RequestInit),
          store,
        );
        expect(res.status).toBe(413);
        const reads = JSON.stringify({ reads: Array.from({ length: 200 }, () => ({ path: `games/${'g'.repeat(1400)}` })) });
        expect((await call(store, 'read', undefined, { raw: reads })).status).toBe(413);
      });
    });

    describe('felaktiga admininloggningar', () => {
      it(`högst ${LOGIN_FAILURE_LIMIT} fel per IP och ${LOGIN_FAILURE_WINDOW_MS / 60000} minuter, sedan 429`, async () => {
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, 'setup', { adminConfigured: true });
        const guesser = await client(store, true, '203.0.113.7');
        for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
          await expect(guesser.set(`adminSessions/${guesser.uid}`, WRONG)).rejects.toThrow(/permission_denied/);
        }
        // Spärrad – även med rätt lösenord, och även från en ny session på samma IP
        const blocked = await call(store, 'write', { op: 'set', path: `adminSessions/${guesser.uid}`, value: HASH }, {
          token: guesser.token,
          headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
        });
        expect(blocked.status).toBe(429);
        expect(blocked.body).toMatchObject({ error: 'rate_limited' });
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
        const sameIp = await client(store, true, '203.0.113.7');
        await expect(sameIp.set(`adminSessions/${sameIp.uid}`, HASH)).rejects.toThrow(/rate_limited/);
        // Utloggning och vanliga skrivningar påverkas inte
        await expect(guesser.remove(`adminSessions/${guesser.uid}`)).resolves.toBeUndefined();
        // Andra IP-adresser (x-real-ip används om x-forwarded-for saknas) påverkas inte
        const other = await client(store, true, '198.51.100.1');
        await expect(other.set(`adminSessions/${other.uid}`, HASH)).resolves.toBeUndefined();
        const viaRealIp = await call(store, 'write', { op: 'set', path: `adminSessions/${guesser.uid}`, value: HASH }, {
          token: guesser.token,
          headers: { 'x-real-ip': '198.51.100.2' },
        });
        expect(viaRealIp.status).toBe(200);
        // Efter tio minuter går det igen
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + LOGIN_FAILURE_WINDOW_MS + 1000);
        await expect(guesser.set(`adminSessions/${guesser.uid}`, HASH)).resolves.toBeUndefined();
      });

      it('lyckade inloggningar räknas inte', async () => {
        await ownerPut(store, 'secret', { adminHash: HASH });
        const admin = await client(store, true, '192.0.2.9');
        for (let i = 0; i < LOGIN_FAILURE_LIMIT + 5; i++) await admin.set(`adminSessions/${admin.uid}`, HASH);
      });
    });

    describe('interna dokument ("__")', () => {
      it('går varken att läsa eller skriva via API:t', async () => {
        const admin = await client(store);
        await ownerPut(store, 'secret', { adminHash: HASH });
        await ownerPut(store, `adminSessions/${admin.uid}`, HASH);
        // (I minnet skapades "__server" redan av /api/session; i Postgres har testet tömt tabellen.)
        await store.transact(['__server', '__ratelimit/abc'], (current) => ({
          changes: new Map<string, unknown>([
            ['__server', current.get('__server')?.data ?? { secret: 'test' }],
            ['__ratelimit/abc', { failures: [1] }],
          ]),
          result: null,
        }));
        const server = await store.read({ keys: ['__server', '__ratelimit/abc'] });
        expect(server.docs.get('__server')?.data).toMatchObject({ secret: expect.any(String) });

        const results = await read(store, [{ path: '__server' }, { path: '__server/secret' }, { path: '__ratelimit' }, { path: 'games/__x' }], admin.token);
        for (const r of results) expect(r).toMatchObject({ error: 'bad_request' });

        for (const body of [
          { op: 'set', path: '__server', value: { secret: 'x' } },
          { op: 'set', path: '__server/secret', value: 'x' },
          { op: 'remove', path: '__ratelimit/abc' },
          { op: 'update', path: '', values: { '__server/secret': 'x' } },
          { op: 'update', path: '', values: { 'games/g/meta': { __proto__x: 1 } } },
          { op: 'set', path: 'games/g', value: JSON.parse('{"__proto__": {"a": 1}}') },
        ]) {
          const res = await call(store, 'write', body, { token: admin.token });
          expect(res.status, JSON.stringify(body)).toBe(400);
        }
        const after = await store.read({ keys: ['__server', '__ratelimit/abc'] });
        expect(after.docs.get('__server')).toEqual(server.docs.get('__server'));
        expect(after.docs.get('__ratelimit/abc')).toEqual(server.docs.get('__ratelimit/abc'));
      });
    });

    describe('övrigt', () => {
      it('GET ger 405, okända adresser 404 – alltid JSON med now', async () => {
        for (const endpoint of ['session', 'read', 'write']) {
          const res = await call(store, endpoint, undefined, { method: 'GET' });
          expect(res.status).toBe(405);
          expect(res.headers.get('allow')).toBe('POST');
          expect(res.body).toMatchObject({ error: 'bad_request', now: expect.any(Number) });
        }
        const res = await call(store, 'nope');
        expect(res.status).toBe(404);
        expect(res.headers.get('cache-control')).toBe('no-store');
      });
    });
  });
}

describe('utan databas på Vercel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('svarar 503 no_database med instruktioner på svenska', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('POSTGRES_URL', '');
    for (const endpoint of ['session', 'read', 'write']) {
      const res = await call<{ error: string; message: string }>(undefined, endpoint, endpoint === 'read' ? { reads: [{ path: 'games' }] } : undefined);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('no_database');
      expect(res.body.message).toMatch(/Storage/);
      expect(res.body.message).toMatch(/Neon/);
      expect(res.body.message).toMatch(/Redeploy/);
    }
  });
});
