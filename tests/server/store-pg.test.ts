/**
 * Postgres-lagret (server/store-pg.ts) mot en riktig databas:
 *
 *   TEST_DATABASE_URL=postgres://bb:bb@localhost:5432/bb_test npm run test:pg
 *
 * Hoppas över i `npm test` när TEST_DATABASE_URL saknas (men `npm run test:pg` kräver den).
 * Testerna skapar och tömmer egna tabeller (bb_docs_test_*) – peka aldrig på produktionsdatabasen.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createPgStore, pgConfig } from '../../server/store-pg';
import type { Store } from '../../server/store';
import { call, client, ownerGet, ownerPut, pgQuery, postgresBackend, requirePostgresIfAsked, TEST_DATABASE_URL } from './helpers';
import { getDoc, put, storeContract } from './storeContract';

requirePostgresIfAsked();

describe('anslutningsinställningar (pgConfig)', () => {
  it('TLS med certifikatkontroll mot molnet, utan TLS mot localhost', () => {
    expect(pgConfig('postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require')).toEqual({
      connectionString: 'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb',
      ssl: true,
    });
    expect(pgConfig('postgres://u:p@db.example.com:5432/x')).toMatchObject({ ssl: true });
    expect(pgConfig('postgres://u:p@localhost:5432/x')).toMatchObject({ ssl: false });
    expect(pgConfig('postgres://u:p@127.0.0.1/x?sslmode=require')).toMatchObject({ ssl: true });
    expect(pgConfig('postgres://u:p@db.example.com/x?sslmode=disable')).toMatchObject({ ssl: false });
    expect(pgConfig('postgres://u:p@db.example.com/x?sslmode=no-verify')).toMatchObject({ ssl: { rejectUnauthorized: false } });
  });
});

const backend = postgresBackend('bb_docs_test_store');

describe.skipIf(!backend)('Postgres', () => {
  afterAll(async () => {
    await backend?.close();
  });

  if (backend) storeContract(backend); // (describe-kroppen körs även när den hoppas över)

  it('skapar tabell, index och sekvens automatiskt – även när flera instanser startar samtidigt', async () => {
    await pgQuery('DROP TABLE IF EXISTS bb_docs_test_schema; DROP SEQUENCE IF EXISTS bb_docs_test_schema_rev_seq;');
    const stores = Array.from({ length: 4 }, () => createPgStore({ connectionString: TEST_DATABASE_URL, table: 'bb_docs_test_schema', max: 2 }));
    try {
      await Promise.all(stores.map((s, i) => put(s, { [`games/${i}`]: { i } })));
      const cols = await pgQuery(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'bb_docs_test_schema' ORDER BY ordinal_position",
      );
      expect(cols.rows).toEqual([
        { column_name: 'key', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'data', data_type: 'jsonb', is_nullable: 'YES' },
        { column_name: 'rev', data_type: 'bigint', is_nullable: 'NO' },
        { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
      const idx = await pgQuery("SELECT indexdef FROM pg_indexes WHERE tablename = 'bb_docs_test_schema'");
      expect(idx.rows.map((r: { indexdef: string }) => r.indexdef).join('\n')).toMatch(/text_pattern_ops/);
      // En gravsten är NULL i databasen (inte JSON null)
      await put(stores[0], { 'games/0': null });
      const row = await pgQuery("SELECT data IS NULL AS tomb, rev FROM bb_docs_test_schema WHERE key = 'games/0'");
      expect(row.rows[0].tomb).toBe(true);
    } finally {
      await Promise.all(stores.map((s) => s.close()));
      await pgQuery('DROP TABLE IF EXISTS bb_docs_test_schema; DROP SEQUENCE IF EXISTS bb_docs_test_schema_rev_seq;');
    }
  });

  describe('API:t mot Postgres', () => {
    const apiBackend = postgresBackend('bb_docs_test_api', 5)!; // null utan databas – testerna hoppas då över
    let store: Store;
    afterAll(async () => {
      await apiBackend.close();
    });

    it('10 mobiler röstar samtidigt i samma spel – alla röster sparas', async () => {
      store = await apiBackend.fresh();
      const voters = await Promise.all(Array.from({ length: 10 }, (_, i) => client(store, true, `10.1.0.${i}`)));
      const creator = await client(store);
      const players: Record<string, unknown> = {};
      for (const c of [creator, ...voters]) players[c.uid] = { name: c.uid.slice(0, 8), drink: 'D', emoji: '🍸', color: '#6e1430', joinedAt: 1 };
      await ownerPut(store, 'games/fest', {
        meta: { name: 'Fest', pin: '123456', createdAt: 1, status: 'running' },
        players,
        current: { index: 0, drinkId: creator.uid, phase: 'voting', since: 1 },
      });

      const results = await Promise.allSettled(
        voters.map((v, i) =>
          v.set(`games/fest/votes/${creator.uid}/${v.uid}`, { taste: (i % 10) + 1, look: 5, creativity: 5, again: 5, at: { '.sv': 'timestamp' } }),
        ),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const votes = await ownerGet<Record<string, { taste: number; at: number }>>(store, `games/fest/votes/${creator.uid}`);
      expect(Object.keys(votes ?? {}).sort()).toEqual(voters.map((v) => v.uid).sort());
      for (const v of Object.values(votes!)) expect(typeof v.at).toBe('number');
    });

    it('10 mobiler går med samtidigt och pollar samtidigt', async () => {
      store = await apiBackend.fresh();
      await ownerPut(store, 'games/g2', { meta: { name: 'G', pin: '654321', createdAt: 1, status: 'lobby' } });
      const phones = await Promise.all(Array.from({ length: 10 }, () => client(store)));
      await Promise.all(
        phones.map((p, i) => p.set(`games/g2/players/${p.uid}`, { name: `P${i}`, drink: 'D', emoji: '🍹', color: '#2f4f4f', joinedAt: { '.sv': 'timestamp' } })),
      );
      const reads = await Promise.all(phones.map((p) => p.get<{ players: object }>('games/g2')));
      for (const game of reads) expect(Object.keys(game!.players)).toHaveLength(10);
      const doc = await getDoc(store, 'games/g2');
      // Pollning med känd rev: oförändrat
      const poll = await call<{ results: { unchanged?: boolean; rev: number }[] }>(store, 'read', {
        reads: [{ path: 'games/g2', rev: doc.rev }, { path: 'games', rev: 0 }],
      });
      expect(poll.body.results[0]).toEqual({ path: 'games/g2', rev: doc.rev, unchanged: true });
      expect(poll.body.results[1].unchanged).toBeUndefined();
    });
  });
});
