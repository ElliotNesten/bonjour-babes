import type { Game } from '../../lib/types';

/**
 * STUB – implementeras av player-agenten.
 * Formulär "Vad heter du?" + "Vad heter din drink?" som anropar joinGame().
 * Används av JoinView och av AdminView (admin går med som deltagare).
 */
export function JoinForm({ gameId, game, onJoined }: { gameId: string; game: Game; onJoined?: () => void }) {
  return <form onSubmit={(e) => { e.preventDefault(); onJoined?.(); }}>{gameId} {game.meta.pin}</form>;
}
