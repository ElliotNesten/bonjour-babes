/**
 * Ett minimalt databaslager i minnet för att testa src/lib/game.ts utan Firebase.
 *
 * Efterliknar de delar av Realtime Database-semantiken som spel-actions förlitar sig på:
 *  - null tar bort noder, tomma objekt finns inte, servertid ersätts vid skrivning
 *  - update() är fler-sökvägs och atomisk, och – precis som Firebase-SDK:n – vägrar den
 *    uppdateringar där en sökväg är förälder till en annan ("ancestor of another path")
 *  - ogiltiga nycklar (. # $ [ ]) avvisas
 *
 * Säkerhetsreglerna testas separat mot emulatorn (tests/rules).
 */
import { joinPath, splitPath, type Backend, type Unsubscribe } from '../../src/lib/backend/types';

type Tree = Record<string, unknown>;

export interface FakeBackend extends Backend {
  /** Hela databasen (läs i testerna). */
  readonly data: () => Tree;
  /** Byt inloggad användare (simulerar en annan mobil). */
  setUid(uid: string | null): void;
  /** Töm databasen och nollställ klockan. */
  reset(): void;
  /** Antal update()-anrop och deras sökvägar (för att kunna granska fler-sökvägsuppdateringar). */
  readonly updates: { path: string; keys: string[] }[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function normalize(value: unknown, now: number): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const items = value.map((v) => normalize(v, now));
    if (items.every((v) => v !== null)) return items.length ? items : null;
    const out: Tree = {};
    items.forEach((v, i) => {
      if (v !== null) out[String(i)] = v;
    });
    return Object.keys(out).length ? out : null;
  }
  if (isPlainObject(value)) {
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

function getAt(tree: unknown, segs: string[]): unknown {
  let node = tree;
  for (const seg of segs) {
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (isPlainObject(node)) node = node[seg];
    else return null;
  }
  return node ?? null;
}

function setAt(tree: Tree, segs: string[], value: unknown): Tree {
  if (!segs.length) return isPlainObject(value) ? value : {};
  const root: Tree = { ...tree };
  let node: Tree = root;
  for (const seg of segs.slice(0, -1)) {
    const next = node[seg];
    const copy: Tree = Array.isArray(next)
      ? Object.fromEntries(next.map((v, i) => [String(i), v]))
      : isPlainObject(next)
        ? { ...next }
        : {};
    node[seg] = copy;
    node = copy;
  }
  const last = segs[segs.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

const INVALID_KEY = /[.#$[\]]/;

function checkPath(path: string) {
  for (const seg of splitPath(path)) {
    if (INVALID_KEY.test(seg)) throw new Error(`Ogiltig nyckel "${seg}" i sökvägen ${path}`);
  }
}

export function createFakeBackend(): FakeBackend {
  let tree: Tree = {};
  let uid: string | null = 'admin';
  let clock = 0;
  let keyCounter = 0;
  const updates: { path: string; keys: string[] }[] = [];
  const subs = new Set<{ path: string; cb: (v: unknown) => void }>();

  const commit = (mutate: (t: Tree) => Tree) => {
    clock += 1000;
    tree = (normalize(mutate(tree), clock) as Tree | null) ?? {};
    for (const s of subs) s.cb(structuredClone(getAt(tree, splitPath(s.path))));
  };

  const read = <T>(path: string): T | null => {
    const v = getAt(tree, splitPath(path));
    return v === null ? null : (structuredClone(v) as T);
  };

  return {
    kind: 'local',
    data: () => structuredClone(tree),
    updates,
    setUid(next) {
      uid = next;
    },
    reset() {
      tree = {};
      uid = 'admin';
      clock = 0;
      keyCounter = 0;
      updates.length = 0;
      subs.clear();
    },
    async ready() {
      if (!uid) throw new Error('Inte inloggad');
      return uid;
    },
    uid: () => uid,
    subscribe<T>(path: string, cb: (value: T | null) => void): Unsubscribe {
      const sub = { path, cb: cb as (v: unknown) => void };
      subs.add(sub);
      queueMicrotask(() => subs.has(sub) && cb(read<T>(path)));
      return () => {
        subs.delete(sub);
      };
    },
    async get<T>(path: string) {
      return read<T>(path);
    },
    async set(path, value) {
      checkPath(path);
      commit((t) => setAt(t, splitPath(path), value));
    },
    async update(path, values) {
      const full = Object.keys(values).map((k) => joinPath(path, k));
      full.forEach(checkPath);
      // Samma kontroll som Firebase-SDK:n gör i update(): ingen sökväg får vara förälder till en annan.
      const sorted = full.map(splitPath).sort((a, b) => a.join('/').localeCompare(b.join('/')));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = 0; j < sorted.length; j++) {
          if (i === j) continue;
          const a = sorted[i];
          const b = sorted[j];
          if (a.length <= b.length && a.every((seg, k) => seg === b[k])) {
            throw new Error(`update() failed: values argument contains a path /${a.join('/')} that is ancestor of another path /${b.join('/')}`);
          }
        }
      }
      updates.push({ path, keys: Object.keys(values) });
      commit((t) => {
        let next = t;
        for (const [k, v] of Object.entries(values)) next = setAt(next, splitPath(joinPath(path, k)), v);
        return next;
      });
    },
    async remove(path) {
      commit((t) => setAt(t, splitPath(path), null));
    },
    pushKey() {
      keyCounter += 1;
      return `-K${String(keyCounter).padStart(6, '0')}`;
    },
    now: () => clock,
    serverTime: () => ({ '.sv': 'timestamp' }),
    onConnection(cb) {
      queueMicrotask(() => cb(true));
      return () => {};
    },
  };
}
