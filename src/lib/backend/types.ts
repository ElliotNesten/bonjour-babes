export type Unsubscribe = () => void;

export type BackendKind = 'firebase' | 'emulator' | 'local';

/**
 * Minimal databas-abstraktion som både Firebase Realtime Database och
 * demoläget (localStorage) implementerar. Sökvägar är '/'-separerade och
 * relativa databasens rot, t.ex. "games/abc/players/xyz". Tom sträng = roten.
 *
 * Semantik som i Firebase RTDB:
 *  - null/undefined som värde tar bort noden.
 *  - Tomma objekt existerar inte (läses som null).
 *  - Arrayer kan läsas tillbaka som objekt med nycklarna "0", "1", … – normalisera vid läsning.
 */
export interface Backend {
  readonly kind: BackendKind;
  /** Loggar in anonymt (om det behövs) och returnerar användarens uid. */
  ready(): Promise<string>;
  /** uid när ready() har lösts, annars null. */
  uid(): string | null;
  /** Prenumerera på värdet på en sökväg. cb anropas direkt (asynkront) med nuvarande värde och sedan vid varje ändring. */
  subscribe<T = unknown>(path: string, cb: (value: T | null) => void, onError?: (err: Error) => void): Unsubscribe;
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  /** Fler-sökvägsuppdatering: nycklarna i values är sökvägar relativa till path. Atomiskt. */
  update(path: string, values: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /** Ny unik, kronologiskt sorterbar nyckel (som Firebase push-id). */
  pushKey(): string;
  /** Uppskattad servertid i ms. */
  now(): number;
  /** Platshållare som blir servertid när den skrivs. Läses tillbaka som number. */
  serverTime(): unknown;
  /** Anropas med true/false när anslutningen till databasen ändras. */
  onConnection(cb: (connected: boolean) => void): Unsubscribe;
}

/** Fel som kastas när databasens säkerhetsregler nekar en skrivning. */
export class PermissionDeniedError extends Error {
  constructor(message = 'Åtkomst nekad') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export function isPermissionDenied(err: unknown): boolean {
  if (err instanceof PermissionDeniedError) return true;
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  const code = String((err as { code?: unknown })?.code ?? '');
  return /permission[_ ]denied/i.test(msg) || /permission[_-]denied/i.test(code);
}

/** Tar bort undefined rekursivt (Firebase vägrar skriva undefined). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stripUndefined(v))) as unknown as T;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function joinPath(...parts: string[]): string {
  return parts.flatMap(splitPath).join('/');
}
