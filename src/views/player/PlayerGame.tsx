import type { Game } from '../../lib/types';

/**
 * STUB – implementeras av player-agenten.
 * Spelarens vy av ett pågående spel (lobby, röstning, specialpriser, prisutdelning, slutresultat).
 * Används av PlayView (helsida) och av AdminView-fliken "Min röst" (embedded = true).
 * Förutsätter att den inloggade användaren redan är spelare i game.
 */
export function PlayerGame({ gameId, game, embedded = false }: { gameId: string; game: Game; embedded?: boolean }) {
  return <div>{gameId} {game.meta.status} {String(embedded)}</div>;
}
