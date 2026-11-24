import type { Results } from '../lib/scoring';
import type { Game } from '../lib/types';

/**
 * STUB – implementeras av results-agenten.
 * Knapp som skapar en Instagram Story-bild (1080×1920) med prispallen och
 * delar den (Web Share API) eller laddar ner den.
 */
export function StoryButton({ game, gameId, results, className = '' }: { game: Game; gameId: string; results: Results; className?: string }) {
  return <button className={`btn ${className}`} type="button">Story {gameId} {game.meta.pin} {results.ranking.length}</button>;
}
