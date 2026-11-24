import type { AwardId, Game, GameSettings, GameStatus, Player, Vote } from './types';

export const DEFAULT_SETTINGS: GameSettings = {
  trimExtremes: true,
  showJudgeNames: false,
  awardsEnabled: true,
};

const STATUSES: GameStatus[] = ['lobby', 'running', 'awards', 'ceremony', 'finished'];

/** RTDB kan returnera arrayer som objekt ({"0": …}). Gör alltid om till array. */
export function toArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined) as T[];
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, T>)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .filter((v) => v !== null && v !== undefined);
  }
  return [];
}

function obj<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

/** Gör om rådata från databasen till ett komplett Game-objekt med standardvärden. */
export function normalizeGame(raw: unknown): Game | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const meta = obj<unknown>(r.meta);
  if (!meta.pin) return null;
  const status = STATUSES.includes(meta.status as GameStatus) ? (meta.status as GameStatus) : 'lobby';
  const players: Record<string, Player> = {};
  for (const [id, p] of Object.entries(obj<Partial<Player>>(r.players))) {
    if (!p || typeof p !== 'object') continue;
    players[id] = {
      name: String(p.name ?? '').trim() || 'Okänd',
      drink: String(p.drink ?? '').trim() || 'Hemlig drink',
      emoji: p.emoji || '🍸',
      color: p.color || '#6e1430',
      joinedAt: Number(p.joinedAt) || 0,
      ...(p.manual ? { manual: true } : {}),
    };
  }
  const votes: Record<string, Record<string, Vote>> = {};
  for (const [drinkId, byVoter] of Object.entries(obj<Record<string, Vote>>(r.votes))) {
    votes[drinkId] = { ...obj<Vote>(byVoter) };
  }
  const awardVotesRaw = obj<Record<string, string>>(r.awardVotes);
  const awardVotes: Game['awardVotes'] = {};
  for (const [awardId, byVoter] of Object.entries(awardVotesRaw)) {
    awardVotes[awardId as AwardId] = { ...obj<string>(byVoter) };
  }
  const current = obj<unknown>(r.current);
  const lottery = obj<unknown>(r.lottery);
  const ceremony = obj<unknown>(r.ceremony);
  return {
    meta: {
      name: String(meta.name ?? 'Bonjour Babes'),
      pin: String(meta.pin),
      createdAt: Number(meta.createdAt) || 0,
      status,
      ...(meta.startedAt ? { startedAt: Number(meta.startedAt) } : {}),
      ...(meta.finishedAt ? { finishedAt: Number(meta.finishedAt) } : {}),
    },
    settings: { ...DEFAULT_SETTINGS, ...obj<boolean>(r.settings) },
    players,
    order: toArray<string>(r.order),
    current:
      typeof current.drinkId === 'string'
        ? {
            index: Number(current.index) || 0,
            drinkId: current.drinkId,
            phase: (['preparing', 'voting', 'closed'] as const).includes(current.phase as never)
              ? (current.phase as 'preparing' | 'voting' | 'closed')
              : 'preparing',
            since: Number(current.since) || 0,
          }
        : undefined,
    votes,
    awardVotes,
    lottery: lottery.at ? { at: Number(lottery.at), order: toArray<string>(lottery.order) } : undefined,
    ceremony: ceremony.step !== undefined ? { step: Number(ceremony.step) || 0, at: Number(ceremony.at) || 0 } : undefined,
  };
}

/** Spelare sorterade efter när de gick med. */
export function playerEntries(game: Game): [string, Player][] {
  return Object.entries(game.players).sort(
    ([a, pa], [b, pb]) => pa.joinedAt - pb.joinedAt || a.localeCompare(b),
  );
}

/**
 * Ordningen drinkarna presenteras i: den sparade ordningen (bara spelare som finns kvar)
 * följt av spelare som inte finns i ordningen ännu (t.ex. sena anslutningar) i den ordning de gick med.
 */
export function effectiveOrder(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of game.order) {
    if (game.players[id] && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const [id] of playerEntries(game)) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Spelare som har en egen enhet och därmed kan rösta. */
export function votingPlayerIds(game: Game): string[] {
  return playerEntries(game)
    .filter(([, p]) => !p.manual)
    .map(([id]) => id);
}

/** Vilka som förväntas rösta på en drink: alla med egen enhet utom skaparen. */
export function expectedVoters(game: Game, drinkId: string): string[] {
  return votingPlayerIds(game).filter((id) => id !== drinkId);
}

/** Giltiga röster på en drink (bara från spelare som finns kvar, aldrig från skaparen själv). */
export function votesForDrink(game: Game, drinkId: string): Record<string, Vote> {
  const out: Record<string, Vote> = {};
  for (const [voterId, vote] of Object.entries(game.votes[drinkId] ?? {})) {
    if (voterId !== drinkId && game.players[voterId] && isValidVote(vote)) out[voterId] = vote;
  }
  return out;
}

export function hasVoted(game: Game, drinkId: string, voterId: string): boolean {
  return !!votesForDrink(game, drinkId)[voterId];
}

export function isValidVote(v: unknown): v is Vote {
  if (!v || typeof v !== 'object') return false;
  const vote = v as Record<string, unknown>;
  return (['taste', 'look', 'creativity', 'again'] as const).every((k) => {
    const n = vote[k];
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10;
  });
}

/** Den aktuella drinkens skapare (eller null). */
export function currentDrink(game: Game): { id: string; player: Player; index: number; total: number } | null {
  if (!game.current) return null;
  const player = game.players[game.current.drinkId];
  if (!player) return null;
  const order = effectiveOrder(game);
  const idx = order.indexOf(game.current.drinkId);
  return { id: game.current.drinkId, player, index: idx >= 0 ? idx : game.current.index, total: order.length };
}

/** Index för nästa drink i ordningen efter den aktuella, eller null om alla är klara. */
export function nextDrinkIndex(game: Game): number | null {
  const order = effectiveOrder(game);
  if (!game.current) return order.length ? 0 : null;
  const idx = order.indexOf(game.current.drinkId);
  const next = (idx >= 0 ? idx : game.current.index) + 1;
  return next < order.length ? next : null;
}

/** Drinkar som redan har avslutats (alla före den aktuella i ordningen, plus den aktuella om den är stängd). */
export function completedDrinkIds(game: Game): string[] {
  const order = effectiveOrder(game);
  if (game.meta.status === 'awards' || game.meta.status === 'ceremony' || game.meta.status === 'finished') {
    return order;
  }
  if (!game.current) return [];
  const idx = order.indexOf(game.current.drinkId);
  if (idx < 0) return [];
  return order.slice(0, game.current.phase === 'closed' ? idx + 1 : idx);
}

/** Hur många av specialpriserna varje röstberättigad spelare har röstat i. */
export function awardVoteProgress(game: Game, awardIds: AwardId[]): { playerId: string; done: number; total: number }[] {
  return votingPlayerIds(game).map((playerId) => ({
    playerId,
    done: awardIds.filter((a) => {
      const target = game.awardVotes[a]?.[playerId];
      return !!target && target !== playerId && !!game.players[target];
    }).length,
    total: awardIds.length,
  }));
}
