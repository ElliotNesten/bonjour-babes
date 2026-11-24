/**
 * Datamodell för Bonjour Babes.
 *
 * Allt ligger i ett JSON-träd med sökvägar som "games/abc/meta" (se src/lib/backend/types.ts för
 * semantiken): på servern i Postgres bakom API:t (se src/lib/backend/protocol.ts och server/rules.ts),
 * i demoläget i localStorage.
 *
 *   setup/adminConfigured          true när adminlösenordet är satt (publik flagga)
 *   secret/adminHash               SHA-256 av adminlösenordet (oläsbar för klienter)
 *   adminSessions/{uid}            hash – bevisar att uid är admin (valideras av servern)
 *   pins/{pin}                     gameId – 6-siffrig spel-PIN → spel
 *   games/{gameId}                 Game (se nedan)
 *   hallOfFame/{gameId}            HallOfFameEntry – sparas när ett spel avslutas
 */

export type GameStatus = 'lobby' | 'running' | 'awards' | 'ceremony' | 'finished';

/** Fas för den drink som just nu är aktuell. */
export type RoundPhase =
  /** "Nästa drink är på väg" – skaparen blandar. */
  | 'preparing'
  /** Drinken är serverad – alla (utom skaparen) röstar i mobilen. */
  | 'voting'
  /** Röstningen är låst. Admin går vidare till nästa drink. */
  | 'closed';

export type CategoryId = 'taste' | 'look' | 'creativity' | 'again';
export type AwardId = 'name' | 'daring' | 'swamp' | 'favorite';

export interface GameMeta {
  name: string;
  pin: string;
  createdAt: number;
  status: GameStatus;
  /** När admin startade tävlingen (första drinken). */
  startedAt?: number;
  finishedAt?: number;
}

export interface GameSettings {
  /** "OS-regeln": stryk högsta och lägsta domarpoäng per drink när en drink har minst 5 röster. */
  trimExtremes: boolean;
  /** Visa på resultatsidan vem som gav vilket betyg. Annars är alla betyg anonyma. */
  showJudgeNames: boolean;
  /** Kör specialpris-röstningen efter sista drinken. */
  awardsEnabled: boolean;
}

export interface Player {
  name: string;
  /** Namnet på drinken spelaren gör. */
  drink: string;
  emoji: string;
  /** Hex-färg för avatarens bakgrund. */
  color: string;
  joinedAt: number;
  /** Tillagd manuellt av admin (har ingen egen mobil och kan därför inte rösta). */
  manual?: boolean;
}

/** En domares betyg på en drink. Alla kategorier 1–10 (heltal). */
export interface Vote {
  taste: number;
  look: number;
  creativity: number;
  again: number;
  /** Valfri anonym kommentar (max 280 tecken). */
  comment?: string;
  at: number;
}

export interface CurrentRound {
  /** Index i effectiveOrder(game). */
  index: number;
  /** Spelar-id för den vars drink är aktuell (= nyckel i votes). */
  drinkId: string;
  phase: RoundPhase;
  /** Servertid när fasen startade. */
  since: number;
}

/** Skrivs när admin lottar ordningen – storskärmen spelar då en lottningsanimation. */
export interface Lottery {
  at: number;
  order: string[];
}

export interface CeremonyState {
  /** Index i buildCeremonySteps(results). */
  step: number;
  at: number;
}

export interface Game {
  meta: GameMeta;
  settings: GameSettings;
  /** playerId (= mobilens anonyma uid från /api/session, eller slumpat id för manuella spelare) → Player */
  players: Record<string, Player>;
  /** Ordningen drinkarna presenteras i (spelar-id). Använd effectiveOrder(game) för att läsa. */
  order: string[];
  current?: CurrentRound;
  /** drinkId (skaparens spelar-id) → voterId → Vote */
  votes: Record<string, Record<string, Vote>>;
  /** awardId → voterId → spelar-id man röstat på */
  awardVotes: Partial<Record<AwardId, Record<string, string>>>;
  lottery?: Lottery;
  ceremony?: CeremonyState;
}

export interface HallOfFameRankingEntry {
  rank: number;
  name: string;
  drink: string;
  /** null om drinken inte fick några röster. */
  score: number | null;
  emoji: string;
  color: string;
}

export interface HallOfFameEntry {
  name: string;
  pin: string;
  createdAt: number;
  finishedAt: number;
  participants: number;
  ranking: HallOfFameRankingEntry[];
}
