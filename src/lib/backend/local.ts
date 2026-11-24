import { joinPath, splitPath, stripUndefined, type Backend, type Unsubscribe } from './types';

/**
 * Demoläge utan Firebase: hela databasen ligger i localStorage och synkas mellan
 * flikar i samma webbläsare via BroadcastChannel/storage-event.
 *
 * Varje flik får ett eget uid (sessionStorage) så att man kan testa admin,
 * storskärm och flera spelare i olika flikar på samma dator.
 * Säkerhetsregler emuleras INTE – det här läget är bara för att prova.
 */

const STORAGE_KEY = 'bonjour-babes:local-db';
const UID_KEY = 'bonjour-babes:local-uid';
const SERVER_TIME = { '.sv': 'timestamp' };

type Tree = Record<string, unknown>;

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Ersätter servertids-platshållare, tar bort null och tomma objekt (som RTDB). */
function normalize(value: unknown, now: number): unknown {
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) {
    if (value['.sv'] === 'timestamp') return now;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalize(v, now);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    value.forEach((v, i) => {
      const n = normalize(v, now);
      if (n !== null) out[String(i)] = n;
    });
    if (!Object.keys(out).length) return null;
    // Läs tillbaka som array om nycklarna är 0..n-1 (som RTDB gör i de flesta fall).
    const keys = Object.keys(out);
    if (keys.every((k, i) => k === String(i))) return keys.map((k) => out[k]);
    return out;
  }
  return value;
}

function getAt(tree: unknown, path: string): unknown {
  let node: unknown = tree;
  for (const seg of splitPath(path)) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (isPlainObject(node)) node = node[seg];
    else return null;
  }
  return node ?? null;
}

function setAt(tree: Tree, path: string, value: unknown): Tree {
  const segs = splitPath(path);
  if (!segs.length) return (isPlainObject(value) ? value : {}) as Tree;
  const root: Tree = { ...tree };
  let node: Record<string, unknown> = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = node[seg];
    let copy: Record<string, unknown>;
    if (Array.isArray(next)) copy = Object.fromEntries(next.map((v, idx) => [String(idx), v]));
    else if (isPlainObject(next)) copy = { ...next };
    else copy = {};
    node[seg] = copy;
    node = copy;
  }
  const last = segs[segs.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

export function createLocalBackend(): Backend {
  const hasWindow = typeof window !== 'undefined';
  const local = hasWindow ? window.localStorage : undefined;
  const session = hasWindow ? window.sessionStorage : undefined;

  let uid = safeGet(session, UID_KEY);
  if (!uid) {
    uid = `local-${Math.random().toString(36).slice(2, 10)}`;
    safeSet(session, UID_KEY, uid);
  }
  const myUid = uid;

  const load = (): Tree => {
    const raw = safeGet(local, STORAGE_KEY);
    if (!raw) return {};
    try {
      return (JSON.parse(raw) as Tree) ?? {};
    } catch {
      return {};
    }
  };

  let tree: Tree = load();
  const subs = new Set<{ path: string; cb: (v: unknown) => void; last: string | undefined }>();
  const channel = hasWindow && 'BroadcastChannel' in window ? new BroadcastChannel(STORAGE_KEY) : null;

  const emit = () => {
    for (const sub of subs) {
      const value = getAt(tree, sub.path);
      const json = JSON.stringify(value ?? null);
      if (json !== sub.last) {
        sub.last = json;
        sub.cb(value === null ? null : JSON.parse(json));
      }
    }
  };

  const reload = () => {
    tree = load();
    emit();
  };
  channel?.addEventListener('message', reload);
  if (hasWindow) {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) reload();
    });
  }

  const commit = (mutate: (t: Tree) => Tree) => {
    tree = load();
    tree = (normalize(mutate(tree), Date.now()) as Tree) ?? {};
    safeSet(local, STORAGE_KEY, JSON.stringify(tree));
    channel?.postMessage('changed');
    emit();
  };

  let keyCounter = 0;
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

  const backend: Backend = {
    kind: 'local',
    ready: () => Promise.resolve(myUid),
    uid: () => myUid,
    subscribe<T>(path: string, cb: (value: T | null) => void): Unsubscribe {
      const sub = { path, cb: cb as (v: unknown) => void, last: undefined as string | undefined };
      subs.add(sub);
      queueMicrotask(() => {
        if (!subs.has(sub)) return;
        const value = getAt(tree, path);
        sub.last = JSON.stringify(value ?? null);
        cb(value === null ? null : (JSON.parse(sub.last) as T));
      });
      return () => {
        subs.delete(sub);
      };
    },
    async get<T>(path: string) {
      tree = load();
      const value = getAt(tree, path);
      return value === null ? null : (JSON.parse(JSON.stringify(value)) as T);
    },
    async set(path, value) {
      commit((t) => setAt(t, path, stripUndefined(value) ?? null));
    },
    async update(path, values) {
      commit((t) => {
        let next = t;
        for (const [k, v] of Object.entries(stripUndefined(values))) {
          next = setAt(next, joinPath(path, k), v ?? null);
        }
        return next;
      });
    },
    async remove(path) {
      commit((t) => setAt(t, path, null));
    },
    pushKey() {
      let now = Date.now();
      let ts = '';
      for (let i = 0; i < 8; i++) {
        ts = PUSH_CHARS.charAt(now % 64) + ts;
        now = Math.floor(now / 64);
      }
      keyCounter = (keyCounter + 1) % 4096;
      let rand = '';
      for (let i = 0; i < 10; i++) rand += PUSH_CHARS.charAt(Math.floor(Math.random() * 64));
      return ts + PUSH_CHARS.charAt(keyCounter % 64) + rand;
    },
    now: () => Date.now(),
    serverTime: () => ({ ...SERVER_TIME }),
    onConnection(cb) {
      queueMicrotask(() => cb(true));
      return () => {};
    },
  };
  return backend;
}
