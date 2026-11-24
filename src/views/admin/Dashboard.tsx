import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { Ornament } from '../../components/Ornament';
import { adminLogout } from '../../lib/admin';
import { formatDateTime } from '../../lib/format';
import { createGame, deleteGame, listGames } from '../../lib/game';
import { href, navigate } from '../../lib/router';
import type { Game } from '../../lib/types';
import { errorMessage, useFeedback } from './feedback';
import { formatPin, StatusPill, TrashIcon } from './parts';

type GameRow = { gameId: string; game: Game };

/** Adminens startsida: skapa nytt spel och lista alla spel. */
export function Dashboard() {
  const { run, pending, confirm } = useFeedback();
  const [games, setGames] = useState<GameRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await listGames();
      setGames(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    await run('create', async () => {
      const { gameId } = await createGame(name.trim() || 'Bonjour Babes');
      navigate(`/admin/${gameId}`);
    });
  };

  const remove = async (row: GameRow) => {
    const ok = await confirm({
      title: `Radera "${row.game.meta.name}"?`,
      body: (
        <>
          Spelet med PIN <strong className="tabular">{formatPin(row.game.meta.pin)}</strong> raderas helt – deltagare, betyg och
          eventuell plats i Hall of Fame. Det går inte att ångra.
        </>
      ),
      confirmLabel: 'Radera',
      danger: true,
    });
    if (!ok) return;
    await run(`delete:${row.gameId}`, () => deleteGame(row.gameId), { success: 'Spelet är raderat' });
    await refresh();
  };

  const logout = () => run('logout', adminLogout);

  const busy = pending !== null;

  return (
    <main className="page adm-dash">
      <div className="adm-topbar">
        <a className="adm-backlink" href={href('/')}>
          ← Startsidan
        </a>
        <button type="button" className="btn btn--ghost btn--sm adm-btn-44" onClick={logout} disabled={busy}>
          Logga ut
        </button>
      </div>

      <header className="adm-dash__hero fade-up">
        <Logo size="md" />
        <Ornament width={220} />
        <div className="eyebrow">Adminpanel · Bonsoir, patron</div>
      </header>

      <form className="card card--deco card--gold stack fade-up" onSubmit={create} style={{ animationDelay: '0.06s' }}>
        <div>
          <div className="eyebrow">Nouvelle soirée</div>
          <h2 className="adm-dash__create-title">Skapa nytt spel</h2>
        </div>
        <div className="field">
          <label className="label" htmlFor="adm-new-name">
            Kvällens namn <span className="adm-optional">(valfritt)</span>
          </label>
          <input
            id="adm-new-name"
            className="input"
            placeholder="Bonjour Babes"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button className="btn btn--gold btn--lg btn--block" disabled={busy}>
          {pending === 'create' ? 'Skapar…' : '＋ Skapa nytt spel'}
        </button>
        <p className="hint center" style={{ margin: 0 }}>
          Du får en 6-siffrig PIN som gästerna skriver in i mobilen – precis som i Kahoot.
        </p>
      </form>

      <section className="stack fade-up" style={{ animationDelay: '0.12s' }} aria-labelledby="adm-games-title">
        <div className="adm-section-head">
          <div className="grow">
            <div className="eyebrow">Les soirées</div>
            <h3 id="adm-games-title" className="adm-section-head__title">
              Dina spel {games && games.length > 0 && <span className="adm-count">{games.length}</span>}
            </h3>
          </div>
          <button type="button" className="btn btn--ghost btn--icon adm-iconbtn" onClick={() => void refresh()} aria-label="Uppdatera listan">
            ↻
          </button>
        </div>

        {loadError && !games ? (
          <div className="card stack">
            <p className="error" style={{ margin: 0 }}>
              {loadError}
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
              Försök igen
            </button>
          </div>
        ) : games === undefined ? (
          <Loading text="Hämtar spelen…" />
        ) : games.length === 0 ? (
          <div className="card adm-empty center">
            <div className="adm-empty__icon" aria-hidden="true">
              🥂
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Inga spel än – skapa kvällens första ovan.
            </p>
          </div>
        ) : (
          <ul className="adm-games">
            {games.map((row) => (
              <GameCard key={row.gameId} row={row} busy={busy} deleting={pending === `delete:${row.gameId}`} onDelete={() => void remove(row)} />
            ))}
          </ul>
        )}
      </section>

      <nav className="adm-footlinks">
        <a href={href('/hall-of-fame')}>🏆 Hall of Fame</a>
        <a href={href('/tv')}>📺 Storskärm</a>
      </nav>
    </main>
  );
}

function GameCard({ row, busy, deleting, onDelete }: { row: GameRow; busy: boolean; deleting: boolean; onDelete: () => void }) {
  const { game, gameId } = row;
  const players = Object.keys(game.players).length;
  const live = game.meta.status !== 'finished';
  return (
    <li className={`card adm-game ${live ? 'adm-game--live' : ''} ${deleting ? 'adm-game--deleting' : ''}`}>
      <a className="adm-game__main" href={href(`/admin/${gameId}`)}>
        <div className="row-between adm-game__top">
          <span className="adm-game__name">{game.meta.name}</span>
          <StatusPill status={game.meta.status} />
        </div>
        <div className="adm-game__meta">
          <span className="adm-game__pin tabular">PIN {formatPin(game.meta.pin)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(game.meta.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{players} deltagare</span>
        </div>
      </a>
      <div className="adm-game__actions">
        <a className={`btn ${live ? 'btn--gold' : 'btn--ghost'} btn--sm adm-game__open`} href={href(`/admin/${gameId}`)}>
          {live ? 'Styr spelet →' : 'Öppna →'}
        </a>
        {game.meta.status === 'finished' && (
          <a className="btn btn--ghost btn--sm" href={href(`/results/${gameId}`)}>
            📜 Resultat
          </a>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn--danger btn--icon adm-iconbtn"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Radera spelet ${game.meta.name} (PIN ${game.meta.pin})`}
          title="Radera spelet"
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
