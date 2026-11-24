import { firebaseConfig } from '../../config';
import { createFirebaseBackend } from './firebase';
import { createLocalBackend } from './local';
import type { Backend } from './types';

export * from './types';

function chooseBackend(): Backend {
  const mode = import.meta.env.VITE_BACKEND as string | undefined;
  if (mode === 'emulator') {
    return createFirebaseBackend(
      {
        apiKey: 'demo-api-key',
        authDomain: 'demo-bonjour.firebaseapp.com',
        projectId: 'demo-bonjour',
        databaseURL: 'http://127.0.0.1:9000/?ns=demo-bonjour',
        appId: 'demo-app',
      },
      { host: '127.0.0.1', databasePort: 9000, authPort: 9099 },
    );
  }
  if (mode !== 'local' && firebaseConfig) {
    return createFirebaseBackend(firebaseConfig);
  }
  return createLocalBackend();
}

/** Den globala databasinstansen. */
export const backend: Backend = chooseBackend();

export const isDemoMode = backend.kind === 'local';
