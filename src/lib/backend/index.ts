import { createHttpBackend } from './http';
import { createLocalBackend } from './local';
import type { Backend } from './types';

export * from './types';
export { ApiError, isNoDatabaseError } from './http';

/**
 * Väljer databaslager:
 *  - VITE_BACKEND=local (`npm run dev:local`, se .env.demo): demoläge helt i webbläsaren (localStorage).
 *  - annars: vår server (Vercel Functions i api/ → Postgres), se http.ts och protocol.ts.
 */
function chooseBackend(): Backend {
  if (import.meta.env.VITE_BACKEND === 'local') return createLocalBackend();
  return createHttpBackend();
}

/** Den globala databasinstansen. */
export const backend: Backend = chooseBackend();

/** Demoläget: allt sparas bara i den här webbläsaren och inga säkerhetsregler gäller. */
export const isDemoMode = backend.kind === 'local';
