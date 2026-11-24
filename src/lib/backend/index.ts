import { createLocalBackend } from './local';
import type { Backend } from './types';

export * from './types';

// TILLFÄLLIGT under ombyggnaden: http-backenden (src/lib/backend/http.ts) kopplas in här.
function chooseBackend(): Backend {
  return createLocalBackend();
}

/** Den globala databasinstansen. */
export const backend: Backend = chooseBackend();

export const isDemoMode = backend.kind === 'local';
