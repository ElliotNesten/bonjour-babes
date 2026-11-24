import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  connectDatabaseEmulator,
  get as dbGet,
  getDatabase,
  onValue,
  push,
  ref,
  remove as dbRemove,
  serverTimestamp,
  set as dbSet,
  update as dbUpdate,
} from 'firebase/database';
import {
  PermissionDeniedError,
  isPermissionDenied,
  stripUndefined,
  type Backend,
  type BackendKind,
  type Unsubscribe,
} from './types';

export interface EmulatorOptions {
  host: string;
  databasePort: number;
  authPort: number;
}

function wrapError(err: unknown): Error {
  if (isPermissionDenied(err)) return new PermissionDeniedError();
  return err instanceof Error ? err : new Error(String(err));
}

export function createFirebaseBackend(config: FirebaseOptions, emulator?: EmulatorOptions): Backend {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, { disableWarnings: true });
    connectDatabaseEmulator(db, emulator.host, emulator.databasePort);
  }

  const kind: BackendKind = emulator ? 'emulator' : 'firebase';
  let currentUid: string | null = null;
  let serverOffset = 0;
  let readyPromise: Promise<string> | null = null;

  const r = (path: string) => (path ? ref(db, path) : ref(db));

  const backend: Backend = {
    kind,
    ready() {
      if (!readyPromise) {
        readyPromise = new Promise<string>((resolve, reject) => {
          let settled = false;
          const stop = onAuthStateChanged(
            auth,
            (user) => {
              if (user) {
                currentUid = user.uid;
                if (!settled) {
                  settled = true;
                  resolve(user.uid);
                  // Starta servertids-offset först när vi är inloggade.
                  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
                    serverOffset = Number(snap.val()) || 0;
                  });
                }
              } else {
                signInAnonymously(auth).catch((err) => {
                  if (!settled) {
                    settled = true;
                    stop();
                    reject(err);
                  }
                });
              }
            },
            (err) => {
              if (!settled) {
                settled = true;
                reject(err);
              }
            },
          );
        });
        // Tillåt nytt försök om inloggningen misslyckades.
        readyPromise.catch(() => {
          readyPromise = null;
        });
      }
      return readyPromise;
    },
    uid: () => currentUid,
    subscribe<T>(path: string, cb: (value: T | null) => void, onError?: (err: Error) => void): Unsubscribe {
      return onValue(
        r(path),
        (snap) => cb((snap.val() as T | null) ?? null),
        (err) => {
          const e = wrapError(err);
          if (onError) onError(e);
          else console.error(`[db] prenumeration på "${path}" misslyckades`, e);
        },
      );
    },
    async get<T>(path: string) {
      try {
        const snap = await dbGet(r(path));
        return (snap.val() as T | null) ?? null;
      } catch (err) {
        throw wrapError(err);
      }
    },
    async set(path, value) {
      try {
        await dbSet(r(path), value === undefined ? null : stripUndefined(value));
      } catch (err) {
        throw wrapError(err);
      }
    },
    async update(path, values) {
      try {
        await dbUpdate(r(path), stripUndefined(values));
      } catch (err) {
        throw wrapError(err);
      }
    },
    async remove(path) {
      try {
        await dbRemove(r(path));
      } catch (err) {
        throw wrapError(err);
      }
    },
    pushKey() {
      const key = push(ref(db, 'keys')).key;
      if (!key) throw new Error('Kunde inte skapa nyckel');
      return key;
    },
    now: () => Date.now() + serverOffset,
    serverTime: () => serverTimestamp(),
    onConnection(cb) {
      return onValue(ref(db, '.info/connected'), (snap) => cb(snap.val() === true));
    },
  };
  return backend;
}
