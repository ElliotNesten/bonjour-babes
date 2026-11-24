/**
 * Lagringen bakom API:t: ett nyckel/värde-lager av "dokument" (se docKeyOf i
 * src/lib/backend/protocol.ts). Två implementationer med samma semantik:
 *
 *  - store-pg.ts   Postgres (Neon på Vercel, eller en lokal Postgres via DATABASE_URL)
 *  - store-file.ts i minnet, valfritt sparat i en JSON-fil (lokal utveckling utan Postgres, tester)
 *
 * Revisioner: varje skrivande transaktion får EN ny rev (en global, växande räknare) som alla
 * dokument den skriver får. Ett dokuments rev ökar alltså vid varje ändring av just det dokumentet
 * (transaktionerna låser sina dokument innan de tar sin rev). Ett borttaget dokument blir en
 * "gravsten" (data = null) som behåller sin rev, så att en samlings rev ändras även när något tas bort.
 *
 * En samlings rev (prefix, t.ex. "games/") är SUMMAN av dokumentens rev, gravstenar inräknade.
 * Inte max: i Postgres kan en transaktion med lägre rev bli klar efter en med högre rev, och då
 * skulle max inte ändras och en klient som pollar missa ändringen. Summan ökar vid varje ändring
 * oavsett ordning (varje dokuments rev bara växer och gravstenar tas aldrig bort), så två olika
 * tillstånd av samlingen har aldrig samma summa.
 *
 * Interna serverdokument har nycklar som börjar med "__" (t.ex. "__server", "__ratelimit/…").
 * API:t släpper aldrig igenom sådana nycklar (isValidKey i protocol.ts).
 */

export interface StoredDoc {
  /** Dokumentets värde; null om det saknas eller har tagits bort. */
  data: unknown;
  /** Revisionen för den senaste skrivningen; 0 om dokumentet aldrig har funnits. */
  rev: number;
}

export interface ReadDoc extends StoredDoc {
  /** true: rev är samma som den kända (ReadSpec.known) och data har inte hämtats (är null). */
  unchanged?: boolean;
}

export interface PrefixRead {
  /** Levande dokument under prefixet (nyckel utan prefix → värde). Gravstenar ingår inte. Tom om unchanged. */
  docs: Map<string, unknown>;
  /** Summan av rev under prefixet, gravstenar inräknade; 0 om inget finns. */
  rev: number;
  /** true: rev är samma som den kända (ReadSpec.known) och docs har inte hämtats. */
  unchanged?: boolean;
}

export interface ReadSpec {
  keys?: readonly string[];
  /** Prefix som slutar med "/", t.ex. "games/". */
  prefixes?: readonly string[];
  /**
   * Senast kända rev per nyckel eller prefix. Är rev oförändrad behöver lagret inte hämta datat
   * (sparar trafik när klienterna pollar varje sekund).
   */
  known?: ReadonlyMap<string, number>;
}

export interface ReadOutcome {
  /** En post per efterfrågad nyckel (saknade: data null, rev 0). */
  docs: Map<string, ReadDoc>;
  prefixes: Map<string, PrefixRead>;
}

export interface TxReader {
  /** Läser fler dokument inne i transaktionen (utan lås). Saknade: data null, rev 0. */
  read(keys: readonly string[]): Promise<Map<string, StoredDoc>>;
}

export interface TxPlan<T> {
  /** Nya värden för ändrade dokument (null = ta bort). Tom = ingen skrivning och ingen ny rev. */
  changes: Map<string, unknown>;
  result: T;
}

export interface TransactOptions {
  /** Dokument som läses in i samma veva utan att låsas (t.ex. de som reglerna brukar titta på). */
  alsoRead?: readonly string[];
}

export interface TxOutcome<T> {
  /** Transaktionens rev, eller null om inget skrevs. */
  rev: number | null;
  result: T;
}

export interface Store {
  readonly kind: 'postgres' | 'file';
  read(spec: ReadSpec): Promise<ReadOutcome>;
  /**
   * Kör plan() med ensamrätt på dokumenten i keys: låser dem, läser dem (plus alsoRead) och
   * skriver plan():s ändringar atomiskt med en ny rev. Kastar plan() avbryts allt och felet
   * kastas vidare. Samtidiga transaktioner på samma dokument körs efter varandra, så inga
   * skrivningar går förlorade. plan() får bara ändra dokument i keys, och får inte själv anropa
   * store.read()/transact() (använd tx.read) – annars kan anslutningspoolen låsa sig.
   */
  transact<T>(
    keys: readonly string[],
    plan: (current: Map<string, StoredDoc>, tx: TxReader) => Promise<TxPlan<T>> | TxPlan<T>,
    options?: TransactOptions,
  ): Promise<TxOutcome<T>>;
  /** Stänger anslutningar / sparar till fil. */
  close(): Promise<void>;
}

export const MISSING: StoredDoc = Object.freeze({ data: null, rev: 0 }) as StoredDoc;

/** Stabil JSON (sorterade nycklar) – för att jämföra värden oberoende av nyckelordning (jsonb sorterar om). */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Escapar ett prefix för LIKE (… LIKE prefix || '%'). */
export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
