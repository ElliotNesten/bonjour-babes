import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PrefixRead, ReadOutcome, ReadSpec, Store, StoredDoc, TransactOptions, TxOutcome, TxPlan, TxReader } from './store.js';

/**
 * Dokumentlager i minnet, valfritt sparat i en JSON-fil. Används för lokal utveckling utan
 * Postgres (npm run dev → .data/dev-db.json) och i testerna (utan fil).
 * Samma semantik som store-pg.ts: en rev per transaktion, gravstenar, transaktioner i tur och ordning.
 * Bara för en process i taget – inte för produktion.
 */

export interface FileStoreOptions {
  /** Sökväg till JSON-filen. Utan fil ligger allt bara i minnet. */
  file?: string;
}

interface FileFormat {
  version: 1;
  rev: number;
  docs: Record<string, StoredDoc>;
}

const clone = <T>(value: T): T => (value !== null && typeof value === 'object' ? structuredClone(value) : value);

export function createFileStore(options: FileStoreOptions = {}): Store {
  const { file } = options;
  const docs = new Map<string, StoredDoc>();
  let lastRev = 0;

  if (file && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as FileFormat;
      lastRev = Number(saved.rev) || 0;
      for (const [key, doc] of Object.entries(saved.docs ?? {})) {
        docs.set(key, { data: doc.data ?? null, rev: Number(doc.rev) || 0 });
        lastRev = Math.max(lastRev, Number(doc.rev) || 0);
      }
    } catch (err) {
      const backup = `${file}.trasig-${Date.now()}`;
      console.warn(`[bonjour-babes] Kunde inte läsa ${file} (${String(err)}). Sparar den som ${backup} och börjar om.`);
      renameSync(file, backup);
    }
  }

  const persist = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const data: FileFormat = { version: 1, rev: lastRev, docs: Object.fromEntries(docs) };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  };

  const get = (key: string): StoredDoc => {
    const doc = docs.get(key);
    return doc ? { data: clone(doc.data), rev: doc.rev } : { data: null, rev: 0 };
  };

  const readKeys = (keys: readonly string[]) => new Map(keys.map((k) => [k, get(k)] as const));

  // Transaktionerna körs en i taget (kedjade löften).
  let queue: Promise<unknown> = Promise.resolve();

  return {
    kind: 'file',

    async read(spec: ReadSpec): Promise<ReadOutcome> {
      const prefixes = new Map<string, PrefixRead>();
      for (const prefix of spec.prefixes ?? []) {
        const live = new Map<string, unknown>();
        let rev = 0;
        for (const [key, doc] of docs) {
          if (!key.startsWith(prefix)) continue;
          rev = Math.max(rev, doc.rev);
          if (doc.data !== null) live.set(key.slice(prefix.length), clone(doc.data));
        }
        prefixes.set(prefix, { docs: live, rev });
      }
      return { docs: readKeys(spec.keys ?? []), prefixes };
    },

    transact<T>(
      keys: readonly string[],
      plan: (current: Map<string, StoredDoc>, tx: TxReader) => Promise<TxPlan<T>> | TxPlan<T>,
      opts: TransactOptions = {},
    ): Promise<TxOutcome<T>> {
      const run = async (): Promise<TxOutcome<T>> => {
        const current = readKeys([...new Set([...keys, ...(opts.alsoRead ?? [])])]);
        const { changes, result } = await plan(current, { read: async (more) => readKeys(more) });
        if (!changes.size) return { rev: null, result };
        for (const key of changes.keys()) {
          if (!keys.includes(key)) throw new Error(`Transaktionen ändrar ${key}, som inte är låst`);
        }
        const rev = ++lastRev;
        for (const [key, value] of changes) docs.set(key, { data: value === undefined ? null : clone(value), rev });
        persist();
        return { rev, result };
      };
      const done = queue.then(run);
      queue = done.catch(() => undefined);
      return done;
    },

    async close() {
      await queue;
    },
  };
}
