/**
 * Små fabriker för att bygga Game-objekt i enhetstesterna.
 *
 *   const game = makeGame({ players: ['a', 'b', 'c'], votes: { a: { b: allOf(8) } } });
 *
 * Spelare får namn efter sitt id ("a" → "A"), en drink ("Drink A") och joinedAt i
 * den ordning de listas, så att effectiveOrder blir förutsägbar.
 */
import { DEFAULT_SETTINGS } from '../../src/lib/selectors';
import type { AwardId, CurrentRound, Game, GameSettings, GameStatus, Player, Vote } from '../../src/lib/types';

export type PlayerSpec = string | [id: string, overrides: Partial<Player>];

export interface GameFixture {
  status?: GameStatus;
  players?: PlayerSpec[];
  order?: string[];
  votes?: Record<string, Record<string, unknown>>;
  awardVotes?: Partial<Record<AwardId, Record<string, string>>>;
  settings?: Partial<GameSettings>;
  current?: CurrentRound;
  name?: string;
}

export function makePlayer(id: string, joinedAt: number, overrides: Partial<Player> = {}): Player {
  const label = id.charAt(0).toUpperCase() + id.slice(1);
  return {
    name: label,
    drink: `Drink ${label}`,
    emoji: '🍸',
    color: '#6e1430',
    joinedAt,
    ...overrides,
  };
}

export function makeGame(f: GameFixture = {}): Game {
  const players: Record<string, Player> = {};
  (f.players ?? []).forEach((spec, i) => {
    const [id, overrides] = typeof spec === 'string' ? [spec, {}] : spec;
    players[id] = makePlayer(id, 1000 + i, overrides);
  });
  return {
    meta: { name: f.name ?? 'Testkväll', pin: '123456', createdAt: 1, status: f.status ?? 'running' },
    settings: { ...DEFAULT_SETTINGS, ...f.settings },
    players,
    order: f.order ?? Object.keys(players),
    current: f.current,
    // Råa röster får vara ogiltiga i testerna (för att testa att de ignoreras).
    votes: (f.votes ?? {}) as Game['votes'],
    awardVotes: f.awardVotes ?? {},
  };
}

/** ['p1', 'p2', …, 'pn'] */
export function ids(n: number, prefix = 'p'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

export function vote(taste: number, look: number, creativity: number, again: number, comment?: string): Vote {
  return { taste, look, creativity, again, ...(comment !== undefined ? { comment } : {}), at: 1 };
}

/** Samma betyg i alla kategorier → totalpoäng n × 10. */
export function allOf(n: number, comment?: string): Vote {
  return vote(n, n, n, n, comment);
}

/** Viktad summa (4·smak + 2·utseende + 2·kreativitet + 1·igen), 9–90. */
export function weightedSum(v: Pick<Vote, 'taste' | 'look' | 'creativity' | 'again'>): number {
  return 4 * v.taste + 2 * v.look + 2 * v.creativity + v.again;
}

/** En röst vars viktade summa blir exakt `w` (9–90). */
export function voteWithWeightedSum(w: number): Vote {
  for (let taste = 1; taste <= 10; taste++) {
    for (let look = 1; look <= 10; look++) {
      for (let creativity = 1; creativity <= 10; creativity++) {
        const again = w - 4 * taste - 2 * look - 2 * creativity;
        if (again >= 1 && again <= 10) return vote(taste, look, creativity, again);
      }
    }
  }
  throw new Error(`Ingen röst ger viktad summa ${w}`);
}

/**
 * Ett komplett spel där alla röstar på alla andras drinkar med deterministiska betyg.
 * Används för prisutdelnings- och statistiktester.
 */
export function fullGame(
  n: number,
  opts: { comments?: boolean; awards?: boolean; votes?: boolean; status?: GameStatus; names?: string[] } = {},
): Game {
  const playerIds = ids(n);
  const players: PlayerSpec[] = playerIds.map((id, i) => [
    id,
    opts.names?.[i] ? { name: opts.names[i], drink: `${opts.names[i]}s drink` } : {},
  ]);
  const votes: Record<string, Record<string, Vote>> = {};
  if (opts.votes ?? true) {
    playerIds.forEach((drinkId, d) => {
      votes[drinkId] = {};
      playerIds.forEach((voterId, v) => {
        if (voterId === drinkId) return;
        const base = 1 + ((d * 3 + v * 7) % 10);
        const val = (k: number) => 1 + ((base + k + d) % 10);
        // Varje drink får minst en kommentar (från nästa spelare i listan) när comments är på.
        const comment = opts.comments && (v === (d + 1) % n || (d + v) % 3 === 0) ? `Kommentar ${d}-${v}` : undefined;
        votes[drinkId][voterId] = vote(val(0), val(1), val(2), val(3), comment);
      });
    });
  }
  const awardVotes: GameFixture['awardVotes'] = {};
  if (opts.awards) {
    for (const awardId of ['name', 'daring', 'swamp', 'favorite'] as const) {
      awardVotes[awardId] = {};
      playerIds.forEach((voterId, v) => {
        const target = playerIds[(v + 1) % n];
        awardVotes[awardId]![voterId] = target;
      });
    }
  }
  return makeGame({ status: opts.status ?? 'ceremony', players, votes, awardVotes });
}
