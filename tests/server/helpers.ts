/**
 * Hjälpfunktioner för servertesterna: anropar handle() direkt med Request-objekt (ingen nätverkstrafik)
 * mot ett valfritt lager – i minnet, eller Postgres om TEST_DATABASE_URL är satt.
 */
import pg from 'pg';
import { handle } from '../../server/handler';
import { createFileStore } from '../../server/store-file';
import { createPgStore } from '../../server/store-pg';
import type { Store } from '../../server/store';
import { docKeyOf } from '../../src/lib/backend/protocol';
import { getAt, normalize, setAt } from '../../src/lib/backend/tree';
import { splitPath } from '../../src/lib/backend/types';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || '';

/* ------------------------------------------------------------------ */
/*  HTTP                                                                */
/* ------------------------------------------------------------------ */

export interface CallOptions {
  token?: string | null;
  headers?: Record<string, string>;
  method?: string;
  /** Rå body (i stället för JSON.stringify(body)). */
  raw?: BodyInit;
}

export interface ApiReply<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

export async function call<T = Record<string, unknown>>(
  store: Store | undefined,
  endpoint: 'session' | 'read' | 'write' | string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<ApiReply<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined || opts.raw !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const request = new Request(`http://localhost/api/${endpoint}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const res = await handle(request, store);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: JSON.parse(text) as T };
}

/* ------------------------------------------------------------------ */
/*  Testklient (en per simulerad användare)                             */
/* ------------------------------------------------------------------ */

export interface TestClient {
  /** Tom sträng för en oinloggad klient. */
  uid: string;
  token: string | null;
  set(path: string, value: unknown): Promise<void>;
  update(path: string, values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  get<T = unknown>(path: string): Promise<T | null>;
  pushKey(): string;
}

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let pushCounter = 0;

export function pushKey(): string {
  let rand = '';
  for (let i = 0; i < 12; i++) rand += PUSH_CHARS[Math.floor(Math.random() * 64)];
  return `-${Date.now().toString(36)}${(pushCounter++).toString(36)}${rand}`;
}

/** Fel som kastas av testklienten: meddelandet börjar med serverns felkod (t.ex. "permission_denied"). */
export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export async function client(store: Store, signIn = true, ip = '10.0.0.1'): Promise<TestClient> {
  let uid = '';
  let token: string | null = null;
  if (signIn) {
    const res = await call<{ uid: string; token: string }>(store, 'session');
    if (res.status !== 200) throw new Error(`session: ${res.status}`);
    ({ uid, token } = res.body);
  }
  const headers = { 'x-forwarded-for': ip };
  const write = async (req: unknown) => {
    const res = await call<{ error?: string; message?: string }>(store, 'write', req, { token, headers });
    if (res.status !== 200) throw new ApiCallError(res.body.error ?? 'okänt', res.status, res.body.message ?? '');
  };
  return {
    uid,
    token,
    set: (path, value) => write({ op: 'set', path, value }),
    update: (path, values) => write({ op: 'update', path, values }),
    remove: (path) => write({ op: 'remove', path }),
    async get<T>(path: string) {
      const res = await call<{ results: { error?: string; value?: unknown }[]; error?: string }>(
        store,
        'read',
        { reads: [{ path }] },
        { token, headers },
      );
      if (res.status !== 200) throw new ApiCallError(res.body.error ?? 'okänt', res.status, '');
      const r = res.body.results[0];
      if (r.error) throw new ApiCallError(r.error, 200, path);
      return (r.value ?? null) as T | null;
    },
    pushKey,
  };
}

/* ------------------------------------------------------------------ */
/*  Ägaråtkomst – direkt i lagret, förbi reglerna                       */
/* ------------------------------------------------------------------ */

export async function ownerGet<T = unknown>(store: Store, path: string): Promise<T | null> {
  const segs = splitPath(path);
  const key = docKeyOf(path);
  if (key === null) {
    if (segs.length !== 1) throw new Error(`ownerGet: stöds inte för "${path}"`);
    const coll = (await store.read({ prefixes: [`${segs[0]}/`] })).prefixes.get(`${segs[0]}/`)!;
    return (coll.docs.size ? Object.fromEntries(coll.docs) : null) as T | null;
  }
  const doc = (await store.read({ keys: [key] })).docs.get(key)!;
  return getAt(doc.data, segs.slice(splitPath(key).length)) as T | null;
}

export async function ownerPut(store: Store, path: string, value: unknown): Promise<void> {
  const key = docKeyOf(path);
  if (key === null) throw new Error(`ownerPut: stöds inte för "${path}"`);
  await store.transact([key], (current) => {
    let tree = setAt({}, key, current.get(key)?.data ?? null);
    tree = setAt(tree, path, value);
    return { changes: new Map([[key, normalize(getAt(tree, key), Date.now())]]), result: null };
  });
}

/* ------------------------------------------------------------------ */
/*  Lager att testa mot                                                 */
/* ------------------------------------------------------------------ */

export interface TestBackend {
  name: string;
  /** Ett tomt lager (nytt i minnet, eller tömd tabell i Postgres). */
  fresh(): Promise<Store>;
  close(): Promise<void>;
}

export function memoryBackend(): TestBackend {
  return { name: 'minne', fresh: async () => createFileStore(), close: async () => undefined };
}

export async function pgQuery(sql: string): Promise<pg.QueryResult> {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

/** Postgres med en egen tabell per testfil (så att filerna kan köras parallellt). null utan TEST_DATABASE_URL. */
export function postgresBackend(table: string, max?: number): TestBackend | null {
  if (!TEST_DATABASE_URL) return null;
  let store: Store | null = null;
  return {
    name: 'postgres',
    async fresh() {
      if (!store) {
        await pgQuery(`DROP TABLE IF EXISTS ${table}; DROP SEQUENCE IF EXISTS ${table}_rev_seq;`);
        store = createPgStore({ connectionString: TEST_DATABASE_URL, table, max });
        await store.read({ keys: ['__init'] }); // skapar tabellen
      } else {
        await pgQuery(`TRUNCATE ${table}`);
      }
      return store;
    },
    async close() {
      await store?.close();
      store = null;
    },
  };
}

/** Lagren att köra testerna mot: alltid minnet, och Postgres om TEST_DATABASE_URL är satt. */
export function testBackends(table: string): TestBackend[] {
  const pgBackend = postgresBackend(table);
  return pgBackend ? [memoryBackend(), pgBackend] : [memoryBackend()];
}

/** npm run test:pg utan TEST_DATABASE_URL ska fallera, inte tyst hoppa över Postgres-testerna. */
export function requirePostgresIfAsked(): void {
  if (!TEST_DATABASE_URL && process.env.npm_lifecycle_event === 'test:pg') {
    throw new Error(
      'Sätt TEST_DATABASE_URL till en Postgres-databas som testerna får skriva i, t.ex.\n' +
        '  TEST_DATABASE_URL=postgres://bb:bb@localhost:5432/bb_test npm run test:pg',
    );
  }
}
