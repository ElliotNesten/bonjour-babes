import { useId, useState, type FormEvent } from 'react';
import { Avatar } from '../../components/Avatar';
import { isPermissionDenied } from '../../lib/backend';
import { DRINK_MAX, JoinError, NAME_MAX, joinGame, randomAvatar } from '../../lib/game';
import { useUid } from '../../lib/hooks';
import { href, navigate } from '../../lib/router';
import type { Game } from '../../lib/types';
import './player.css';

/**
 * Formulär "Ditt namn" + "Din drink" som anropar joinGame().
 * Används av JoinView, PlayView och AdminView (admin går med som deltagare).
 * Är man redan med fylls uppgifterna i, så formuläret fungerar också för att ändra namn/drink.
 */
export function JoinForm({ gameId, game, onJoined }: { gameId: string; game: Game; onJoined?: () => void }) {
  return <PlayerForm gameId={gameId} game={game} onDone={onJoined} />;
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

export function PlayerForm({
  gameId,
  game,
  onDone,
  onCancel,
}: {
  gameId: string;
  game: Game;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const uid = useUid();
  const existing = game.players[uid];
  const id = useId();
  const [name, setName] = useState(existing?.name ?? '');
  const [drink, setDrink] = useState(existing?.drink ?? '');
  const [avatar, setAvatar] = useState(() =>
    existing
      ? { emoji: existing.emoji, color: existing.color }
      : randomAvatar(Object.entries(game.players).filter(([pid]) => pid !== uid).map(([, p]) => p)),
  );
  const [spin, setSpin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = game.meta.status;
  const closed = !existing && status !== 'lobby' && status !== 'running';

  const cleanName = clean(name);
  const nameTaken =
    cleanName.length > 0 &&
    Object.entries(game.players).some(
      ([pid, p]) => pid !== uid && p.name.toLocaleLowerCase('sv') === cleanName.toLocaleLowerCase('sv'),
    );

  const reroll = () => {
    const taken = [...Object.entries(game.players).filter(([pid]) => pid !== uid).map(([, p]) => p), avatar];
    let next = randomAvatar(taken);
    // Se till att något faktiskt ändras.
    for (let i = 0; i < 6 && next.emoji === avatar.emoji && next.color === avatar.color; i++) next = randomAvatar(taken);
    setAvatar(next);
    setSpin((s) => s + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!cleanName) {
      setError('Skriv ditt namn');
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    if (!clean(drink)) {
      setError('Skriv namnet på din drink');
      document.getElementById(`${id}-drink`)?.focus();
      return;
    }
    if (nameTaken) return;
    setBusy(true);
    setError(null);
    try {
      await joinGame(gameId, { name, drink, emoji: avatar.emoji, color: avatar.color });
      if (onDone) onDone();
      else if (window.location.hash !== href(`/play/${gameId}`)) navigate(`/play/${gameId}`);
    } catch (err) {
      if (err instanceof JoinError) setError(err.message);
      else if (isPermissionDenied(err)) setError('Spelet tar inte emot nya deltagare just nu');
      else setError('Något gick fel – kontrollera anslutningen och försök igen');
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <div className="pl-note center">
        <p style={{ margin: 0 }}>Tävlingen har kommit för långt – nya deltagare kan inte gå med längre.</p>
      </div>
    );
  }

  return (
    <form className="pl-form stack-lg" onSubmit={submit} noValidate>
      <div className="pl-placecard" aria-live="polite">
        <div className="pl-placecard__avatar">
          <span key={spin} className={spin ? 'pl-spin' : 'pop'} style={{ display: 'inline-flex' }}>
            <Avatar emoji={avatar.emoji} color={avatar.color} size={88} />
          </span>
          <button type="button" className="pl-reroll" onClick={reroll} aria-label="Slumpa ny avatar" title="Slumpa ny avatar">
            <span aria-hidden="true">🎲</span>
          </button>
        </div>
        <div className="pl-placecard__text">
          <div className={`pl-placecard__name ${cleanName ? '' : 'is-empty'}`}>{cleanName || 'Ditt namn'}</div>
          <div className={`pl-placecard__drink ${clean(drink) ? '' : 'is-empty'}`}>
            {clean(drink) ? `“${clean(drink)}”` : 'Din drink'}
          </div>
        </div>
      </div>

      <div className="field">
        <div className="row-between">
          <label className="label" htmlFor={`${id}-name`}>
            Ditt namn
          </label>
          <span className="pl-count tabular" aria-hidden="true">
            {name.length}/{NAME_MAX}
          </span>
        </div>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder="t.ex. Elliot"
          aria-invalid={nameTaken || undefined}
          aria-describedby={nameTaken ? `${id}-name-err` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !clean(drink)) {
              e.preventDefault();
              document.getElementById(`${id}-drink`)?.focus();
            }
          }}
        />
        {nameTaken && (
          <div id={`${id}-name-err`} className="error">
            Namnet är redan taget – lägg till en initial eller ett smeknamn
          </div>
        )}
      </div>

      <div className="field">
        <div className="row-between">
          <label className="label" htmlFor={`${id}-drink`}>
            Din drink
          </label>
          <span className="pl-count tabular" aria-hidden="true">
            {drink.length}/{DRINK_MAX}
          </span>
        </div>
        <input
          id={`${id}-drink`}
          className="input"
          value={drink}
          maxLength={DRINK_MAX}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="go"
          placeholder="t.ex. Midnatt i Montmartre"
          aria-describedby={`${id}-drink-hint`}
          onChange={(e) => {
            setDrink(e.target.value);
            setError(null);
          }}
        />
        <div id={`${id}-drink-hint`} className="hint">
          Bara namnet – ingredienserna förblir hemliga 🤫
        </div>
      </div>

      {error && (
        <div className="error center" role="alert">
          {error}
        </div>
      )}

      <div className="stack">
        <button className="btn btn--gold btn--lg btn--block" disabled={busy || nameTaken}>
          {busy ? 'Ett ögonblick…' : existing ? 'Spara ändringar' : 'Jag är med ! 🥂'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost btn--block" onClick={onCancel} disabled={busy}>
            Avbryt
          </button>
        )}
      </div>
    </form>
  );
}
