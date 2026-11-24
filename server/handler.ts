import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import {
  docKeyOf,
  isValidKey,
  type ApiErrorCode,
  type ReadResult,
  type WriteRequest,
} from '../src/lib/backend/protocol.js';
import { getAt, isPlainObject, normalize, setAt, writesOf, type Tree } from '../src/lib/backend/tree.js';
import { splitPath } from '../src/lib/backend/types.js';
import { canRead, checkWrite, docSource, NeedDocsError, type Auth } from './rules.js';
import { createFileStore } from './store-file.js';
import { createPgStore } from './store-pg.js';
import { canonicalJson, type Store } from './store.js';

/**
 * API:t (se src/lib/backend/protocol.ts): POST /api/session, /api/read och /api/write.
 * Samma kod körs i Vercel Functions (api/*.ts) och lokalt i Vite (server/vite-plugin.ts).
 *
 * Lagring: Postgres om DATABASE_URL (eller POSTGRES_URL) är satt, annars – lokalt – en JSON-fil
 * (.data/dev-db.json). På Vercel utan databas svarar API:t 503 no_database.
 *
 * Identitet: /api/session ger ett slumpat uid och en token = uid + "." + HMAC-SHA256(hemlighet, uid).
 * Inget sparas per session. Hemligheten tas från SESSION_SECRET, eller skapas slumpvis första gången
 * och sparas i det interna dokumentet "__server".
 */

export const MAX_BODY_BYTES = 256 * 1024;
const MAX_READS = 200;
const MAX_WRITE_PATHS = 1000;
const MAX_DEPTH = 32;
/** Felaktiga admininloggningar per IP: högst 10 per 10 minuter. */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60_000;

const SERVER_DOC = '__server';
const RATE_LIMIT_PREFIX = '__ratelimit/';
const UID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UID_LENGTH = 28;
const UID_RE = /^[A-Za-z0-9]{20,40}$/;
/** Text som Postgres jsonb inte kan lagra: NUL-tecken och ensamma surrogater. */
const BAD_TEXT = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const MESSAGES: Record<ApiErrorCode, string> = {
  bad_request: 'Ogiltig förfrågan',
  unauthenticated: 'Saknar giltig inloggning – ladda om sidan och försök igen',
  permission_denied: 'Åtkomst nekad',
  too_large: 'Förfrågan är för stor (max 256 kB)',
  rate_limited: 'För många felaktiga inloggningsförsök – vänta tio minuter och försök igen',
  no_database:
    'Ingen databas är kopplad till appen. Öppna projektet på vercel.com, gå till fliken Storage och skapa en ' +
    'Postgres-databas (Neon), helst i regionen Frankfurt (eu-central-1), och koppla den till projektet. ' +
    'Gör sedan en ny deploy (Deployments → ⋯ → Redeploy).',
  server_error: 'Något gick fel på servern – försök igen',
};

/* ------------------------------------------------------------------ */
/*  Svar                                                                */
/* ------------------------------------------------------------------ */

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ...body, now: Date.now() }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  permission_denied: 403,
  too_large: 413,
  rate_limited: 429,
  no_database: 503,
  server_error: 500,
};

function fail(error: ApiErrorCode, message = MESSAGES[error], headers: Record<string, string> = {}, status = STATUS[error]): Response {
  return json(status, { error, message }, headers);
}

class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message = MESSAGES[code],
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/*  Lagring                                                             */
/* ------------------------------------------------------------------ */

let defaultStore: { url: string | null; store: Store } | null = null;

function databaseUrl(): string | null {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim() || null;
}

/** Lagringen som API:t använder när ingen skickas in, eller null om databas saknas på Vercel. */
export function getDefaultStore(): Store | null {
  const url = databaseUrl();
  if (!url && process.env.VERCEL) return null;
  if (defaultStore?.url === url) return defaultStore.store;
  if (defaultStore) void defaultStore.store.close().catch(() => undefined);
  const store = url
    ? createPgStore({ connectionString: url })
    : createFileStore({ file: process.env.BB_DEV_DB_FILE || resolve('.data/dev-db.json') });
  defaultStore = { url, store };
  return store;
}

export async function closeDefaultStore(): Promise<void> {
  const current = defaultStore;
  defaultStore = null;
  await current?.store.close();
}

/* ------------------------------------------------------------------ */
/*  Sessioner                                                           */
/* ------------------------------------------------------------------ */

const secrets = new WeakMap<Store, Promise<string>>();

/** Hemligheten som tokens signeras med. */
function sessionSecret(store: Store): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return Promise.resolve(fromEnv);
  let secret = secrets.get(store);
  if (!secret) {
    secret = (async () => {
      const existing = (await store.read({ keys: [SERVER_DOC] })).docs.get(SERVER_DOC)?.data;
      if (isPlainObject(existing) && typeof existing.secret === 'string') return existing.secret;
      const { result } = await store.transact([SERVER_DOC], (current) => {
        const data = current.get(SERVER_DOC)?.data;
        if (isPlainObject(data) && typeof data.secret === 'string') return { changes: new Map(), result: data.secret };
        const fresh = randomBytes(32).toString('base64url');
        return {
          changes: new Map([[SERVER_DOC, { ...(isPlainObject(data) ? data : {}), secret: fresh, createdAt: Date.now() }]]),
          result: fresh,
        };
      });
      return result;
    })();
    secrets.set(store, secret);
    secret.catch(() => secrets.delete(store));
  }
  return secret;
}

function sign(secret: string, uid: string): string {
  return createHmac('sha256', secret).update(`bonjour-babes:session:v1:${uid}`).digest('base64url');
}

function newUid(): string {
  let uid = '';
  for (let i = 0; i < UID_LENGTH; i++) uid += UID_CHARS[randomInt(UID_CHARS.length)];
  return uid;
}

async function authFrom(request: Request, store: Store): Promise<{ auth: Auth; tokenSent: boolean }> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return { auth: null, tokenSent: header.trim() !== '' };
  const token = match[1];
  const dot = token.lastIndexOf('.');
  const uid = token.slice(0, dot);
  if (dot < 0 || !UID_RE.test(uid)) return { auth: null, tokenSent: true };
  const expected = Buffer.from(sign(await sessionSecret(store), uid));
  const given = Buffer.from(token.slice(dot + 1));
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  return { auth: ok ? { uid } : null, tokenSent: true };
}

/* ------------------------------------------------------------------ */
/*  Indata                                                              */
/* ------------------------------------------------------------------ */

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new HttpError('too_large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError('too_large');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError('bad_request', 'Förfrågan är inte giltig UTF-8');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('bad_request', 'Förfrågan är inte giltig JSON');
  }
}

/** Segmenten i en sökväg, eller null om någon nyckel är ogiltig (t.ex. interna "__"-nycklar). */
function parsePath(path: unknown): string[] | null {
  if (typeof path !== 'string') return null;
  const segs = splitPath(path);
  if (segs.length > MAX_DEPTH) return null;
  return segs.every((s) => isValidKey(s) && !BAD_TEXT.test(s)) ? segs : null;
}

/** Felmeddelande om värdet inte går att spara, annars null. */
function checkValue(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return 'Värdet är för djupt nästlat';
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return BAD_TEXT.test(value) ? 'Texten innehåller ogiltiga tecken' : null;
    case 'number':
      return Number.isFinite(value) ? null : 'Ogiltigt tal';
    case 'boolean':
      return null;
    case 'object': {
      if (Array.isArray(value)) {
        for (const v of value) {
          const err = checkValue(v, depth + 1);
          if (err) return err;
        }
        return null;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!isValidKey(k) || BAD_TEXT.test(k)) return `Ogiltig nyckel: "${k}"`;
        const err = checkValue(v, depth + 1);
        if (err) return err;
      }
      return null;
    }
    default:
      return 'Ogiltigt värde';
  }
}

const isPrefixOf = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((s, i) => s === b[i]);

/* ------------------------------------------------------------------ */
/*  Begränsning av felaktiga admininloggningar                          */
/* ------------------------------------------------------------------ */

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get('x-real-ip')?.trim() || 'okänd';
}

async function rateLimitKey(request: Request, store: Store): Promise<string> {
  // IP-adressen sparas aldrig i klartext.
  const hash = createHash('sha256').update(`${await sessionSecret(store)}:ip:${clientIp(request)}`).digest('hex');
  return `${RATE_LIMIT_PREFIX}${hash.slice(0, 32)}`;
}

function recentFailures(data: unknown, now: number): number[] {
  const list = isPlainObject(data) && Array.isArray(data.failures) ? data.failures : [];
  return list.filter((t): t is number => typeof t === 'number' && t > now - LOGIN_FAILURE_WINDOW_MS && t <= now + 60_000);
}

/** Sekunder kvar av spärren, eller 0 om IP:n får försöka. */
async function loginBlockedFor(store: Store, key: string): Promise<number> {
  const now = Date.now();
  const failures = recentFailures((await store.read({ keys: [key] })).docs.get(key)?.data, now);
  if (failures.length < LOGIN_FAILURE_LIMIT) return 0;
  const oldest = Math.min(...failures);
  return Math.max(1, Math.ceil((oldest + LOGIN_FAILURE_WINDOW_MS - now) / 1000));
}

async function recordLoginFailure(store: Store, key: string): Promise<void> {
  await store.transact([key], (current) => {
    const now = Date.now();
    const failures = [...recentFailures(current.get(key)?.data, now), now].slice(-LOGIN_FAILURE_LIMIT);
    return { changes: new Map([[key, { failures }]]), result: undefined };
  });
}

/* ------------------------------------------------------------------ */
/*  /api/session                                                        */
/* ------------------------------------------------------------------ */

async function handleSession(_request: Request, store: Store): Promise<Response> {
  const uid = newUid();
  return json(200, { uid, token: `${uid}.${sign(await sessionSecret(store), uid)}` });
}

/* ------------------------------------------------------------------ */
/*  /api/read                                                           */
/* ------------------------------------------------------------------ */

type ReadTarget =
  | { kind: 'doc'; key: string; sub: string[] }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'error'; error: 'permission_denied' | 'bad_request' };

async function handleRead(request: Request, store: Store): Promise<Response> {
  const body = await readJson(request);
  const reads = isPlainObject(body) ? body.reads : undefined;
  if (!Array.isArray(reads) || reads.length < 1 || reads.length > MAX_READS) {
    throw new HttpError('bad_request', `reads måste vara en lista med 1–${MAX_READS} sökvägar`);
  }
  const entries = reads.map((r) => {
    if (!isPlainObject(r) || typeof r.path !== 'string') throw new HttpError('bad_request', 'Varje läsning måste ha en path');
    const rev = r.rev;
    if (rev !== undefined && !(typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 0)) {
      throw new HttpError('bad_request', 'Ogiltig rev');
    }
    return { path: r.path, rev: rev as number | undefined };
  });

  const { auth } = await authFrom(request, store); // ogiltig token = läs som oinloggad
  const now = Date.now();

  const targets: ReadTarget[] = entries.map(({ path }) => {
    const segs = parsePath(path);
    if (!segs) return { kind: 'error', error: 'bad_request' };
    if (!canRead(segs, auth, undefined, now)) return { kind: 'error', error: 'permission_denied' };
    const key = docKeyOf(segs.join('/'));
    if (key !== null) return { kind: 'doc', key, sub: segs.slice(splitPath(key).length) };
    if (segs.length === 1) return { kind: 'prefix', prefix: `${segs[0]}/` };
    return { kind: 'error', error: 'bad_request' }; // roten
  });

  // Känd rev per dokument/prefix – bara om alla läsningar av det har samma rev (annars hämtas datat).
  const known = new Map<string, number>();
  const conflicting = new Set<string>();
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  targets.forEach((t, i) => {
    if (t.kind === 'error') return;
    const id = t.kind === 'doc' ? t.key : t.prefix;
    (t.kind === 'doc' ? keys : prefixes).add(id);
    const rev = entries[i].rev;
    if (rev === undefined || (known.has(id) && known.get(id) !== rev)) conflicting.add(id);
    else known.set(id, rev);
  });
  for (const id of conflicting) known.delete(id);

  const data = keys.size || prefixes.size ? await store.read({ keys: [...keys], prefixes: [...prefixes], known }) : null;

  const results: ReadResult[] = targets.map((t, i) => {
    const { path, rev: knownRev } = entries[i];
    if (t.kind === 'error') return { path, error: t.error };
    if (t.kind === 'doc') {
      const doc = data!.docs.get(t.key)!;
      if (knownRev === doc.rev) return { path, rev: doc.rev, unchanged: true };
      return { path, rev: doc.rev, value: getAt(doc.data, t.sub) };
    }
    const coll = data!.prefixes.get(t.prefix)!;
    if (knownRev === coll.rev) return { path, rev: coll.rev, unchanged: true };
    return { path, rev: coll.rev, value: coll.docs.size ? Object.fromEntries(coll.docs) : null };
  });
  return json(200, { results });
}

/* ------------------------------------------------------------------ */
/*  /api/write                                                          */
/* ------------------------------------------------------------------ */

class DeniedError extends Error {}

interface ParsedWrite {
  segs: string[];
  value: unknown;
}

function parseWriteRequest(body: unknown): ParsedWrite[] {
  if (!isPlainObject(body)) throw new HttpError('bad_request');
  let req: WriteRequest;
  switch (body.op) {
    case 'set':
      if (typeof body.path !== 'string' || !('value' in body)) throw new HttpError('bad_request', 'set kräver path och value');
      req = { op: 'set', path: body.path, value: body.value };
      break;
    case 'update':
      if (typeof body.path !== 'string' || !isPlainObject(body.values)) {
        throw new HttpError('bad_request', 'update kräver path och values');
      }
      if (Object.keys(body.values).length > MAX_WRITE_PATHS) throw new HttpError('bad_request', 'För många sökvägar');
      req = { op: 'update', path: body.path, values: body.values };
      break;
    case 'remove':
      if (typeof body.path !== 'string') throw new HttpError('bad_request', 'remove kräver path');
      req = { op: 'remove', path: body.path };
      break;
    default:
      throw new HttpError('bad_request', 'Okänd operation');
  }
  if (!parsePath(req.path)) throw new HttpError('bad_request', `Ogiltig sökväg: "${req.path}"`);
  if (req.op === 'update') {
    for (const key of Object.keys(req.values)) {
      if (!splitPath(key).length || !parsePath(key)) throw new HttpError('bad_request', `Ogiltig sökväg: "${key}"`);
    }
  }

  const writes = writesOf(req).map(({ path, value }) => {
    const segs = parsePath(path);
    if (!segs) throw new HttpError('bad_request', `Ogiltig sökväg: "${path}"`);
    // Platshållare för servertid godtas här; själva tiden sätts i transaktionen.
    const err = checkValue(normalize(value, 0));
    if (err) throw new HttpError('bad_request', err);
    return { segs, value };
  });
  for (let i = 0; i < writes.length; i++) {
    for (let j = 0; j < writes.length; j++) {
      if (i !== j && isPrefixOf(writes[i].segs, writes[j].segs)) {
        throw new HttpError('bad_request', `Sökvägarna "${writes[i].segs.join('/')}" och "${writes[j].segs.join('/')}" överlappar`);
      }
    }
  }
  return writes;
}

async function handleWrite(request: Request, store: Store): Promise<Response> {
  const { auth } = await authFrom(request, store);
  if (!auth) return fail('unauthenticated');
  const writes = parseWriteRequest(await readJson(request));
  if (!writes.length) return json(200, { ok: true, rev: 0 }); // update med tomt objekt

  // Skrivningar ovanför dokumentnivå (roten, "games" …) stöds inte. Reglerna nekar dem ändå – kontrollera
  // reglerna först så att svaret blir 403 precis som i Firebase.
  const aboveDocs = writes.filter((w) => docKeyOf(w.segs.join('/')) === null);
  if (aboveDocs.length) {
    const unsupported = (): unknown => {
      throw new Error('ovanför dokumentnivå');
    };
    let verdict;
    try {
      verdict = checkWrite({ auth, locations: aboveDocs.map((w) => w.segs), oldRoot: unsupported, newRoot: unsupported, now: Date.now() });
    } catch {
      verdict = { ok: false };
    }
    if (!verdict.ok) return fail('permission_denied');
    throw new HttpError('bad_request', 'Skrivningar ovanför dokumentnivå stöds inte');
  }

  // Admininloggning (skriva adminSessions/{uid}): spärra IP-adresser med för många felaktiga försök.
  const isLogin = writes.some((w) => w.segs[0] === 'adminSessions' && normalize(w.value, 0) !== null);
  const limitKey = isLogin ? await rateLimitKey(request, store) : null;
  if (limitKey) {
    const wait = await loginBlockedFor(store, limitKey);
    if (wait) return fail('rate_limited', undefined, { 'Retry-After': String(wait) });
  }

  const touched = [...new Set(writes.map((w) => docKeyOf(w.segs.join('/'))!))];
  try {
    const { rev, result } = await store.transact(
      touched,
      async (current, tx) => {
        const now = Date.now();
        const loaded = new Map<string, unknown>();
        for (const [key, doc] of current) loaded.set(key, doc.data);

        // Nya dokument: gamla datat + skrivningarna, normaliserat (servertid, null bort, tomma objekt bort).
        let tree: Tree = {};
        for (const key of touched) tree = setAt(tree, key, loaded.get(key) ?? null);
        for (const w of writes) tree = setAt(tree, w.segs, w.value);
        const newDocs = new Map<string, unknown>();
        for (const key of touched) newDocs.set(key, normalize(getAt(tree, key), now));

        // Reglerna. Behöver de fler dokument läses de in (olåsta) och kontrollen görs om.
        for (let attempt = 0; ; attempt++) {
          try {
            const verdict = checkWrite({
              auth,
              locations: writes.map((w) => w.segs),
              oldRoot: docSource(loaded),
              newRoot: docSource(new Map([...loaded, ...newDocs])),
              now,
            });
            if (!verdict.ok) throw new DeniedError(verdict.reason);
            break;
          } catch (err) {
            if (!(err instanceof NeedDocsError) || attempt >= 5) throw err;
            for (const [key, doc] of await tx.read(err.keys)) loaded.set(key, doc.data);
          }
        }

        const changes = new Map<string, unknown>();
        for (const key of touched) {
          if (canonicalJson(newDocs.get(key)) !== canonicalJson(loaded.get(key) ?? null)) changes.set(key, newDocs.get(key));
        }
        const previousRev = Math.max(0, ...touched.map((key) => current.get(key)?.rev ?? 0));
        return { changes, result: { now, previousRev } };
      },
      { alsoRead: ['secret', 'setup', `adminSessions/${auth.uid}`] },
    );
    return json(200, { ok: true, rev: rev ?? result.previousRev });
  } catch (err) {
    if (!(err instanceof DeniedError)) throw err;
    if (limitKey) await recordLoginFailure(store, limitKey);
    return fail('permission_denied');
  }
}

/* ------------------------------------------------------------------ */
/*  Ingången                                                            */
/* ------------------------------------------------------------------ */

const ROUTES = {
  '/api/session': handleSession,
  '/api/read': handleRead,
  '/api/write': handleWrite,
} as const;

/**
 * Hanterar ett anrop till /api/session, /api/read eller /api/write.
 * store: lagringen att använda (testerna); annars Postgres/fil enligt miljön (getDefaultStore).
 */
export async function handle(request: Request, store?: Store): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
    const route = (ROUTES as Record<string, (req: Request, store: Store) => Promise<Response>>)[pathname];
    if (!route) return fail('bad_request', 'Okänd adress', {}, 404);
    if (request.method !== 'POST') return fail('bad_request', 'Använd POST', { Allow: 'POST' }, 405);
    const db = store ?? getDefaultStore();
    if (!db) return fail('no_database');
    return await route(request, db);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.code, err.message);
    console.error('[bonjour-babes] API-fel:', err);
    return fail('server_error');
  }
}
