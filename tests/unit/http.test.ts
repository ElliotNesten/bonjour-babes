/**
 * Tester av http-backenden (src/lib/backend/http.ts) mot en låtsasserver i minnet som följer
 * protokollet i src/lib/backend/protocol.ts. Tiden styrs med vitests falska timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpBackend, isNoDatabaseError, SESSION_STORAGE_KEY, type HttpBackendOptions } from '../../src/lib/backend/http';
import { isValidKey, type ReadRequest, type ReadResult, type WriteRequest } from '../../src/lib/backend/protocol';
import { isPermissionDenied, joinPath, PermissionDeniedError, splitPath, type Backend } from '../../src/lib/backend/types';

/* ------------------------------------------------------------------ */
/*  Låtsasserver                                                        */
/* ------------------------------------------------------------------ */

type Tree = Record<string, unknown>;
type Endpoint = 'session' | 'read' | 'write';

interface Call {
  endpoint: Endpoint;
  body: unknown;
  auth: string | null;
}

/** Ett minimalt svar: klienten använder bara status och text(). */
type FakeResponse = { status: number; text: () => Promise<string> };

/** Ersätter serverns svar: 'network' = fetch kastar, 'hang' = svarar aldrig, undefined = svara normalt. */
type Override = (endpoint: Endpoint, body: unknown) => FakeResponse | 'network' | 'hang' | undefined;

const isObj = (v: unknown): v is Tree => !!v && typeof v === 'object' && !Array.isArray(v);

function normalize(value: unknown, now: number): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return normalize(Object.fromEntries(value.map((v, i) => [String(i), v])), now);
  if (isObj(value)) {
    if (value['.sv'] === 'timestamp') return now;
    const out: Tree = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalize(v, now);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  return value;
}

function createServer() {
  let tree: Tree = {};
  let rev = 0;
  const touched = new Map<string, number>();
  const sessions = new Map<string, string>();
  let nextUid = 1;

  const server = {
    calls: [] as Call[],
    /** Serverns klocka = Date.now() + clockOffset. */
    clockOffset: 0,
    /** Sökvägar som ger permission_denied vid läsning. */
    denyRead: new Set<string>(),
    /** Neka skrivningar (403). */
    denyWrite: (_req: WriteRequest, _uid: string) => false,
    override: null as Override | null,
    /** Fördröjning (ms, falska timers) innan /api/read svarar. */
    readDelay: 0,
    /**
     * true: /api/read läser databasen när förfrågan kommer fram och svaret är sedan fördröjt (svaret kan
     * alltså vara inaktuellt när det når klienten). false: läser när fördröjningen är över.
     */
    readEarly: false,
    /** true: /api/read svarar 401 på en okänd token (i stället för att läsa som oinloggad). */
    strictReadAuth: false,
    /** Fördröjning (ms, falska timers) innan /api/session svarar. */
    sessionDelay: 0,
    readsInFlight: 0,
    maxReadsInFlight: 0,

    callsTo(endpoint: Endpoint) {
      return server.calls.filter((c) => c.endpoint === endpoint);
    },
    lastRead(): ReadRequest['reads'] {
      const reads = server.callsTo('read');
      return (reads[reads.length - 1].body as ReadRequest).reads;
    },
    now: () => Date.now() + server.clockOffset,
    get: (path: string): unknown => {
      let node: unknown = tree;
      for (const seg of splitPath(path)) node = isObj(node) ? node[seg] : undefined;
      return node === undefined ? null : structuredClone(node);
    },
    /** Skriver direkt i databasen (som om en annan klient hade skrivit). */
    put(path: string, value: unknown) {
      rev++;
      const segs = splitPath(path);
      const root: Tree = structuredClone(tree);
      let node = root;
      for (const seg of segs.slice(0, -1)) {
        if (!isObj(node[seg])) node[seg] = {};
        node = node[seg] as Tree;
      }
      if (!segs.length) tree = (normalize(value, server.now()) as Tree) ?? {};
      else {
        node[segs[segs.length - 1]] = value;
        tree = (normalize(root, server.now()) as Tree) ?? {};
      }
      touched.set(segs.join('/'), rev);
      return rev;
    },
    /** Höjer rev för en sökväg utan att ändra värdet. */
    touch(path: string) {
      rev++;
      touched.set(splitPath(path).join('/'), rev);
    },
    revOf(path: string) {
      const segs = splitPath(path);
      let max = 0;
      for (const [p, r] of touched) {
        const ps = splitPath(p);
        const n = Math.min(ps.length, segs.length);
        if (ps.slice(0, n).every((s, i) => s === segs[i])) max = Math.max(max, r);
      }
      return max;
    },
    reset() {
      tree = {};
      rev = 0;
      touched.clear();
      sessions.clear();
      nextUid = 1;
    },

    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
      const url = String(input);
      const endpoint = url.slice(url.lastIndexOf('/') + 1) as Endpoint;
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? null;
      server.calls.push({ endpoint, body, auth });

      if (endpoint === 'read') {
        server.readsInFlight++;
        server.maxReadsInFlight = Math.max(server.maxReadsInFlight, server.readsInFlight);
      }
      try {
        if (endpoint === 'read' && server.readEarly && !server.override) {
          const early = handle(endpoint, body, auth);
          if (server.readDelay) await new Promise((r) => setTimeout(r, server.readDelay));
          return early;
        }
        if (endpoint === 'read' && server.readDelay) await new Promise((r) => setTimeout(r, server.readDelay));
        if (endpoint === 'session' && server.sessionDelay) await new Promise((r) => setTimeout(r, server.sessionDelay));
        const o = server.override?.(endpoint, body);
        if (o === 'network') throw new TypeError('Failed to fetch');
        if (o === 'hang') return await new Promise<FakeResponse>(() => {});
        if (o) return o;
        return handle(endpoint, body, auth);
      } finally {
        if (endpoint === 'read') server.readsInFlight--;
      }
    }) as unknown as typeof fetch,
  };

  function handle(endpoint: Endpoint, body: unknown, auth: string | null): FakeResponse {
    if (endpoint === 'session') {
      const uid = `uid${nextUid++}`;
      const token = `token-${uid}`;
      sessions.set(token, uid);
      return json(200, { uid, token });
    }
    if (endpoint === 'read') {
      if (server.strictReadAuth && auth && !sessions.has(auth.replace(/^Bearer /, ''))) {
        return json(401, { error: 'unauthenticated', message: 'Unknown token' });
      }
      const results: ReadResult[] = (body as ReadRequest).reads.map(({ path, rev: known }) => {
        if (server.denyRead.has(path)) return { path, error: 'permission_denied' };
        const r = server.revOf(path);
        if (known === r) return { path, rev: r, unchanged: true };
        return { path, rev: r, value: server.get(path) };
      });
      return json(200, { results });
    }
    const uid = auth?.startsWith('Bearer ') ? sessions.get(auth.slice(7)) : undefined;
    if (!uid) return json(401, { error: 'unauthenticated', message: 'Unknown token' });
    const req = body as WriteRequest;
    if (server.denyWrite(req, uid)) return json(403, { error: 'permission_denied', message: 'Åtkomst nekad' });
    let r = rev;
    if (req.op === 'set') r = server.put(req.path, req.value);
    else if (req.op === 'remove') r = server.put(req.path, null);
    else for (const [k, v] of Object.entries(req.values)) r = server.put(joinPath(req.path, k), v);
    return json(200, { ok: true, rev: r });
  }

  function json(status: number, data: Tree): FakeResponse {
    const text = JSON.stringify({ ...data, now: server.now() });
    return { status, text: async () => text };
  }

  return server;
}

const raw = (status: number, text: string): FakeResponse => ({ status, text: async () => text });
const jsonResponse = (status: number, data: Tree): FakeResponse => raw(status, JSON.stringify({ now: Date.now(), ...data }));

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

/* ------------------------------------------------------------------ */
/*  Hjälpare                                                            */
/* ------------------------------------------------------------------ */

let server: ReturnType<typeof createServer>;
let storage: Storage;

function make(opts: HttpBackendOptions = {}): Backend {
  return createHttpBackend({ fetch: server.fetch, storage, ...opts });
}

/** Kör allt som ska hända "direkt" (0 ms-timers och mikrouppgifter), utan att flytta klockan. */
async function settle() {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Väntar in ett löfte medan 0 ms-timers körs (skrivningar väntar på en omedelbar pollning). */
async function drive<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 50 && !done; i++) await vi.advanceTimersByTimeAsync(0);
  return p;
}

async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await drive(p);
  } catch (err) {
    return err as Error;
  }
  throw new Error('löftet lyckades men skulle ha misslyckats');
}

function fakeDom() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  return {
    doc,
    win,
    setVisibility(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-21T20:00:00Z'));
  server = createServer();
  storage = memoryStorage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Session                                                             */
/* ------------------------------------------------------------------ */

describe('session', () => {
  it('skapar en session en gång, sparar den och delar löftet mellan samtidiga ready()', async () => {
    const b = make();
    expect(b.kind).toBe('server');
    expect(b.uid()).toBeNull();
    const [a, c] = await Promise.all([b.ready(), b.ready()]);
    expect(a).toBe('uid1');
    expect(c).toBe('uid1');
    expect(b.uid()).toBe('uid1');
    expect(server.callsTo('session')).toHaveLength(1);
    expect(JSON.parse(storage.getItem(SESSION_STORAGE_KEY)!)).toEqual({ uid: 'uid1', token: 'token-uid1' });
    expect(await b.ready()).toBe('uid1');
    expect(server.callsTo('session')).toHaveLength(1);
  });

  it('återanvänder den sparade sessionen (alla flikar i webbläsaren delar samma uid)', async () => {
    await make().ready();
    const otherTab = make();
    expect(await otherTab.ready()).toBe('uid1');
    expect(server.callsTo('session')).toHaveLength(1);
  });

  it('skapar en ny session om det sparade värdet är trasigt', async () => {
    storage.setItem(SESSION_STORAGE_KEY, '{trasig json');
    expect(await make().ready()).toBe('uid1');
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ uid: 'x' }));
    expect(await make().ready()).toBe('uid2');
  });

  it('försöker igen med backoff vid nätverksfel', async () => {
    let failures = 2;
    server.override = (endpoint) => (endpoint === 'session' && failures-- > 0 ? 'network' : undefined);
    const b = make();
    const p = b.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.callsTo('session')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.callsTo('session')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe('uid1');
    expect(server.callsTo('session')).toHaveLength(3);
  });

  it('ger upp efter några försök med ett svenskt felmeddelande, och nästa ready() försöker igen', async () => {
    server.override = (endpoint) => (endpoint === 'session' ? raw(502, '<html><body>Bad gateway</body></html>') : undefined);
    const b = make();
    const result = b.ready().then(
      () => new Error('ready() lyckades men skulle ha misslyckats'),
      (e: unknown) => e as Error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/Kunde inte ansluta till servern/);
    expect(server.callsTo('session')).toHaveLength(4);
    expect(b.uid()).toBeNull();

    server.override = null;
    expect(await b.ready()).toBe('uid1');
  });

  it('404 (inget API på adressen) försöks inte igen och nämner HTTP-statusen', async () => {
    server.override = (endpoint) => (endpoint === 'session' ? raw(404, 'Not Found') : undefined);
    const err = await caught(make().ready());
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/HTTP 404/);
    expect(server.callsTo('session')).toHaveLength(1);
  });

  it('ett 200-svar utan uid/token godtas inte som session', async () => {
    server.override = (endpoint) => (endpoint === 'session' ? jsonResponse(200, { uid: 'x' }) : undefined);
    const b = make();
    const err = await caught(b.ready());
    expect(err).toBeInstanceOf(ApiError);
    expect(b.uid()).toBeNull();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('en pollning som startar medan sessionen skapas väntar in den och läser som rätt användare', async () => {
    server.put('games/g1/meta/status', 'lobby');
    server.sessionDelay = 300;
    const b = make();
    const ready = b.ready();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    expect(server.calls.map((c) => c.endpoint)).toEqual(['session']);
    await vi.advanceTimersByTimeAsync(300);
    expect(await ready).toBe('uid1');
    expect(server.calls.map((c) => c.endpoint)).toEqual(['session', 'read']);
    expect(server.callsTo('read')[0].auth).toBe('Bearer token-uid1');
    expect(values).toEqual(['lobby']);
  });

  it('503 no_database: avvisar direkt med serverns meddelande', async () => {
    server.override = () => jsonResponse(503, { error: 'no_database', message: 'Ingen databas är kopplad.' });
    const err = await caught(make().ready());
    expect(err.message).toBe('Ingen databas är kopplad.');
    expect(isNoDatabaseError(err)).toBe(true);
    expect(isNoDatabaseError(new Error('annat'))).toBe(false);
    expect(server.callsTo('session')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Prenumerationer & get                                               */
/* ------------------------------------------------------------------ */

describe('prenumerationer', () => {
  beforeEach(() => {
    server.put('games/g1/meta', { name: 'Kväll', status: 'lobby' });
    server.put('games/g1/players/p1', { name: 'Alva' });
    server.put('hallOfFame/g0', { name: 'Förra' });
  });

  it('levererar första värdet asynkront och samlar allt i samma tick i ETT anrop', async () => {
    const b = make();
    await b.ready();
    const seen: string[] = [];
    const meta1: unknown[] = [];
    const meta2: unknown[] = [];
    b.subscribe('games/g1/meta', (v) => {
      meta1.push(v);
      seen.push('meta1');
    });
    b.subscribe('/games/g1/meta/', (v) => meta2.push(v)); // samma sökväg (normaliseras)
    b.subscribe('games/g1/players', () => seen.push('players'));
    b.subscribe('hallOfFame', () => seen.push('hof'));
    const got = b.get('pins/123456');
    expect(seen).toEqual([]); // aldrig synkront
    await settle();

    expect(server.callsTo('read')).toHaveLength(1);
    expect(server.lastRead().map((r) => r.path)).toEqual(['games/g1/meta', 'games/g1/players', 'hallOfFame', 'pins/123456']);
    expect(server.lastRead().every((r) => r.rev === undefined)).toBe(true);
    expect(await got).toBeNull();
    expect(seen.sort()).toEqual(['hof', 'meta1', 'players']);
    expect(meta1).toEqual([{ name: 'Kväll', status: 'lobby' }]);
    expect(meta2).toEqual(meta1);
    expect(meta1[0]).not.toBe(meta2[0]); // varje prenumerant får en egen kopia
    expect(server.callsTo('read')[0].auth).toBe('Bearer token-uid1');
  });

  it('pollar med senast kända rev och anropar bara cb när värdet ändrats', async () => {
    const b = make();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    expect(values).toEqual(['lobby']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(2);
    expect(server.lastRead()).toEqual([{ path: 'games/g1/meta/status', rev: server.revOf('games/g1/meta/status') }]);
    expect(values).toEqual(['lobby']); // oförändrad rev → ingen cb

    server.touch('games/g1/meta'); // ny rev men samma värde
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(3);
    expect(values).toEqual(['lobby']);

    server.put('games/g1/meta/status', 'running');
    await vi.advanceTimersByTimeAsync(1000);
    expect(values).toEqual(['lobby', 'running']);

    server.put('games/g1/meta/status', null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(values).toEqual(['lobby', 'running', null]);
  });

  it('jämför värden djupt (nyckelordningen spelar ingen roll)', async () => {
    const b = make();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta', (v) => values.push(v));
    await settle();
    server.put('games/g1/meta', { status: 'lobby', name: 'Kväll' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(values).toHaveLength(1);
  });

  it('en ny prenumerant på en bevakad sökväg får värdet direkt utan nytt anrop', async () => {
    const b = make();
    b.subscribe('games/g1/meta', () => {});
    await settle();
    const late: unknown[] = [];
    b.subscribe('games/g1/meta', (v) => late.push(v));
    expect(late).toEqual([]);
    await Promise.resolve();
    expect(late).toEqual([{ name: 'Kväll', status: 'lobby' }]);
    await settle();
    expect(server.callsTo('read')).toHaveLength(1);
  });

  it('slutar polla när ingen prenumererar, och avregistrering är idempotent', async () => {
    const b = make();
    const un1 = b.subscribe('games/g1/meta', () => {});
    const un2 = b.subscribe('hallOfFame', () => {});
    await settle();
    un1();
    un1();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(2);
    expect(server.lastRead().map((r) => r.path)).toEqual(['hallOfFame']);
    un2();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.callsTo('read')).toHaveLength(2);
  });

  it('permission_denied: onError för den sökvägen, övriga prenumerationer fortsätter', async () => {
    server.denyRead.add('adminSessions/uid1');
    const b = make();
    await b.ready();
    const errors: Error[] = [];
    const values: unknown[] = [];
    const deniedValues: unknown[] = [];
    b.subscribe('adminSessions/uid1', (v) => deniedValues.push(v), (err) => errors.push(err));
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(PermissionDeniedError);
    expect(isPermissionDenied(errors[0])).toBe(true);
    expect(deniedValues).toEqual([]);
    expect(values).toEqual(['lobby']);

    server.put('games/g1/meta/status', 'running');
    await vi.advanceTimersByTimeAsync(1000);
    expect(values).toEqual(['lobby', 'running']);
    expect(server.lastRead().map((r) => r.path)).toEqual(['games/g1/meta/status']);
  });

  it('get(): värde, null och PermissionDeniedError', async () => {
    server.denyRead.add('secret');
    const b = make();
    expect(await drive(b.get('games/g1/players/p1/name'))).toBe('Alva');
    expect(await drive(b.get('games/nope'))).toBeNull();
    const err = await caught(b.get('secret'));
    expect(err).toBeInstanceOf(PermissionDeniedError);
    // Utan prenumerationer pollas inget efteråt.
    const before = server.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.calls.length).toBe(before);
  });

  it('get() väntar inte på en pågående pollning', async () => {
    server.readDelay = 400;
    const b = make();
    b.subscribe('games/g1/meta', () => {});
    await settle();
    expect(server.readsInFlight).toBe(1);
    const p = b.get('hallOfFame/g0/name');
    await settle();
    expect(server.callsTo('read')).toHaveLength(2);
    expect(server.lastRead()).toEqual([{ path: 'hallOfFame/g0/name' }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toBe('Förra');
  });

  it('kör aldrig två pollningar samtidigt, men en till direkt efter den pågående', async () => {
    fakeDom();
    server.readDelay = 500;
    const b = make();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    expect(server.readsInFlight).toBe(1);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    b.subscribe('hallOfFame', () => {});
    await settle();
    expect(server.callsTo('read')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500); // första klar → nästa startar direkt
    expect(values).toEqual(['lobby']);
    expect(server.callsTo('read')).toHaveLength(2);
    expect(server.lastRead().map((r) => r.path)).toEqual(['games/g1/meta/status', 'hallOfFame']);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.callsTo('read')).toHaveLength(2); // inga fler omedelbara – nästa om en sekund
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(3);
    expect(server.maxReadsInFlight).toBe(1);
  });

  it('trasiga svar (HTML, fel antal resultat) ger inga konstiga värden och polling återhämtar sig', async () => {
    const b = make();
    const values: unknown[] = [];
    const conn: boolean[] = [];
    b.onConnection((c) => conn.push(c));
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    let mode: 'html' | 'count' | 'ok' = 'html';
    server.override = (endpoint) => {
      if (endpoint !== 'read' || mode === 'ok') return undefined;
      return mode === 'html' ? raw(200, '<!doctype html><title>Vercel</title>') : jsonResponse(200, { results: [] });
    };
    await settle();
    expect(values).toEqual([]);
    expect(conn).toEqual([true, false]);

    mode = 'count';
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(2);
    expect(values).toEqual([]);

    mode = 'ok';
    await vi.advanceTimersByTimeAsync(2000);
    expect(values).toEqual(['lobby']);
    expect(conn).toEqual([true, false, true]);
  });

  it('en pollning som hänger avbryts efter en stund och pollningen fortsätter', async () => {
    const b = make();
    const values: unknown[] = [];
    let hang = true;
    server.override = (endpoint) => (endpoint === 'read' && hang ? 'hang' : undefined);
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    hang = false;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(server.callsTo('read')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1000);
    expect(server.callsTo('read')).toHaveLength(2);
    expect(values).toEqual(['lobby']);
  });
});

/* ------------------------------------------------------------------ */
/*  Synlighet                                                           */
/* ------------------------------------------------------------------ */

describe('synlighet och fokus', () => {
  it('pollar var 5:e sekund när fliken är dold och direkt när den syns igen', async () => {
    const dom = fakeDom();
    const b = make();
    b.subscribe('games', () => {});
    await settle();
    expect(server.callsTo('read')).toHaveLength(1);

    dom.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(1000); // redan planerad med det vanliga intervallet
    expect(server.callsTo('read')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.callsTo('read')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(3);

    dom.setVisibility('visible');
    await settle();
    expect(server.callsTo('read')).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')).toHaveLength(5);
  });

  it('pollar direkt vid focus och online', async () => {
    const dom = fakeDom();
    const b = make();
    b.subscribe('games', () => {});
    await settle();
    dom.win.dispatchEvent(new Event('focus'));
    await settle();
    expect(server.callsTo('read')).toHaveLength(2);
    dom.win.dispatchEvent(new Event('online'));
    await settle();
    expect(server.callsTo('read')).toHaveLength(3);
  });

  it('respekterar egna intervall', async () => {
    const dom = fakeDom();
    const b = make({ pollMs: 250, hiddenPollMs: 2000 });
    b.subscribe('games', () => {});
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(server.callsTo('read')).toHaveLength(2);
    dom.setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(250 + 1999);
    expect(server.callsTo('read')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.callsTo('read')).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/*  Skrivningar                                                         */
/* ------------------------------------------------------------------ */

describe('skrivningar', () => {
  beforeEach(() => {
    server.put('games/g1/meta', { name: 'Kväll', status: 'lobby' });
  });

  it('skickar token och rensat värde, och prenumeranterna ser skrivningen innan löftet löses', async () => {
    const b = make();
    const events: string[] = [];
    b.subscribe<string>('games/g1/meta/status', (v) => events.push(`värde:${v}`));
    await settle();
    const p = b.set('games/g1/meta/status', 'running').then(() => events.push('klar'));
    await drive(p);
    expect(events).toEqual(['värde:lobby', 'värde:running', 'klar']);

    const write = server.callsTo('write')[0];
    expect(write.auth).toBe('Bearer token-uid1');
    expect(write.body).toEqual({ op: 'set', path: 'games/g1/meta/status', value: 'running' });
    // Ordningen: skrivning, sedan en omedelbar läsning med rev (utan att vänta på intervallet).
    expect(server.calls.map((c) => c.endpoint)).toEqual(['read', 'session', 'write', 'read']);
  });

  it('väntar in en pågående pollning och kör en ny innan skrivningen räknas som klar', async () => {
    server.readDelay = 300;
    server.readEarly = true; // den pågående pollningen läste databasen före skrivningen
    const b = make();
    await b.ready();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle(); // första pollningen pågår
    let done = false;
    const p = b.set('games/g1/meta/status', 'running').then(() => (done = true));
    await settle();
    expect(server.callsTo('write')).toHaveLength(1);
    expect(server.callsTo('read')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300); // den gamla pollningen (från före skrivningen) blir klar
    expect(values).toEqual(['lobby']);
    expect(done).toBe(false);
    expect(server.calls.map((c) => c.endpoint)).toEqual(['session', 'read', 'write', 'read']); // ny pollning direkt
    await vi.advanceTimersByTimeAsync(300); // den nya pollningen
    await p;
    expect(values).toEqual(['lobby', 'running']);
    expect(server.maxReadsInFlight).toBe(1);
  });

  it('update/remove, stripUndefined och servertid', async () => {
    const b = make();
    expect(b.serverTime()).toEqual({ '.sv': 'timestamp' });
    await drive(b.update('games/g1', { 'meta/status': 'running', 'meta/startedAt': b.serverTime(), skip: undefined, current: { index: 0, x: undefined } }));
    expect(server.callsTo('write')[0].body).toEqual({
      op: 'update',
      path: 'games/g1',
      values: { 'meta/status': 'running', 'meta/startedAt': { '.sv': 'timestamp' }, current: { index: 0 } },
    });
    expect(server.get('games/g1/meta/startedAt')).toBe(server.now());
    await drive(b.set('games/g1/lottery', undefined));
    expect(server.callsTo('write')[1].body).toEqual({ op: 'set', path: 'games/g1/lottery', value: null });
    await drive(b.remove('/games/g1/'));
    expect(server.callsTo('write')[2].body).toEqual({ op: 'remove', path: 'games/g1' });
    expect(server.get('games/g1')).toBeNull();
  });

  it('403 → PermissionDeniedError', async () => {
    server.denyWrite = () => true;
    const err = await caught(make().set('games/g1/meta/status', 'running'));
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(isPermissionDenied(err)).toBe(true);
  });

  it('401 → svenskt fel, ingen ny session (samma uid), och den sparade sessionen glöms till nästa sidladdning', async () => {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ uid: 'gammal', token: 'okänd' }));
    const b = make();
    expect(await b.ready()).toBe('gammal');
    const err = await caught(b.set('games/g1/players/gammal/name', 'Alva'));
    expect(err).not.toBeInstanceOf(PermissionDeniedError);
    expect(isPermissionDenied(err)).toBe(false);
    expect(err.message).toMatch(/ladda om sidan/);
    expect(server.callsTo('session')).toHaveLength(0);
    expect(b.uid()).toBe('gammal');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('401 vid läsning: läser vidare som oinloggad, samma uid, och skrivningar ber om omladdning', async () => {
    server.strictReadAuth = true;
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ uid: 'gammal', token: 'okänd' }));
    const b = make();
    await b.ready();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    expect(server.callsTo('read')[0].auth).toBe('Bearer okänd');
    expect(values).toEqual([]);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(server.callsTo('read')[1].auth).toBeNull();
    expect(values).toEqual(['lobby']);
    expect(b.uid()).toBe('gammal');
    const err = await caught(b.set('games/g1/players/gammal/name', 'Alva'));
    expect(err.message).toMatch(/ladda om sidan/);
    expect(server.callsTo('session')).toHaveLength(0);
  });

  it('403 utan känd felkod räknas ändå som PermissionDeniedError', async () => {
    const b = make();
    await b.ready();
    server.override = (endpoint) => (endpoint === 'write' ? jsonResponse(403, { error: 'forbidden' }) : undefined);
    expect(await caught(b.set('a/b', 1))).toBeInstanceOf(PermissionDeniedError);
    server.override = (endpoint) => (endpoint === 'write' ? raw(403, 'Forbidden') : undefined);
    expect(await caught(b.set('a/b', 1))).toBeInstanceOf(PermissionDeniedError);
  });

  it('skrivningen räknas som klar även om pollningen efteråt misslyckas', async () => {
    const b = make();
    const values: unknown[] = [];
    b.subscribe('games/g1/meta/status', (v) => values.push(v));
    await settle();
    server.override = (endpoint) => (endpoint === 'read' ? 'network' : undefined);
    await drive(b.set('games/g1/meta/status', 'running'));
    expect(server.calls.map((c) => c.endpoint)).toEqual(['read', 'session', 'write', 'read']);
    expect(values).toEqual(['lobby']);
    server.override = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(values).toEqual(['lobby', 'running']);
  });

  it('429, nätverksfel, serverfel och HTML-felsidor ger begripliga fel', async () => {
    const b = make();
    await b.ready();
    let response: FakeResponse | 'network' = jsonResponse(429, { error: 'rate_limited', message: 'Too many requests' });
    server.override = (endpoint) => (endpoint === 'write' ? response : undefined);

    let err = await caught(b.set('a/b', 1));
    expect(err.message).toBe('För många försök – vänta en stund och försök igen');
    expect(isPermissionDenied(err)).toBe(false);

    response = raw(429, 'Too Many Requests'); // Vercels egen begränsning (inte JSON)
    err = await caught(b.set('a/b', 1));
    expect(err.message).toBe('För många försök – vänta en stund och försök igen');

    response = 'network';
    err = await caught(b.set('a/b', 1));
    expect(err.message).toMatch(/Ingen kontakt med servern/);
    expect((err as ApiError).code).toBe('network');

    response = jsonResponse(500, { error: 'server_error', message: 'Databasen svarar inte' });
    err = await caught(b.set('a/b', 1));
    expect(err.message).toBe('Databasen svarar inte');

    response = jsonResponse(413, { error: 'too_large' });
    err = await caught(b.set('a/b', 1));
    expect(err.message).toBe('Det du försökte spara är för stort');

    response = raw(504, '<html>An error occurred with your deployment</html>');
    err = await caught(b.set('a/b', 1));
    expect(err.message).toMatch(/svarade inte som väntat.*504/);
    expect((err as ApiError).code).toBe('bad_response');
  });
});

/* ------------------------------------------------------------------ */
/*  Anslutning, tid och nycklar                                         */
/* ------------------------------------------------------------------ */

describe('anslutning', () => {
  it('rapporterar bara ändringar: nätverksfel → false, nästa lyckade anrop → true', async () => {
    const b = make();
    const states: boolean[] = [];
    const unsub = b.onConnection((c) => states.push(c));
    await settle();
    expect(states).toEqual([true]);

    server.override = () => 'network';
    b.subscribe('games', () => {});
    await settle();
    expect(states).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(1000); // misslyckas igen – ingen ny cb
    expect(states).toEqual([true, false]);

    server.override = null;
    await vi.advanceTimersByTimeAsync(2000); // backoff: 1 s, 2 s …
    expect(states).toEqual([true, false, true]);

    unsub();
    server.override = () => 'network';
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([true, false, true]);
  });

  it('ett 4xx-svar från servern betyder att vi är anslutna', async () => {
    const b = make();
    const states: boolean[] = [];
    b.onConnection((c) => states.push(c));
    server.denyWrite = () => true;
    await caught(b.set('x', 1));
    await settle();
    expect(states).toEqual([true]);
    // Även Vercels egen 429-spärr (utan JSON) är ett svar.
    server.override = (endpoint) => (endpoint === 'write' ? raw(429, 'Too Many Requests') : undefined);
    await caught(b.set('x', 1));
    expect(states).toEqual([true]);
    // … men ett 5xx-svar är det inte.
    server.override = (endpoint) => (endpoint === 'write' ? jsonResponse(500, { error: 'server_error' }) : undefined);
    await caught(b.set('x', 1));
    expect(states).toEqual([true, false]);
  });
});

describe('servertid', () => {
  it('räknar ut skillnaden mot serverns klocka (mitt i förfrågan) och föredrar snabba svar', async () => {
    server.clockOffset = 5000;
    server.readDelay = 400;
    const b = make();
    expect(b.now()).toBe(Date.now());
    b.subscribe('games', () => {});
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    // Servern svarade efter 400 ms: tiden mäts mot mitten av förfrågan.
    expect(b.now() - Date.now()).toBe(5200);

    server.readDelay = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.now() - Date.now()).toBe(5000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(b.now() - Date.now()).toBe(5000);
  });

  it('jämnar ut mätningar med ungefär samma svarstid', async () => {
    server.clockOffset = 5000;
    server.readDelay = 20;
    const b = make();
    b.subscribe('games', () => {});
    await settle();
    await vi.advanceTimersByTimeAsync(20); // svarstid 20 ms → 5000 + 10
    expect(b.now() - Date.now()).toBe(5010);
    server.readDelay = 0;
    await vi.advanceTimersByTimeAsync(1000); // svarstid 0 → 5000; båda räknas
    expect(b.now() - Date.now()).toBe(5005);
    server.readDelay = 500;
    await vi.advanceTimersByTimeAsync(1000 + 500); // långsamt svar → räknas inte
    expect(b.now() - Date.now()).toBe(5005);
  });

  it('följer med när klockan hoppar', async () => {
    server.clockOffset = -3000;
    const b = make();
    await b.ready();
    expect(b.now() - Date.now()).toBe(-3000);
    server.clockOffset = 60_000;
    await drive(b.get('x'));
    expect(b.now() - Date.now()).toBe(60_000);
  });
});

describe('pushKey', () => {
  const decodeTime = (key: string) => {
    const chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    return [...key.slice(0, 8)].reduce((t, c) => t * 64 + chars.indexOf(c), 0);
  };

  it('20 giltiga tecken, unika och kronologiskt sorterbara även inom samma millisekund', async () => {
    const b = make();
    const keys: string[] = [];
    for (let i = 0; i < 2000; i++) keys.push(b.pushKey());
    vi.advanceTimersByTime(1);
    keys.push(b.pushKey());
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 50; i++) keys.push(b.pushKey());

    for (const k of keys) {
      expect(k).toHaveLength(20);
      expect(isValidKey(k)).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
    expect(decodeTime(keys[keys.length - 1])).toBe(Date.now());
  });

  it('använder servertid och backar aldrig även om klockan justeras bakåt', async () => {
    server.clockOffset = 10_000;
    const b = make();
    await b.ready();
    const k1 = b.pushKey();
    expect(decodeTime(k1)).toBe(Date.now() + 10_000);
    server.clockOffset = 0; // servertiden "hoppar" bakåt
    await drive(b.get('x'));
    const k2 = b.pushKey();
    expect(k2 > k1).toBe(true);
  });
});
