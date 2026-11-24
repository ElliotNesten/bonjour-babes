/**
 * HTTP-protokollet mellan webbappen (src/lib/backend/http.ts) och servern (server/, api/ på Vercel).
 *
 * Databasen är ett träd som i Firebase Realtime Database (se src/lib/types.ts för layouten).
 * Servern lagrar trädet som "dokument" (se docKeyOf) i Postgres och kontrollerar varje läsning och
 * skrivning mot reglerna i server/rules.ts. Realtid sker genom att klienten frågar efter ändringar
 * ungefär en gång i sekunden (POST /api/read med senast kända rev).
 *
 * Alla svar (även fel) är JSON och innehåller `now` = serverns klocka i ms, så att klienten kan
 * räkna ut tidsskillnaden mot servern.
 */

export const API_BASE = '/api';

/** Platshållare i skrivna värden som servern ersätter med sin egen tid (ms). Som Firebase serverTimestamp(). */
export const SERVER_TIME = { '.sv': 'timestamp' } as const;

/** Namnet på tabellen i Postgres (används också i instruktionerna för att återställa adminlösenordet). */
export const DOCS_TABLE = 'bb_docs';

/* ------------------------------------------------------------------ */
/*  POST /api/session                                                   */
/* ------------------------------------------------------------------ */

/**
 * Skapar en ny anonym identitet (motsvarar Firebase anonym inloggning). Ingen body.
 * Klienten sparar svaret i localStorage och skickar token som `Authorization: Bearer <token>`.
 */
export interface SessionResponse {
  uid: string;
  token: string;
  now: number;
}

/* ------------------------------------------------------------------ */
/*  POST /api/read                                                      */
/* ------------------------------------------------------------------ */

/**
 * Läser en eller flera sökvägar i ett anrop (används både för get() och för polling av prenumerationer).
 * Authorization är valfri: utan token läser man som oinloggad.
 */
export interface ReadRequest {
  reads: { path: string; /** Senast kända rev; om den är oförändrad skickas inget värde tillbaka. */ rev?: number }[];
}

export type ReadResult =
  | { path: string; rev: number; unchanged: true }
  | { path: string; rev: number; value: unknown }
  | { path: string; error: 'permission_denied' | 'bad_request' };

export interface ReadResponse {
  now: number;
  /** I samma ordning som ReadRequest.reads. */
  results: ReadResult[];
}

/* ------------------------------------------------------------------ */
/*  POST /api/write                                                     */
/* ------------------------------------------------------------------ */

/** Kräver Authorization. Semantik som Firebase set()/update()/remove(); update är atomisk över alla sökvägar. */
export type WriteRequest =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'update'; path: string; values: Record<string, unknown> }
  | { op: 'remove'; path: string };

export interface WriteResponse {
  ok: true;
  now: number;
  rev: number;
}

/* ------------------------------------------------------------------ */
/*  Fel                                                                 */
/* ------------------------------------------------------------------ */

/**
 * HTTP-status → error:
 *  400 bad_request · 401 unauthenticated (saknad/ogiltig token vid skrivning) · 403 permission_denied
 *  413 too_large · 429 rate_limited · 503 no_database (ingen databas kopplad på Vercel) · 500 server_error
 */
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'permission_denied'
  | 'too_large'
  | 'rate_limited'
  | 'no_database'
  | 'server_error';

export interface ErrorResponse {
  error: ApiErrorCode;
  message?: string;
  now: number;
}

/* ------------------------------------------------------------------ */
/*  Dokumentindelning                                                   */
/* ------------------------------------------------------------------ */

/** Toppnivåer där hela noden är ett dokument. Övriga toppnivåer har ett dokument per barn. */
export const SINGLE_DOC_ROOTS = ['setup', 'secret'] as const;
export const COLLECTION_ROOTS = ['adminSessions', 'pins', 'games', 'hallOfFame'] as const;

/**
 * Dokumentnyckeln för en sökväg, eller null om sökvägen ligger ovanför dokumentnivån
 * (roten eller en hel samling som "games").
 *   "setup/adminConfigured" → "setup" · "games/abc/players/x" → "games/abc" · "games" → null
 */
export function docKeyOf(path: string): string | null {
  const segs = path.split('/').filter(Boolean);
  if (!segs.length) return null;
  if ((SINGLE_DOC_ROOTS as readonly string[]).includes(segs[0])) return segs[0];
  if (segs.length < 2) return null;
  return `${segs[0]}/${segs[1]}`;
}

/** Tillåtna nycklar (som i Firebase: inte tomma, inga . # $ [ ] /, inga kontrolltecken, inte interna "__"). */
export function isValidKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 768 &&
    !key.startsWith('__') &&
    !/[.#$[\]/]/.test(key) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(key)
  );
}
