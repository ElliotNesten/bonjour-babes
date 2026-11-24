/**
 * Utvecklingshjälp: skapar ett demospel med påhittade deltagare och röster så att
 * alla skärmar kan förhandsgranskas utan att spela igenom ett helt spel.
 *
 * Bara tillgängligt i utvecklingsläge (npm run dev / npm run dev:local).
 * I webbläsarkonsolen:
 *
 *   await __bb.seed({ status: 'ceremony', step: 3, players: 9 })
 *   → { gameId, pin }  (och den här fliken blir spelare i spelet)
 *
 * - Demoläget (dev:local): seed() gör dessutom fliken till admin (lösenord: opts.adminPassword, default "santé").
 * - Mot servern (npm run dev): servern kontrollerar alla skrivningar, så fliken måste FÖRST vara inloggad
 *   som admin på #/admin – annars kastar seed() ett fel. opts.adminPassword används inte.
 */
import { hashPassword } from './admin';
import { backend } from './backend';
import { PLAYER_COLORS, PLAYER_EMOJIS } from './game';
import { AWARD_IDS } from './scoring';
import type { GameStatus, Player, RoundPhase, Vote } from './types';

const NAMES = ['Elliot', 'Alva', 'Noah', 'Wilma', 'Hugo', 'Saga', 'Leo', 'Maja', 'Oscar', 'Ebba', 'Liam', 'Stella'];
const DRINKS = [
  'Le Spritz Rosé',
  'Midnatt i Montmartre',
  'Fransk 75:a deluxe',
  'Smultronkyssen',
  'Café Noir Martini',
  'Lavendel Collins',
  'Champagne Disco',
  'Tropisk Träskbåt',
  'Gin & Tonique',
  'Rabarberrebellen',
  'Basilikabrisen',
  'Sur Grodan',
];
const COMMENTS = [
  'Ooh là là, den här var farligt god 😍',
  'Lite för söt för min smak men snyggt glas!',
  'Vem kom på att blanda dill och gin?? Respekt.',
  'Smakar sommar i Provence',
  'Garnityret förtjänar en egen applåd',
  'Skulle beställa tre till',
  'Modigt. Väldigt modigt.',
  'C’est magnifique!',
];

export interface SeedOptions {
  players?: number;
  status?: GameStatus;
  /** Index för aktuell drink när status = running. */
  currentIndex?: number;
  phase?: RoundPhase;
  /** Steg i prisutdelningen när status = ceremony. */
  step?: number;
  /** Gör den här fliken till spelare (första spelaren). Default true. */
  meAsPlayer?: boolean;
  adminPassword?: string;
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seed(opts: SeedOptions = {}): Promise<{ gameId: string; pin: string }> {
  const uid = await backend.ready();
  const n = Math.max(2, Math.min(NAMES.length, opts.players ?? 8));
  const status = opts.status ?? 'lobby';
  const meAsPlayer = opts.meAsPlayer ?? true;
  const rand = rnd(n * 7919 + status.length);

  // Admin
  if (backend.kind === 'local') {
    // Demoläget har inga säkerhetsregler: skriv lösenordet och adminsessionen direkt.
    const hash = await hashPassword(opts.adminPassword ?? 'santé');
    await backend.update('', { 'secret/adminHash': hash, 'setup/adminConfigured': true, [`adminSessions/${uid}`]: hash });
  } else {
    const session = await backend.get<string>(`adminSessions/${uid}`).catch(() => null);
    if (typeof session !== 'string' || !session) {
      throw new Error('seed() skriver som admin: logga först in som admin i den här fliken (#/admin) och försök igen.');
    }
  }

  const gameId = backend.pushKey();
  const pin = String(100000 + Math.floor(((rand() + Math.random()) % 1) * 900000));
  const base = backend.now() - 3 * 3600_000;
  const ids = Array.from({ length: n }, (_, i) => (i === 0 && meAsPlayer ? uid : `seed${i}-${gameId.slice(-4)}`));
  const players: Record<string, Player> = {};
  ids.forEach((id, i) => {
    players[id] = {
      name: NAMES[i],
      drink: DRINKS[i],
      emoji: PLAYER_EMOJIS[i % PLAYER_EMOJIS.length],
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      joinedAt: base + i * 60_000,
    };
  });
  const order = [...ids].sort(() => rand() - 0.5);

  const doneCount =
    status === 'lobby'
      ? 0
      : status === 'running'
        ? Math.min(order.length, (opts.currentIndex ?? 2) + ((opts.phase ?? 'voting') === 'preparing' ? 0 : 1))
        : order.length;

  const votes: Record<string, Record<string, Vote>> = {};
  order.slice(0, doneCount).forEach((drinkId, di) => {
    const quality = 3 + rand() * 6;
    votes[drinkId] = {};
    for (const voter of ids) {
      if (voter === drinkId) continue;
      // Låt några inte ha röstat på den aktuella drinken.
      if (status === 'running' && di === doneCount - 1 && rand() < 0.35) continue;
      const v = (bias: number) => Math.max(1, Math.min(10, Math.round(quality + bias + (rand() - 0.5) * 4)));
      votes[drinkId][voter] = {
        taste: v(0),
        look: v(0.5),
        creativity: v(-0.3),
        again: v(0),
        ...(rand() < 0.4 ? { comment: COMMENTS[Math.floor(rand() * COMMENTS.length)] } : {}),
        at: base + 3600_000 + di * 600_000,
      };
    }
  });

  const awardVotes: Record<string, Record<string, string>> = {};
  if (status === 'ceremony' || status === 'finished' || status === 'awards') {
    for (const a of AWARD_IDS) {
      awardVotes[a] = {};
      for (const voter of ids) {
        if (status === 'awards' && rand() < 0.4) continue;
        let target = ids[Math.floor(rand() * ids.length)];
        if (target === voter) target = ids[(ids.indexOf(voter) + 1) % ids.length];
        awardVotes[a][voter] = target;
      }
    }
  }

  const currentIndex = Math.min(order.length - 1, opts.currentIndex ?? 2);
  const game: Record<string, unknown> = {
    meta: {
      name: 'Bonjour Babes',
      pin,
      createdAt: base,
      status,
      ...(status !== 'lobby' ? { startedAt: base + 1800_000 } : {}),
      ...(status === 'finished' ? { finishedAt: backend.now() } : {}),
    },
    settings: { trimExtremes: true, showJudgeNames: false, awardsEnabled: true },
    players,
    order: status === 'lobby' ? [] : order,
    votes,
    awardVotes,
  };
  if (status === 'running') {
    game.current = { index: currentIndex, drinkId: order[currentIndex], phase: opts.phase ?? 'voting', since: backend.now() };
  } else if (status !== 'lobby') {
    game.current = { index: order.length - 1, drinkId: order[order.length - 1], phase: 'closed', since: backend.now() };
  }
  if (status === 'ceremony') game.ceremony = { step: opts.step ?? 0, at: backend.now() };

  await backend.update('', { [`games/${gameId}`]: game, [`pins/${pin}`]: gameId });
  if (status === 'finished') {
    const { finishGame } = await import('./game');
    await finishGame(gameId);
  }
  try {
    localStorage.setItem('bonjour-babes:last-game', JSON.stringify({ gameId, pin }));
  } catch {
    /* ignore */
  }
  return { gameId, pin };
}

declare global {
  interface Window {
    __bb?: { seed: typeof seed; backend: typeof backend };
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__bb = { seed, backend };
}
