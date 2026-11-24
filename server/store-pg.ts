import { attachDatabasePool } from '@vercel/functions';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { DOCS_TABLE } from '../src/lib/backend/protocol.js';
import {
  likePrefix,
  type PrefixRead,
  type ReadDoc,
  type ReadOutcome,
  type ReadSpec,
  type Store,
  type StoredDoc,
  type TransactOptions,
  type TxOutcome,
  type TxPlan,
  type TxReader,
} from './store.js';

/**
 * Dokumentlagret i Postgres (Neon på Vercel, eller en lokal Postgres).
 *
 *   bb_docs(key text primary key, data jsonb, rev bigint, updated_at timestamptz)
 *
 * data = NULL är en gravsten (borttaget dokument). Varje skrivande transaktion tar EN rev ur
 * sekvensen bb_rev_seq. Tabell, index och sekvens skapas automatiskt första gången.
 *
 * Fungerar genom Neons poolade anslutning (PgBouncer i transaktionsläge): inga namngivna prepared
 * statements, inget sessionstillstånd (bara SET LOCAL inne i transaktioner) och ingen LISTEN.
 *
 * Samtidighet: en transaktion låser alla dokument den ska skriva med pg_advisory_xact_lock (i
 * sorterad ordning, så att två transaktioner aldrig väntar på varandra i cirkel), tar sin rev
 * först när den har låsen och läser dokumenten efter att den fått låsen. 10 mobiler som röstar i
 * samma spel samtidigt körs alltså efter varandra och alla röster sparas.
 */

const { Pool } = pg;

export interface PgStoreOptions {
  connectionString: string;
  /** Tabellnamn (default bb_docs). Testerna använder egna tabeller. */
  table?: string;
  /** Max antal anslutningar i poolen (default 5 – Vercel kör många instanser, Neon poolar själv). */
  max?: number;
}

/** Timeouts inne i transaktionerna. En fryst funktion får aldrig hålla kvar lås. */
const TX_SETTINGS = "SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'";
const MAX_RETRIES = 3;

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '';
}

/**
 * Anslutningsinställningar från en URL. sslmode hanteras här (och tas bort ur URL:en, så att pg inte
 * varnar för att "require" tolkas som "verify-full"):
 *  - disable → ingen TLS · no-verify → TLS utan certifikatkontroll
 *  - annars TLS med certifikatkontroll, utom mot localhost utan sslmode.
 */
export function pgConfig(connectionString: string): pg.PoolConfig {
  let ssl: pg.PoolConfig['ssl'];
  let url = connectionString;
  try {
    const parsed = new URL(connectionString);
    const mode = parsed.searchParams.get('sslmode');
    parsed.searchParams.delete('sslmode');
    // channel_binding (som Neon lägger till) förstås inte av pg via URL:en – ta bort den.
    parsed.searchParams.delete('channel_binding');
    url = parsed.toString();
    if (mode === 'disable') ssl = false;
    else if (mode === 'no-verify') ssl = { rejectUnauthorized: false };
    else if (mode || !isLocalHost(parsed.hostname)) ssl = true;
    else ssl = false;
  } catch {
    /* inte en URL (t.ex. "host=… dbname=…") – låt pg tolka den */
  }
  return { connectionString: url, ...(ssl !== undefined ? { ssl } : {}) };
}

/** Stabilt 64-bitars lås-id för en dokumentnyckel (som decimalsträng). */
function lockId(namespace: string, key: string): bigint {
  return createHash('sha256').update(`bonjour-babes:${namespace}:${key}`).digest().readBigInt64BE(0);
}

interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function createPgStore(options: PgStoreOptions): Store {
  const table = options.table ?? DOCS_TABLE;
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(table)) throw new Error(`Ogiltigt tabellnamn: ${table}`);
  const seq = table === DOCS_TABLE ? 'bb_rev_seq' : `${table}_rev_seq`;

  const pool = new Pool({
    ...pgConfig(options.connectionString),
    max: options.max ?? 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  // Fel på vilande anslutningar (t.ex. när Neon stänger dem) får inte krascha processen.
  pool.on('error', (err) => console.warn('[bonjour-babes] Postgres-anslutning stängdes:', err.message));
  // På Vercel: håll funktionen vid liv tills vilande anslutningar har stängts (gör inget annars).
  attachDatabasePool(pool);

  let schema: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    schema ??= pool
      .query(
        `BEGIN;
         SELECT pg_advisory_xact_lock(${lockId('schema', table)});
         CREATE TABLE IF NOT EXISTS ${table} (
           key text PRIMARY KEY,
           data jsonb,
           rev bigint NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS ${table}_key_prefix_idx ON ${table} (key text_pattern_ops);
         CREATE SEQUENCE IF NOT EXISTS ${seq};
         COMMIT;`,
      )
      .then(
        () => undefined,
        (err: unknown) => {
          schema = null; // försök igen nästa gång
          throw err;
        },
      );
    return schema;
  };

  const toRev = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

  async function readKeys(db: Queryable, keys: readonly string[]): Promise<Map<string, StoredDoc>> {
    const out = new Map<string, StoredDoc>();
    for (const key of keys) out.set(key, { data: null, rev: 0 });
    if (!keys.length) return out;
    const res = await db.query<{ key: string; data: unknown; rev: string }>(
      `SELECT key, data, rev FROM ${table} WHERE key = ANY($1::text[])`,
      [[...new Set(keys)]],
    );
    for (const row of res.rows) out.set(row.key, { data: row.data ?? null, rev: toRev(row.rev) });
    return out;
  }

  async function readPrefix(prefix: string, known: number | undefined): Promise<PrefixRead> {
    // Ett enda uttryck (= en ögonblicksbild): summan, och dokumenten bara om summan har ändrats.
    const res = await pool.query<{ total: string; key: string | null; data: unknown }>(
      `WITH r AS (SELECT key, rev, data FROM ${table} WHERE key LIKE $1),
            t AS (SELECT COALESCE(SUM(rev), 0) AS total FROM r)
       SELECT t.total::text AS total, r.key, r.data
       FROM t LEFT JOIN r ON t.total IS DISTINCT FROM $2::numeric AND r.data IS NOT NULL`,
      [likePrefix(prefix), known ?? null],
    );
    const rev = toRev(res.rows[0]?.total);
    if (known !== undefined && rev === known) return { docs: new Map(), rev, unchanged: true };
    const docs = new Map<string, unknown>();
    for (const row of res.rows) if (row.key !== null && row.data !== null) docs.set(row.key.slice(prefix.length), row.data);
    return { docs, rev };
  }

  async function read(spec: ReadSpec): Promise<ReadOutcome> {
    await ensureSchema();
    const keys = [...new Set(spec.keys ?? [])];
    const known = spec.known;
    const docs = new Map<string, ReadDoc>();
    const tasks: Promise<unknown>[] = [];
    if (keys.length) {
      tasks.push(
        pool
          .query<{ key: string; rev: string; data: unknown; unchanged: boolean | null }>(
            `SELECT d.key, d.rev,
                    CASE WHEN d.rev = k.known THEN NULL ELSE d.data END AS data,
                    d.rev = k.known AS unchanged
             FROM unnest($1::text[], $2::bigint[]) AS k(key, known)
             JOIN ${table} d ON d.key = k.key`,
            [keys, keys.map((k) => known?.get(k) ?? null)],
          )
          .then((res) => {
            for (const key of keys) {
              docs.set(key, known?.get(key) === 0 ? { data: null, rev: 0, unchanged: true } : { data: null, rev: 0 });
            }
            for (const row of res.rows) {
              const rev = toRev(row.rev);
              docs.set(row.key, row.unchanged ? { data: null, rev, unchanged: true } : { data: row.data ?? null, rev });
            }
          }),
      );
    }
    const prefixes = new Map<string, PrefixRead>();
    for (const prefix of new Set(spec.prefixes ?? [])) {
      tasks.push(readPrefix(prefix, known?.get(prefix)).then((r) => prefixes.set(prefix, r)));
    }
    await Promise.all(tasks);
    return { docs, prefixes };
  }

  async function transactOnce<T>(
    keys: readonly string[],
    plan: (current: Map<string, StoredDoc>, tx: TxReader) => Promise<TxPlan<T>> | TxPlan<T>,
    opts: TransactOptions,
  ): Promise<TxOutcome<T>> {
    const locks = [...new Set(keys.map((k) => lockId(table, k)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const client = await pool.connect();
    /** Sätts om anslutningen är i okänt skick – då slängs den i stället för att lämnas tillbaka till poolen. */
    let broken: Error | undefined;
    try {
      // BEGIN, timeouts och låsen (i sorterad ordning) i ett och samma anrop. Lås-id:na är tal vi själva räknat ut.
      await client.query(`BEGIN; ${TX_SETTINGS}; ${locks.map((id) => `SELECT pg_advisory_xact_lock(${id});`).join(' ')}`);
      const current = await readKeys(client, [...new Set([...keys, ...(opts.alsoRead ?? [])])]);
      const { changes, result } = await plan(current, { read: (more) => readKeys(client, more) });
      let rev: number | null = null;
      if (changes.size) {
        for (const key of changes.keys()) {
          if (!keys.includes(key)) throw new Error(`Transaktionen ändrar ${key}, som inte är låst`);
        }
        const entries = [...changes];
        // Revisionen tas först nu, när låsen är tagna – då växer varje dokuments rev i commit-ordning.
        const res = await client.query<{ rev: string }>(
          `WITH r AS (SELECT nextval('${seq}') AS rev)
           INSERT INTO ${table} AS t (key, data, rev)
           SELECT x.key, x.data::jsonb, r.rev FROM unnest($1::text[], $2::text[]) AS x(key, data), r
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, rev = EXCLUDED.rev, updated_at = now()
           RETURNING t.rev`,
          [entries.map(([k]) => k), entries.map(([, v]) => (v === null || v === undefined ? null : JSON.stringify(v)))],
        );
        rev = toRev(res.rows[0]?.rev);
      }
      await client.query('COMMIT');
      return { rev, result };
    } catch (err) {
      // Avbryt transaktionen (även om felet kom från plan()). Går inte ens det är anslutningen trasig.
      await client.query('ROLLBACK').catch((e: unknown) => {
        broken = e instanceof Error ? e : new Error(String(e));
      });
      throw err;
    } finally {
      client.release(broken);
    }
  }

  return {
    kind: 'postgres',
    read,

    async transact<T>(
      keys: readonly string[],
      plan: (current: Map<string, StoredDoc>, tx: TxReader) => Promise<TxPlan<T>> | TxPlan<T>,
      opts: TransactOptions = {},
    ): Promise<TxOutcome<T>> {
      await ensureSchema();
      for (let attempt = 0; ; attempt++) {
        try {
          return await transactOnce(keys, plan, opts);
        } catch (err) {
          const code = (err as { code?: unknown })?.code;
          // 40P01 deadlock, 40001 serialiseringsfel: kör om (plan() körs då en gång till).
          if ((code === '40P01' || code === '40001') && attempt < MAX_RETRIES) continue;
          throw err;
        }
      }
    },

    async close() {
      await pool.end();
    },
  };
}
