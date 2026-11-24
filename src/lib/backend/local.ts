import { applyWrite, getAt, normalize, type Tree } from './tree';
import type { Backend, Unsubscribe } from './types';

/**
 * Demoläge utan server: hela databasen ligger i localStorage och synkas mellan
 * flikar i samma webbläsare via BroadcastChannel/storage-event.
 *
 * Varje flik får ett eget uid (sessionStorage) så att man kan testa admin,
 * storskärm och flera spelare i olika flikar på samma dator.
 * Säkerhetsregler emuleras INTE – det här läget är bara för att prova.
 */

const STORAGE_KEY = 'bonjour-babes:local-db';
const UID_KEY = 'bonjour-babes:local-uid';
const SERVER_TIME = { '.sv': 'timestamp' };

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
      commit((t) => applyWrite(t, { op: 'set', path, value }));
    },
    async update(path, values) {
      commit((t) => applyWrite(t, { op: 'update', path, values }));
    },
    async remove(path) {
      commit((t) => applyWrite(t, { op: 'remove', path }));
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
