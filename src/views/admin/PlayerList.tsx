import { useState, type FormEvent } from 'react';
import { Avatar } from '../../components/Avatar';
import { DRINK_MAX, editPlayer, goToDrink, moveInOrder, NAME_MAX, removePlayer } from '../../lib/game';
import { completedDrinkIds, effectiveOrder } from '../../lib/selectors';
import type { Game, Player } from '../../lib/types';
import { useFeedback } from './feedback';
import { TrashIcon } from './parts';

type RowState = 'queued' | 'done' | 'current' | 'upcoming';

interface PlayerListProps {
  game: Game;
  gameId: string;
  uid: string;
  /** lobby: ordning + flytta. running: tidslinje med "hoppa hit". */
  mode: 'lobby' | 'running';
}

/**
 * Deltagarna i presentationsordning. Tryck på en rad för att flytta, ändra eller ta bort.
 * Visar aldrig några poäng.
 */
export function PlayerList({ game, gameId, uid, mode }: PlayerListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const order = effectiveOrder(game);
  const done = new Set(mode === 'running' ? completedDrinkIds(game) : []);
  const currentId = mode === 'running' ? game.current?.drinkId : undefined;
  const startedAt = game.meta.startedAt ?? 0;

  const stateOf = (id: string): RowState => {
    if (mode === 'lobby') return 'queued';
    if (id === currentId) return 'current';
    if (done.has(id)) return 'done';
    return 'upcoming';
  };

  return (
    <ol className={`adm-plist adm-plist--${mode}`}>
      {order.map((id, index) => {
        const player = game.players[id];
        if (!player) return null;
        const state = stateOf(id);
        const prevState = index > 0 ? stateOf(order[index - 1]) : null;
        return (
          <PlayerRow
            key={id}
            id={id}
            index={index}
            total={order.length}
            player={player}
            state={state}
            mode={mode}
            isMe={id === uid}
            isLate={mode === 'running' && startedAt > 0 && player.joinedAt > startedAt}
            canMoveUp={mode === 'lobby' ? index > 0 : state === 'upcoming' && prevState === 'upcoming'}
            canMoveDown={mode === 'lobby' ? index < order.length - 1 : state === 'upcoming' && index < order.length - 1}
            open={openId === id}
            onToggle={() => setOpenId((cur) => (cur === id ? null : id))}
            onClose={() => setOpenId(null)}
            game={game}
            gameId={gameId}
          />
        );
      })}
    </ol>
  );
}

interface PlayerRowProps {
  id: string;
  index: number;
  total: number;
  player: Player;
  state: RowState;
  mode: 'lobby' | 'running';
  isMe: boolean;
  isLate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  game: Game;
  gameId: string;
}

function PlayerRow({ id, index, total, player, state, mode, isMe, isLate, canMoveUp, canMoveDown, open, onToggle, onClose, game, gameId }: PlayerRowProps) {
  const { run, pending, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const busy = pending !== null;
  const panelId = `adm-prow-${id}`;

  const marker = state === 'done' ? '✓' : state === 'current' ? '●' : String(index + 1);
  const stateLabel =
    state === 'done' ? 'klar' : state === 'current' ? 'aktuell drink' : mode === 'running' ? 'kommer senare' : `plats ${index + 1} av ${total}`;

  const move = (delta: -1 | 1) => run(`move:${id}`, () => moveInOrder(gameId, id, delta));

  const jump = async () => {
    const cur = game.current ? game.players[game.current.drinkId] : undefined;
    const ok = await confirm({
      title: `Hoppa till ${player.name}?`,
      body: (
        <>
          <strong>{player.drink}</strong> blir nästa drink på väg på storskärmen.
          {cur && game.current?.phase === 'voting' && <> Röstningen för {cur.name}s drink stängs.</>}
          {state === 'done' && <> Betygen den redan har fått ligger kvar och kan ändras om du öppnar röstningen igen.</>}
        </>
      ),
      confirmLabel: 'Hoppa hit',
    });
    if (!ok) return;
    if (await run(`jump:${id}`, () => goToDrink(gameId, index), { success: `${player.name}s drink är på väg` })) onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Ta bort ${player.name}?`,
      body: (
        <>
          {isMe && <>Det här är du. </>}
          {player.name} och drinken <strong>{player.drink}</strong> tas bort från spelet
          {mode === 'running' ? ', tillsammans med alla betyg hen har gett och fått.' : '.'}
          {state === 'current' && <> Det är den aktuella drinken – nästa i ordningen blir "på väg" i stället.</>}
        </>
      ),
      confirmLabel: 'Ta bort',
      danger: true,
    });
    if (!ok) return;
    await run(`remove:${id}`, () => removePlayer(gameId, id), { success: `${player.name} är borttagen` });
  };

  return (
    <li className={`adm-prow adm-prow--${state} ${open ? 'is-open' : ''}`}>
      <button type="button" className="adm-prow__main" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
        <span className="adm-prow__pos tabular" aria-label={stateLabel}>
          {marker}
        </span>
        <Avatar emoji={player.emoji} color={player.color} size={42} dim={state === 'done'} ring={state === 'current'} />
        <span className="adm-prow__text">
          <span className="adm-prow__name">
            <span className="adm-prow__name-text">{player.name}</span>
            {isMe && <span className="adm-tag adm-tag--gold">du</span>}
            {player.manual && <span className="adm-tag">utan mobil</span>}
            {isLate && <span className="adm-tag adm-tag--new">ny</span>}
          </span>
          <span className="adm-prow__drink truncate">{player.drink}</span>
        </span>
        <span className="adm-prow__chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div id={panelId} className="adm-prow__panel">
          {editing ? (
            <EditPlayerForm
              game={game}
              gameId={gameId}
              id={id}
              player={player}
              onDone={() => {
                setEditing(false);
              }}
            />
          ) : (
            <div className="adm-prow__actions">
              {mode === 'running' && state !== 'current' && (
                <button type="button" className="adm-chip adm-chip--gold" onClick={() => void jump()} disabled={busy}>
                  {state === 'done' ? '↺ Hoppa hit' : '⤴ Hoppa hit'}
                </button>
              )}
              {(mode === 'lobby' || state === 'upcoming') && (
                <>
                  <button type="button" className="adm-chip adm-chip--icon" onClick={() => void move(-1)} disabled={busy || !canMoveUp} aria-label={`Flytta ${player.name} uppåt`}>
                    ▲
                  </button>
                  <button type="button" className="adm-chip adm-chip--icon" onClick={() => void move(1)} disabled={busy || !canMoveDown} aria-label={`Flytta ${player.name} nedåt`}>
                    ▼
                  </button>
                </>
              )}
              <button type="button" className="adm-chip" onClick={() => setEditing(true)} disabled={busy}>
                ✎ Ändra
              </button>
              <span className="spacer" />
              <button type="button" className="adm-chip adm-chip--danger adm-chip--icon" onClick={() => void remove()} disabled={busy} aria-label={`Ta bort ${player.name}`}>
                <TrashIcon />
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function EditPlayerForm({ game, gameId, id, player, onDone }: { game: Game; gameId: string; id: string; player: Player; onDone: () => void }) {
  const { run, pending } = useFeedback();
  const [name, setName] = useState(player.name);
  const [drink, setDrink] = useState(player.drink);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanDrink = drink.trim().replace(/\s+/g, ' ');
    if (!cleanName || !cleanDrink) {
      setError('Namn och drink får inte vara tomma');
      return;
    }
    const taken = Object.entries(game.players).some(
      ([pid, p]) => pid !== id && p.name.toLocaleLowerCase('sv') === cleanName.toLocaleLowerCase('sv'),
    );
    if (taken) {
      setError(`Namnet "${cleanName}" är redan taget`);
      return;
    }
    const ok = await run(`edit:${id}`, () => editPlayer(gameId, id, { name: cleanName, drink: cleanDrink }), {
      success: 'Sparat',
      onError: setError,
    });
    if (ok) onDone();
  };

  return (
    <form className="adm-edit stack" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor={`adm-edit-name-${id}`}>
          Namn
        </label>
        <input
          id={`adm-edit-name-${id}`}
          className="input"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`adm-edit-drink-${id}`}>
          Drink
        </label>
        <input
          id={`adm-edit-drink-${id}`}
          className="input"
          value={drink}
          maxLength={DRINK_MAX}
          autoComplete="off"
          onChange={(e) => {
            setDrink(e.target.value);
            setError(null);
          }}
        />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn--ghost btn--sm grow adm-btn-44" onClick={onDone}>
          Avbryt
        </button>
        <button className="btn btn--gold btn--sm grow adm-btn-44" disabled={pending !== null}>
          {pending === `edit:${id}` ? 'Sparar…' : 'Spara'}
        </button>
      </div>
    </form>
  );
}
