import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Connect, type Plugin } from 'vite';
import { closeDefaultStore, handle, MAX_BODY_BYTES } from './handler.js';

/**
 * Kör API:t (/api/*) direkt i Vite – både i `vite` (dev) och `vite preview` – så att appen fungerar
 * lokalt precis som på Vercel, utan Vercel CLI.
 *
 * Lagring: Postgres om DATABASE_URL eller POSTGRES_URL finns (i miljön eller i en .env-fil, t.ex.
 * .env.local från `vercel env pull`), annars en JSON-fil i .data/dev-db.json.
 * Serverkoden körs bara i Node (i Vite-processen) och hamnar aldrig i webbläsarens bundle.
 */

/** Miljövariabler som servern läser från process.env (Vite lägger annars bara VITE_* i import.meta.env). */
const SERVER_ENV = ['DATABASE_URL', 'POSTGRES_URL', 'SESSION_SECRET'] as const;

async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function toRequest(req: Connect.IncomingMessage, body: Buffer | undefined): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':')) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else headers.set(name, value);
  }
  // Som Vercel: klientens egen X-Forwarded-For litar vi inte på – använd anslutningens adress.
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'okänd');
  headers.delete('content-length'); // räknas om från body
  const url = `http://${req.headers.host ?? 'localhost'}${req.originalUrl ?? req.url ?? '/'}`;
  return new Request(url, { method: req.method, headers, body: body && body.length ? new Uint8Array(body) : undefined });
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function middleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api' && !path.startsWith('/api/')) return next();
    void (async () => {
      try {
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        // Lite mer än gränsen, så att handle() själv svarar 413 för för stora förfrågningar.
        const body = hasBody ? await readRawBody(req, MAX_BODY_BYTES + 1024) : undefined;
        if (body === null) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'too_large', message: 'Förfrågan är för stor (max 256 kB)', now: Date.now() }));
          return;
        }
        await sendResponse(res, await handle(toRequest(req, body)));
      } catch (err) {
        next(err);
      }
    })();
  };
}

export function apiPlugin(): Plugin {
  const loadServerEnv = (mode: string, root: string) => {
    const env = loadEnv(mode, root, '');
    for (const key of SERVER_ENV) {
      if (!process.env[key] && env[key]) process.env[key] = env[key];
    }
  };
  return {
    name: 'bonjour-babes-api',
    configResolved(config) {
      loadServerEnv(config.mode, config.root);
    },
    configureServer(server) {
      server.middlewares.use(middleware());
      server.httpServer?.once('close', () => void closeDefaultStore());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
      server.httpServer?.once('close', () => void closeDefaultStore());
    },
  };
}
