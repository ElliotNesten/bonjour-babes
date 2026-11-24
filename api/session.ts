import { handle } from '../server/handler.js';

/**
 * Vercel Function: POST /api/session – ny anonym identitet (uid + token).
 * All logik finns i server/handler.ts (protokollet: src/lib/backend/protocol.ts).
 * OBS: relativa importer måste ha ".js"-ändelse – Vercel kör filerna som ESM utan att skriva om dem.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/** Andra metoder ger 405 (handle svarar så för allt som inte är POST). */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
