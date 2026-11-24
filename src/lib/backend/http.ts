import {
  API_BASE,
  SERVER_TIME,
  type ApiErrorCode,
  type ReadRequest,
  type ReadResponse,
  type SessionResponse,
  type WriteRequest,
  type WriteResponse,
} from './protocol';
import { PermissionDeniedError, splitPath, stripUndefined, type Backend, type Unsubscribe } from './types';

/**
 * Databaslagret mot vår egen server (Vercel Functions i api/ → Postgres). Protokollet: protocol.ts.
 *
 *  - Identitet: POST /api/session ger ett anonymt { uid, token } som sparas i localStorage och delas av
 *    alla flikar i webbläsaren (som en anonym inloggning). Token skickas som `Authorization: Bearer …`.
 *  - Realtid: alla prenumerationer hämtas tillsammans i ETT POST /api/read ungefär varje sekund (var
 *    5:e sekund när fliken är dold) med senast kända rev, så att servern bara skickar det som ändrats.
 *    Två pollningar körs aldrig samtidigt, och pollningen stannar när ingen prenumererar.
 *  - Skrivningar: POST /api/write. När en skrivning har lyckats hämtas alla prenumerationer direkt och
 *    löftet löses först därefter – vyerna ser alltså sin egen skrivning när `await` är klar.
 *  - Servertid: varje svar innehåller serverns klocka (`now`); skillnaden mot den lokala klockan jämnas ut.
 */

export interface HttpBackendOptions {
  /** Bas-URL för API:t. Default '/api'. */
  baseUrl?: string;
  /** fetch-implementation (för tester). Default: webbläsarens fetch. */
  fetch?: typeof fetch;
  /** Var sessionen sparas. Default: localStorage (om den går att använda). */
  storage?: Storage;
  /** Pollintervall i ms när fliken syns. Default 1000. */
  pollMs?: number;
  /** Pollintervall i ms när fliken är dold. Default 5000. */
  hiddenPollMs?: number;
}

/** Fel från API:t. `code` är serverns felkod, eller 'network' (inget svar) / 'bad_response' (inte vårt API). */
export type ApiFailure = ApiErrorCode | 'network' | 'bad_response';

export class ApiError extends Error {
  readonly code: ApiFailure;
  /** HTTP-status (0 = inget svar). */
  readonly status: number;
  constructor(message: string, code: ApiFailure, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** true om felet betyder att ingen databas är kopplad till projektet på Vercel. */
export function isNoDatabaseError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'no_database';
}

/** Nyckeln i localStorage där sessionen sparas (delas av alla flikar). */
export const SESSION_STORAGE_KEY = 'bonjour-babes:session';

const MSG = {
  network: 'Ingen kontakt med servern – kontrollera internetanslutningen och försök igen',
  connectFailed: 'Kunde inte ansluta till servern. Kontrollera internetanslutningen och försök igen.',
  badResponse: 'Servern svarade inte som väntat – försök igen om en stund',
  rateLimited: 'För många försök – vänta en stund och försök igen',
  unauthenticated: 'Servern känner inte längre igen den här enheten – ladda om sidan och försök igen',
  noDatabase: 'Ingen databas är kopplad till appen ännu.',
  tooLarge: 'Det du försökte spara är för stort',
  badRequest: 'Ogiltig förfrågan till servern',
  serverError: 'Något gick fel på servern – försök igen',
} as const;

const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 15_000;
const SESSION_TIMEOUT_MS = 10_000;
/** Väntetider mellan försöken att skapa en session (alltså 4 försök totalt). */
const SESSION_RETRY_DELAYS_MS = [500, 1500, 3500];
/** Längsta väntan mellan pollningar när servern inte svarar (om pollintervallet inte är längre). */
const MAX_BACKOFF_MS = 5000;
/** Antal tidsmätningar som sparas för att räkna ut skillnaden mot serverns klocka. */
const TIME_SAMPLES = 12;
/** Mätningar vars svarstid är högst så här mycket längre än den snabbaste räknas med i medelvärdet. */
const RTT_TOLERANCE_MS = 30;
/** Högst så många (av de snabbaste) mätningarna räknas med i medelvärdet. */
const TIME_SAMPLES_USED = 5;

interface Session {
  uid: string;
  token: string;
}

interface Subscriber {
  cb: (value: unknown) => void;
  onError?: (err: Error) => void;
  /** Har fått sitt första värde. */
  delivered: boolean;
}

/** En bevakad sökväg. Alla prenumeranter på samma sökväg delar en bevakning (och en rad i /api/read). */
interface Watch {
  path: string;
  subs: Set<Subscriber>;
  /** Senast kända rev från servern (undefined = inget värde hämtat än). */
  rev?: number;
  /** Senast levererade värde – en privat kopia som aldrig lämnas ut. */
  value: unknown;
  hasValue: boolean;
}

interface PendingGet {
  path: string;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

type ReadEntry = ReadRequest['reads'][number];

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/** Ska ett misslyckat försök att skapa en session göras om? (Inte vid t.ex. 404: då saknas API:t.) */
function isRetryableSessionError(err: ApiError): boolean {
  if (err.code === 'network' || err.code === 'server_error' || err.code === 'rate_limited') return true;
  return err.code === 'bad_response' && (err.status === 0 || err.status >= 500);
}

/* ------------------------------------------------------------------ */
/*  Hjälpfunktioner                                                     */
/* ------------------------------------------------------------------ */

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizePath(path: string): string {
  return splitPath(path).join('/');
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && deepEqual(ra[k], rb[k]));
}

/** Värdena kommer från JSON, så en JSON-kopia räcker. Varje prenumerant får en egen kopia. */
function clone<T>(value: T): T {
  return value === null || typeof value !== 'object' ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined; // t.ex. blockerade cookies – sessionen lever då bara i minnet
  }
}

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* privat läge e.d. – kör vidare i minnet */
  }
}

function safeRemove(storage: Storage | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    /* ignorera */
  }
}

function codeFromStatus(status: number): ApiFailure {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'permission_denied';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'server_error' : 'bad_response';
}

function defaultMessage(code: ApiFailure): string {
  switch (code) {
    case 'network':
      return MSG.network;
    case 'rate_limited':
      return MSG.rateLimited;
    case 'unauthenticated':
      return MSG.unauthenticated;
    case 'no_database':
      return MSG.noDatabase;
    case 'too_large':
      return MSG.tooLarge;
    case 'bad_request':
      return MSG.badRequest;
    case 'server_error':
      return MSG.serverError;
    default:
      return MSG.badResponse;
  }
}

function readResultError(code: unknown, path: string): Error {
  if (code === 'permission_denied') return new PermissionDeniedError('permission_denied');
  if (code === 'bad_request') return new ApiError(`Ogiltig sökväg: "${path}"`, 'bad_request', 400);
  return new ApiError(MSG.badResponse, 'bad_response', 200);
}

/* ------------------------------------------------------------------ */
/*  Backenden                                                           */
/* ------------------------------------------------------------------ */

export function createHttpBackend(opts: HttpBackendOptions = {}): Backend {
  const baseUrl = (opts.baseUrl ?? API_BASE).replace(/\/+$/, '');
  // Anropas via globalThis vid varje anrop: window.fetch får inte lossas från window ("Illegal invocation").
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const storage = opts.storage ?? defaultStorage();
  const pollMs = opts.pollMs ?? 1000;
  const hiddenPollMs = opts.hiddenPollMs ?? 5000;

  /* ---------------- Servertid ---------------- */

  const timeSamples: { offset: number; rtt: number }[] = [];
  let serverOffset = 0;

  /**
   * Skillnaden mot serverns klocka, mätt mot mitten av förfrågan. Felet i en mätning är högst halva
   * svarstiden, så de snabbaste svaren gäller: medelvärdet tas bara av mätningarna vars svarstid ligger
   * nära den snabbaste (det jämnar ut skakningar utan att långsamma svar drar iväg tiden).
   */
  const recordServerTime = (now: unknown, t0: number, t1: number) => {
    if (typeof now !== 'number' || !Number.isFinite(now)) return;
    const rtt = Math.max(0, t1 - t0);
    const offset = now - (t0 + t1) / 2;
    // Hoppade någon av klockorna (t.ex. ändrad tid i mobilen)? Släng då de gamla mätningarna.
    if (timeSamples.length && Math.abs(offset - serverOffset) > rtt / 2 + 2000) timeSamples.length = 0;
    timeSamples.push({ offset, rtt });
    if (timeSamples.length > TIME_SAMPLES) timeSamples.shift();
    const minRtt = Math.min(...timeSamples.map((s) => s.rtt));
    const best = timeSamples
      .filter((s) => s.rtt <= minRtt + RTT_TOLERANCE_MS)
      .sort((a, b) => a.rtt - b.rtt)
      .slice(0, TIME_SAMPLES_USED);
    serverOffset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
  };

  const now = () => Date.now() + serverOffset;

  /* ---------------- Anslutning ---------------- */

  let connected = true;
  const connectionListeners = new Set<(connected: boolean) => void>();

  const setConnected = (value: boolean) => {
    if (value === connected) return;
    connected = value;
    for (const cb of [...connectionListeners]) {
      try {
        cb(value);
      } catch (err) {
        console.error(err);
      }
    }
  };

  /* ---------------- HTTP ---------------- */

  /**
   * Ett anrop till API:t. Kastar ApiError (eller PermissionDeniedError vid 403) med ett svenskt meddelande.
   * Nätverksfel, 5xx och svar som inte är vårt API (t.ex. en HTML-felsida, eller ett svar som inte
   * klarar `valid`) räknas som "ingen anslutning"; ett 4xx-svar från API:t betyder att vi är anslutna.
   */
  async function call<T>(
    endpoint: 'session' | 'read' | 'write',
    body: unknown,
    token: string | null,
    timeoutMs: number,
    valid: (data: Record<string, unknown>) => boolean = () => true,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
    const t0 = Date.now();
    let status: number;
    let text: string;
    let t1: number;
    try {
      ({ status, text, t1 } = await new Promise<{ status: number; text: string; t1: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
          ctrl?.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
        void (async () => {
          const res = await doFetch(`${baseUrl}/${endpoint}`, {
            method: 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctrl?.signal,
          });
          const received = Date.now();
          return { status: res.status, text: await res.text(), t1: received };
        })().then(
          (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      }));
    } catch {
      setConnected(false);
      throw new ApiError(MSG.network, 'network', 0);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const obj = isObject(data) ? data : null;
    if (obj) recordServerTime(obj.now, t0, t1);

    if (status >= 200 && status < 300) {
      if (obj && valid(obj)) {
        setConnected(true);
        return obj as T;
      }
      setConnected(false);
      throw new ApiError(MSG.badResponse, 'bad_response', status);
    }

    let code: ApiFailure;
    if (obj) code = typeof obj.error === 'string' ? (obj.error as ApiFailure) : codeFromStatus(status);
    else code = status === 429 ? 'rate_limited' : 'bad_response'; // t.ex. en HTML-felsida från Vercel
    // 429 kan komma från Vercels egen spärr (utan JSON) – servern svarade ändå.
    setConnected(status === 429 || (!!obj && status < 500));

    if (code === 'permission_denied') throw new PermissionDeniedError('permission_denied');
    const serverMessage = obj && typeof obj.message === 'string' && obj.message.trim() ? obj.message : null;
    let message: string;
    if (code === 'rate_limited' || code === 'unauthenticated') message = defaultMessage(code);
    else if (code === 'bad_response') message = status ? `${MSG.badResponse} (HTTP ${status})` : MSG.badResponse;
    else message = serverMessage ?? defaultMessage(code);
    throw new ApiError(message, code, status);
  }

  /* ---------------- Session ---------------- */

  let session: Session | null = null;
  let sessionPromise: Promise<Session> | null = null;

  const loadStoredSession = (): Session | null => {
    const raw = safeGet(storage, SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Partial<Session> | null;
      if (s && typeof s.uid === 'string' && s.uid && typeof s.token === 'string' && s.token) return { uid: s.uid, token: s.token };
    } catch {
      /* trasigt värde – skapa en ny session */
    }
    return null;
  };

  const isValidSession = (r: Record<string, unknown>) =>
    typeof r.uid === 'string' && r.uid.length > 0 && typeof r.token === 'string' && r.token.length > 0;

  async function createSession(): Promise<Session> {
    for (let attempt = 0; ; attempt++) {
      // En annan flik kan ha hunnit skapa en session (alla flikar delar samma).
      const stored = loadStoredSession();
      if (stored) return stored;
      try {
        const res = await call<SessionResponse>('session', undefined, null, SESSION_TIMEOUT_MS, isValidSession);
        const raced = loadStoredSession();
        if (raced) return raced;
        const fresh: Session = { uid: res.uid, token: res.token };
        safeSet(storage, SESSION_STORAGE_KEY, JSON.stringify(fresh));
        return fresh;
      } catch (err) {
        if (!(err instanceof ApiError) || !isRetryableSessionError(err)) throw err;
        if (attempt >= SESSION_RETRY_DELAYS_MS.length) {
          if (err.code === 'network' || err.code === 'bad_response') {
            throw new ApiError(err.status ? `${MSG.connectFailed} (HTTP ${err.status})` : MSG.connectFailed, err.code, err.status);
          }
          throw err;
        }
        await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  /**
   * Servern känner inte igen vår token (401). Byt INTE identitet mitt i spelet (spelaren skulle tappa sin
   * plats). Läs i stället vidare som oinloggad, och glöm den sparade sessionen så att nästa sidladdning
   * får en ny som fungerar. Skrivningar ger under tiden ett fel som ber användaren ladda om sidan.
   */
  let tokenRejected = false;
  const rejectToken = (token: string) => {
    if (session?.token !== token) return;
    tokenRejected = true;
    if (loadStoredSession()?.token === token) safeRemove(storage, SESSION_STORAGE_KEY);
  };

  function getSession(): Promise<Session> {
    if (session) return Promise.resolve(session);
    if (!sessionPromise) {
      sessionPromise = createSession().then(
        (s) => {
          session = s;
          return s;
        },
        (err: unknown) => {
          sessionPromise = null; // nästa ready() försöker igen
          throw err;
        },
      );
    }
    return sessionPromise;
  }

  /* ---------------- Läsningar & pollning ---------------- */

  const watches = new Map<string, Watch>();
  let getQueue: PendingGet[] = [];
  let getTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollDue = Infinity;
  let polling = false;
  /** En ny pollning begärdes medan en pågick – kör en till direkt efteråt. */
  let pollAgain = false;
  /** En pollning är redan beställd till nästa mikrouppgift (se pollSoon). */
  let pollQueued = false;
  /** Skrivningar som väntar på nästa pollning som STARTAR efter att de lades till. */
  let waiters: (() => void)[] = [];
  let failures = 0;

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const nextDelay = () => {
    const base = isHidden() ? hiddenPollMs : pollMs;
    return failures ? Math.min(base * 2 ** (failures - 1), Math.max(base, MAX_BACKOFF_MS)) : base;
  };

  const clearPollTimer = () => {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    pollDue = Infinity;
  };

  /** Se till att en pollning körs om `delay` ms (eller tidigare, om en redan är planerad). */
  function schedule(delay: number) {
    if (polling) {
      if (delay <= 0) pollAgain = true;
      return; // nästa pollning planeras när den pågående är klar
    }
    if (!watches.size && !waiters.length && !getQueue.length) {
      clearPollTimer();
      return;
    }
    const due = Date.now() + delay;
    if (pollTimer !== null && pollDue <= due) return;
    clearPollTimer();
    pollDue = due;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollDue = Infinity;
      void poll();
    }, delay);
  }

  /**
   * Pollar direkt (i nästa mikrouppgift, utan att vänta på en timer) – eller, om en pollning pågår,
   * direkt efter den. Används när någon väntar på svaret: skrivningar (refresh) och get().
   */
  function pollSoon() {
    if (polling) {
      pollAgain = true;
      return;
    }
    if (pollQueued) return;
    pollQueued = true;
    queueMicrotask(() => {
      pollQueued = false;
      void poll();
    });
  }

  async function read(reads: ReadEntry[]): Promise<ReadResponse> {
    const token = session && !tokenRejected ? session.token : null;
    try {
      return await call<ReadResponse>(
        'read',
        { reads },
        token,
        READ_TIMEOUT_MS,
        (r) => Array.isArray(r.results) && r.results.length === reads.length,
      );
    } catch (err) {
      if (token && err instanceof ApiError && err.code === 'unauthenticated') rejectToken(token);
      throw err;
    }
  }

  const deliver = (sub: Subscriber, value: unknown) => {
    sub.delivered = true;
    try {
      sub.cb(clone(value));
    } catch (err) {
      console.error(err);
    }
  };

  /** Servern nekade (eller förstod inte) sökvägen: avsluta bevakningen och meddela prenumeranterna via onError. */
  const failWatch = (w: Watch, err: Error) => {
    watches.delete(w.path);
    const subs = [...w.subs];
    w.subs.clear();
    for (const sub of subs) {
      try {
        if (sub.onError) sub.onError(err);
        else console.warn(`Prenumerationen på "${w.path}" avbröts:`, err.message);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const applyWatchResult = (w: Watch, r: unknown) => {
    if (watches.get(w.path) !== w || !isObject(r)) return;
    if ('error' in r) {
      failWatch(w, readResultError(r.error, w.path));
      return;
    }
    if (r.unchanged === true) {
      if (w.hasValue) w.rev = typeof r.rev === 'number' ? r.rev : w.rev;
      else w.rev = undefined; // borde inte hända – be om hela värdet nästa gång
      return;
    }
    if (!('value' in r)) return;
    const value = r.value ?? null;
    w.rev = typeof r.rev === 'number' ? r.rev : undefined;
    const changed = !w.hasValue || !deepEqual(w.value, value);
    w.value = value;
    w.hasValue = true;
    for (const sub of [...w.subs]) {
      if (w.subs.has(sub) && (changed || !sub.delivered)) deliver(sub, value);
    }
  };

  const settleGet = (g: PendingGet, r: unknown) => {
    if (!isObject(r)) g.reject(new ApiError(MSG.badResponse, 'bad_response', 200));
    else if ('error' in r) g.reject(readResultError(r.error, g.path));
    else if (!('value' in r)) g.reject(new ApiError(MSG.badResponse, 'bad_response', 200));
    else g.resolve(r.value ?? null);
  };

  /** Hämtar alla bevakade sökvägar (och väntande get()) i ett enda anrop. */
  async function poll() {
    if (polling) {
      pollAgain = true;
      return;
    }
    clearPollTimer();
    if (getTimer !== null) clearTimeout(getTimer);
    getTimer = null;
    const gets = getQueue;
    getQueue = [];
    const list = [...watches.values()];
    const done = waiters;
    waiters = [];
    if (!list.length && !gets.length) {
      done.forEach((resolve) => resolve());
      return;
    }

    polling = true;
    pollAgain = false;
    const reads: ReadEntry[] = [
      ...list.map((w) => (w.rev === undefined ? { path: w.path } : { path: w.path, rev: w.rev })),
      ...gets.map((g) => ({ path: g.path })),
    ];
    try {
      // Håller sessionen på att skapas? Vänta in den, så att läsningen görs som rätt användare.
      if (!session && sessionPromise) await sessionPromise.catch(() => undefined);
      const res = await read(reads);
      failures = 0;
      list.forEach((w, i) => applyWatchResult(w, res.results[i]));
      gets.forEach((g, i) => settleGet(g, res.results[list.length + i]));
    } catch (err) {
      failures++;
      gets.forEach((g) => g.reject(err));
    } finally {
      polling = false;
      done.forEach((resolve) => resolve());
      // Begärdes en ny pollning under tiden (ny prenumeration, skrivning, fokus …)? Kör den direkt.
      if (pollAgain || waiters.length || getQueue.length) pollSoon();
      else schedule(nextDelay());
    }
  }

  /** get() medan en pollning pågår: läs direkt i ett eget anrop i stället för att vänta. */
  async function readGets(gets: PendingGet[]) {
    try {
      const res = await read(gets.map((g) => ({ path: g.path })));
      gets.forEach((g, i) => settleGet(g, res.results[i]));
    } catch (err) {
      gets.forEach((g) => g.reject(err));
    }
  }

  const flushGets = () => {
    getTimer = null;
    if (!getQueue.length) return;
    if (!polling) void poll(); // följer med i (en tidigarelagd) pollning
    else {
      const gets = getQueue;
      getQueue = [];
      void readGets(gets);
    }
  };

  /**
   * Hämtar alla prenumerationer direkt (efter en skrivning). Löses när en pollning som STARTADE efter
   * anropet är klar – en pollning som redan pågår kan ha läst databasen före skrivningen.
   */
  const refresh = (): Promise<void> => {
    if (!watches.size) return Promise.resolve();
    return new Promise<void>((resolve) => {
      waiters.push(resolve);
      pollSoon();
    });
  };

  const wake = () => {
    if (watches.size) schedule(0);
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!isHidden()) wake();
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', wake);
    window.addEventListener('online', () => {
      failures = 0;
      wake();
    });
  }

  /* ---------------- Skrivningar ---------------- */

  async function write(req: WriteRequest): Promise<void> {
    const s = await getSession();
    try {
      await call<WriteResponse>('write', req, s.token, WRITE_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthenticated') rejectToken(s.token);
      throw err;
    }
    // Vyerna ska se sin egen skrivning när löftet löses (t.ex. adminknappens nya etikett).
    await refresh();
  }

  /* ---------------- Push-nycklar ---------------- */

  let lastPushTime = 0;
  const lastRandChars: number[] = [];

  const randomIndexes = (n: number): number[] => {
    const out: number[] = [];
    if (globalThis.crypto?.getRandomValues) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
      bytes.forEach((b) => out.push(b % 64));
    } else {
      for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * 64));
    }
    return out;
  };

  /** Push-id: 8 tecken servertid + 12 slumptecken. Sorteras i tidsordning och ökar strikt inom samma millisekund. */
  const pushKey = (): string => {
    let time = Math.max(Math.floor(now()), lastPushTime); // backar aldrig, även om klockan justeras
    if (time === lastPushTime && lastRandChars.length === 12) {
      let i = 11;
      while (i >= 0 && lastRandChars[i] === 63) {
        lastRandChars[i] = 0;
        i--;
      }
      if (i >= 0) lastRandChars[i]++;
      else {
        time += 1; // (astronomiskt osannolikt) alla kombinationer slut – ta nästa millisekund
        lastRandChars.splice(0, 12, ...randomIndexes(12));
      }
    } else {
      lastRandChars.splice(0, 12, ...randomIndexes(12));
    }
    lastPushTime = time;
    let ts = '';
    for (let i = 0; i < 8; i++) {
      ts = PUSH_CHARS.charAt(time % 64) + ts;
      time = Math.floor(time / 64);
    }
    return ts + lastRandChars.map((c) => PUSH_CHARS.charAt(c)).join('');
  };

  /* ---------------- Backend ---------------- */

  const backend: Backend = {
    kind: 'server',
    ready: () => getSession().then((s) => s.uid),
    uid: () => session?.uid ?? null,

    subscribe<T = unknown>(path: string, cb: (value: T | null) => void, onError?: (err: Error) => void): Unsubscribe {
      const key = normalizePath(path);
      const sub: Subscriber = { cb: cb as (value: unknown) => void, onError, delivered: false };
      const existing = watches.get(key);
      const watch: Watch = existing ?? { path: key, subs: new Set(), value: null, hasValue: false };
      watch.subs.add(sub);
      if (!existing) {
        watches.set(key, watch);
        schedule(0); // första värdet så snart som möjligt (prenumerationer i samma tick delar anrop)
      } else if (watch.hasValue) {
        // Sökvägen bevakas redan: ge den nya prenumeranten det senaste värdet direkt (asynkront).
        queueMicrotask(() => {
          if (watch.subs.has(sub) && !sub.delivered) deliver(sub, watch.value);
        });
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        watch.subs.delete(sub);
        if (!watch.subs.size && watches.get(key) === watch) {
          watches.delete(key);
          if (!watches.size && !waiters.length && !getQueue.length) clearPollTimer();
        }
      };
    },

    get<T = unknown>(path: string): Promise<T | null> {
      return new Promise<T | null>((resolve, reject) => {
        getQueue.push({ path: normalizePath(path), resolve: (v) => resolve(v as T | null), reject });
        if (getTimer === null) getTimer = setTimeout(flushGets, 0);
      });
    },

    set: (path, value) => write({ op: 'set', path: normalizePath(path), value: stripUndefined(value) ?? null }),
    update: (path, values) => write({ op: 'update', path: normalizePath(path), values: stripUndefined(values) ?? {} }),
    remove: (path) => write({ op: 'remove', path: normalizePath(path) }),

    pushKey,
    now,
    serverTime: () => ({ ...SERVER_TIME }),

    onConnection(cb) {
      connectionListeners.add(cb);
      queueMicrotask(() => {
        if (connectionListeners.has(cb)) cb(connected);
      });
      return () => {
        connectionListeners.delete(cb);
      };
    },
  };
  return backend;
}
