import type { Game } from '../../lib/types';

/** Gemensamma props för statuspanelerna under fliken "Styr". */
export interface PanelProps {
  game: Game;
  gameId: string;
  /** Adminens eget uid (admin kan också vara deltagare). */
  uid: string;
  /** true när fliken "Styr" visas (t.ex. för tangentbordsgenvägar). */
  active: boolean;
  /** Byt till fliken "Min röst". */
  onMyVote: () => void;
}
