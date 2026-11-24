/**
 * Gemensamma tester för Store-implementationerna (server/store.ts): store-file.ts och store-pg.ts
 * ska bete sig likadant. Används av store-file.test.ts och store-pg.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Store, StoredDoc } from '../../server/store';
import type { TestBackend } from './helpers';

/** Skriver dokument (null = ta bort) i en transaktion och returnerar dess rev. */
export async function put(store: Store, docs: Record<string, unknown>): Promise<number | null> {
  const keys = Object.keys(docs);
  const { rev } = await store.transact(keys, () => ({ changes: new Map(Object.entries(docs)), result: null }));
  return rev;
}

export async function getDoc(store: Store, key: string): Promise<StoredDoc> {
  return (await store.read({ keys: [key] })).docs.get(key)!;
}

export async function prefix(store: Store, p: string, known?: number) {
  const res = await store.read({ prefixes: [p], ...(known !== undefined ? { known: new Map([[p, known]]) } : {}) });
  return res.prefixes.get(p)!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function storeContract(backend: TestBackend) {
  describe(`lagret (${backend.name})`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await backend.fresh();
    });

    it('saknade dokument har data null och rev 0', async () => {
      const res = await store.read({ keys: ['games/x', 'setup'], prefixes: ['games/'] });
      expect(res.docs.get('games/x')).toEqual({ data: null, rev: 0 });
      expect(res.docs.get('setup')).toEqual({ data: null, rev: 0 });
      expect(res.prefixes.get('games/')).toEqual({ docs: new Map(), rev: 0 });
    });

    it('en transaktion får en rev som alla dess dokument får, och nästa får en högre', async () => {
      const r1 = await put(store, { 'games/a': { n: 1 }, 'pins/123456': 'a' });
      expect(r1).toBeGreaterThan(0);
      const res = await store.read({ keys: ['games/a', 'pins/123456'] });
      expect(res.docs.get('games/a')).toEqual({ data: { n: 1 }, rev: r1 });
      expect(res.docs.get('pins/123456')).toEqual({ data: 'a', rev: r1 });
      const r2 = await put(store, { 'games/a': { n: 2 } });
      expect(r2).toBeGreaterThan(r1!);
      expect(await getDoc(store, 'games/a')).toEqual({ data: { n: 2 }, rev: r2 });
      expect((await getDoc(store, 'pins/123456')).rev).toBe(r1);
    });

    it('värden går fram och tillbaka oförändrade (text, emoji, citattecken, tal, arrayer)', async () => {
      const value = {
        name: 'Säg "santé" \\ \'skål\' 🍸🌶️  ',
        nested: { list: [1, 2.5, -3, 1.7e15, true, false, 'x', { y: [] }], empty: {} },
        big: 1_763_990_400_123,
        tiny: 0.1 + 0.2,
      };
      await put(store, { 'games/v': value, setup: true, 'pins/111111': 'ä' });
      expect((await getDoc(store, 'games/v')).data).toEqual(value);
      expect((await getDoc(store, 'setup')).data).toBe(true);
      expect((await getDoc(store, 'pins/111111')).data).toBe('ä');
    });

    it('borttagning ger en gravsten: data null, ny rev, borta ur samlingen', async () => {
      const r1 = await put(store, { 'games/a': { n: 1 }, 'games/b': { n: 2 } });
      const before = await prefix(store, 'games/');
      expect([...before.docs.keys()].sort()).toEqual(['a', 'b']);
      const r2 = await put(store, { 'games/a': null });
      expect(r2).toBeGreaterThan(r1!);
      expect(await getDoc(store, 'games/a')).toEqual({ data: null, rev: r2 });
      const after = await prefix(store, 'games/');
      expect([...after.docs.keys()]).toEqual(['b']);
      expect(after.rev).not.toBe(before.rev);
      expect(after.rev).toBeGreaterThan(before.rev);
    });

    it('samlingens rev är summan av dokumentens rev (gravstenar inräknade)', async () => {
      const ra = (await put(store, { 'hallOfFame/a': { n: 1 } }))!;
      const rb = (await put(store, { 'hallOfFame/b': { n: 1 } }))!;
      expect((await prefix(store, 'hallOfFame/')).rev).toBe(ra + rb);
      const rc = (await put(store, { 'hallOfFame/a': null }))!;
      const p = await prefix(store, 'hallOfFame/');
      expect(p.rev).toBe(rc + rb);
      expect(p.docs).toEqual(new Map([['b', { n: 1 }]]));
      // Bara gravstenar kvar: inga dokument, men rev > 0
      const rd = (await put(store, { 'hallOfFame/b': null }))!;
      expect(await prefix(store, 'hallOfFame/')).toEqual({ docs: new Map(), rev: rc + rd });
    });

    it('prefixet matchar bokstavligt (_ och % är inga jokertecken)', async () => {
      await put(store, { 'p_x/1': 1, 'pax/1': 2, 'p%/1': 3, 'p_/1': 4 });
      expect([...(await prefix(store, 'p_x/')).docs]).toEqual([['1', 1]]);
      expect([...(await prefix(store, 'p%/')).docs]).toEqual([['1', 3]]);
      expect([...(await prefix(store, 'p_/')).docs]).toEqual([['1', 4]]);
      expect([...(await prefix(store, 'games/')).docs]).toEqual([]);
    });

    it('känd rev: oförändrat svar utan data, annars data', async () => {
      const r1 = (await put(store, { 'games/a': { n: 1 } }))!;
      const coll = await prefix(store, 'games/');
      const res = await store.read({
        keys: ['games/a', 'games/saknas', 'games/b'],
        prefixes: ['games/', 'pins/'],
        known: new Map([
          ['games/a', r1],
          ['games/saknas', 0],
          ['games/b', 999],
          ['games/', coll.rev],
          ['pins/', 5],
        ]),
      });
      expect(res.docs.get('games/a')).toEqual({ data: null, rev: r1, unchanged: true });
      expect(res.docs.get('games/saknas')).toEqual({ data: null, rev: 0, unchanged: true });
      expect(res.docs.get('games/b')).toEqual({ data: null, rev: 0 });
      expect(res.prefixes.get('games/')).toEqual({ docs: new Map(), rev: coll.rev, unchanged: true });
      expect(res.prefixes.get('pins/')).toEqual({ docs: new Map(), rev: 0 });
      // Ändrat sedan den kända rev:en → data
      const r2 = (await put(store, { 'games/a': { n: 2 } }))!;
      const again = await store.read({ keys: ['games/a'], prefixes: ['games/'], known: new Map([['games/a', r1], ['games/', coll.rev]]) });
      expect(again.docs.get('games/a')).toEqual({ data: { n: 2 }, rev: r2 });
      expect(again.prefixes.get('games/')?.docs).toEqual(new Map([['a', { n: 2 }]]));
    });

    it('utan ändringar skrivs inget och ingen rev tas', async () => {
      const r1 = (await put(store, { 'games/a': { n: 1 } }))!;
      const out = await store.transact(['games/a'], () => ({ changes: new Map(), result: 'ingenting' }));
      expect(out).toEqual({ rev: null, result: 'ingenting' });
      expect((await getDoc(store, 'games/a')).rev).toBe(r1);
    });

    it('kastar plan() skrivs ingenting, och felet kastas vidare', async () => {
      await put(store, { 'games/a': { n: 1 } });
      await expect(
        store.transact(['games/a'], () => {
          throw new Error('nej');
        }),
      ).rejects.toThrow('nej');
      await expect(
        store.transact(['games/a'], async () => {
          await sleep(1);
          throw new Error('nej igen');
        }),
      ).rejects.toThrow('nej igen');
      // Ändring av ett olåst dokument är ett programmeringsfel
      await expect(store.transact(['games/a'], () => ({ changes: new Map<string, unknown>([['games/a', { n: 9 }], ['games/b', 1]]), result: null }))).rejects.toThrow(
        /inte är låst/,
      );
      expect((await getDoc(store, 'games/a')).data).toEqual({ n: 1 });
      expect((await getDoc(store, 'games/b')).data).toBeNull();
      // Lagret fungerar fortfarande efteråt
      await put(store, { 'games/a': { n: 2 } });
      expect((await getDoc(store, 'games/a')).data).toEqual({ n: 2 });
    });

    it('plan() får låsta dokument + alsoRead, och kan läsa fler med tx.read', async () => {
      await put(store, { secret: { adminHash: 'h' }, 'games/a': { n: 1 }, 'pins/222222': 'a' });
      const out = await store.transact(
        ['games/a'],
        async (current, tx) => {
          const more = await tx.read(['pins/222222', 'pins/saknas']);
          return {
            changes: new Map([['games/a', { n: 2 }]]),
            result: {
              keys: [...current.keys()].sort(),
              secret: current.get('secret')?.data,
              pin: more.get('pins/222222')?.data,
              missing: more.get('pins/saknas'),
            },
          };
        },
        { alsoRead: ['secret', 'setup'] },
      );
      expect(out.result).toEqual({ keys: ['games/a', 'secret', 'setup'], secret: { adminHash: 'h' }, pin: 'a', missing: { data: null, rev: 0 } });
    });

    it('samtidiga transaktioner på samma dokument: alla ändringar sparas', async () => {
      await put(store, { 'games/g': { meta: { status: 'running' } } });
      const N = 20;
      const revs = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          store.transact(['games/g'], async (current) => {
            const game = structuredClone((current.get('games/g')!.data ?? {}) as { votes?: Record<string, number> });
            await sleep(Math.random() * 5); // låt transaktionerna överlappa
            game.votes = { ...(game.votes ?? {}), [`v${i}`]: i };
            return { changes: new Map([['games/g', game]]), result: null };
          }),
        ),
      );
      const doc = await getDoc(store, 'games/g');
      expect(Object.keys((doc.data as { votes: object }).votes)).toHaveLength(N);
      const all = revs.map((r) => r.rev!);
      expect(new Set(all).size).toBe(N);
      expect(doc.rev).toBe(Math.max(...all));
    });

    it('samtidiga transaktioner över flera dokument i olika ordning låser sig inte', async () => {
      const N = 12;
      await Promise.all(
        Array.from({ length: N }, (_, i) => {
          const keys = i % 2 ? ['games/a', 'games/b', 'pins/333333'] : ['pins/333333', 'games/b', 'games/a'];
          return store.transact(keys, async (current) => {
            await sleep(Math.random() * 3);
            const changes = new Map<string, unknown>();
            for (const key of keys) {
              const data = (current.get(key)!.data ?? { count: 0 }) as { count: number };
              changes.set(key, { count: data.count + 1 });
            }
            return { changes, result: null };
          });
        }),
      );
      const res = await store.read({ keys: ['games/a', 'games/b', 'pins/333333'] });
      for (const doc of res.docs.values()) expect(doc.data).toEqual({ count: N });
    });
  });
}
