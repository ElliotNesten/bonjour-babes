import { useCallback, useEffect, useRef, useState } from 'react';
import { Loading } from '../../components/Loading';
import { useGame, useUid, useWakeLock } from '../../lib/hooks';
import { href } from '../../lib/router';
import { AWARD_IDS } from '../../lib/scoring';
import { awardVoteProgress, hasVoted } from '../../lib/selectors';
import type { Game } from '../../lib/types';
import { JoinForm } from '../player/JoinForm';
import { PlayerGame } from '../player/PlayerGame';
import { AwardsPanel } from './AwardsPanel';
import { CeremonyPanel } from './CeremonyPanel';
import { useFeedback } from './feedback';
import { FinishedPanel } from './FinishedPanel';
import { LobbyPanel } from './LobbyPanel';
import type { PanelProps } from './panelTypes';
import { formatPin, StatusPill } from './parts';
import { RunningPanel } from './RunningPanel';

type Tab = 'control' | 'me';

/** Admin styr ett spel: header, flikarna "Styr" och "Min röst". */
export function GameControl({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const uid = useUid();
  const [tab, setTab] = useTab(gameId);
  const [sentinelRef, stuck] = useStuck();
  useWakeLock(!!game && game.meta.status !== 'finished');
  useJoinNotifier(game);

  if (game === undefined) {
    return (
      <main className="page adm-page">
        <Loading text="Hämtar spelet…" />
      </main>
    );
  }
  if (game === null) return <GameMissing />;

  const badge = myVoteNeeded(game, uid);
  const panelProps: PanelProps = { game, gameId, uid, active: tab === 'control', onMyVote: () => setTab('me') };

  return (
    <main className="page adm-page">
      <GameHeader game={game} gameId={gameId} />

      <div ref={sentinelRef} className="adm-tabs-sentinel" aria-hidden="true" />
      <div className={`adm-tabs ${stuck ? 'is-stuck' : ''}`} role="tablist" aria-label="Adminvy">
        <button
          type="button"
          role="tab"
          id="adm-tab-control"
          aria-selected={tab === 'control'}
          aria-controls="adm-panel-control"
          className={`adm-tab ${tab === 'control' ? 'is-active' : ''}`}
          onClick={() => setTab('control')}
        >
          <span aria-hidden="true">🎛️</span> Styr
        </button>
        <button
          type="button"
          role="tab"
          id="adm-tab-me"
          aria-selected={tab === 'me'}
          aria-controls="adm-panel-me"
          className={`adm-tab ${tab === 'me' ? 'is-active' : ''}`}
          onClick={() => setTab('me')}
        >
          <span aria-hidden="true">🗳️</span> Min röst
          {badge && (
            <span className="adm-tab__badge" aria-label="– din röst saknas">
              <span aria-hidden="true">!</span>
            </span>
          )}
        </button>
      </div>

      <section id="adm-panel-control" role="tabpanel" aria-labelledby="adm-tab-control" className="adm-tabpanel" hidden={tab !== 'control'}>
        <StatusPanel {...panelProps} />
      </section>
      <section id="adm-panel-me" role="tabpanel" aria-labelledby="adm-tab-me" className="adm-tabpanel adm-tabpanel--me" hidden={tab !== 'me'}>
        <MyVote game={game} gameId={gameId} uid={uid} />
      </section>
    </main>
  );
}

function StatusPanel(props: PanelProps) {
  switch (props.game.meta.status) {
    case 'lobby':
      return <LobbyPanel {...props} />;
    case 'running':
      return <RunningPanel {...props} />;
    case 'awards':
      return <AwardsPanel {...props} />;
    case 'ceremony':
      return <CeremonyPanel {...props} />;
    case 'finished':
      return <FinishedPanel {...props} />;
  }
}

function GameHeader({ game, gameId }: { game: Game; gameId: string }) {
  return (
    <header className="adm-header fade-up">
      <div className="adm-topbar">
        <a className="adm-backlink" href={href('/admin')}>
          ← Alla spel
        </a>
        <a className="btn btn--ghost btn--sm adm-btn-44" href={href(`/tv/${gameId}`)} target="_blank" rel="noopener noreferrer">
          📺 Storskärm
        </a>
      </div>
      <div className="adm-header__main">
        <div className="grow adm-header__titles">
          <div className="eyebrow">Admin · Bonsoir</div>
          <h1 className="adm-header__name">{game.meta.name}</h1>
          <StatusPill status={game.meta.status} />
        </div>
        <div className="adm-header__pin" aria-label={`PIN ${game.meta.pin}`}>
          <span className="adm-header__pin-label">PIN</span>
          <span className="adm-header__pin-digits gold-text tabular">{formatPin(game.meta.pin)}</span>
        </div>
      </div>
    </header>
  );
}

/** Fliken "Min röst": admin är också deltagare. */
function MyVote({ game, gameId, uid }: { game: Game; gameId: string; uid: string }) {
  const { toast } = useFeedback();
  if (game.players[uid]) return <PlayerGame gameId={gameId} game={game} embedded />;
  if (game.meta.status === 'lobby' || game.meta.status === 'running') {
    return (
      <div className="card card--deco card--gold stack-lg adm-me-join">
        <div className="center">
          <div className="eyebrow">Moi aussi !</div>
          <h2 className="adm-me-join__title">Gå med som deltagare</h2>
          <p className="muted" style={{ margin: 0 }}>
            Du gör väl också en drink? Gå med så kommer din drink med i ordningen och du kan rösta på de andras – direkt här i
            adminpanelen.
          </p>
        </div>
        <JoinForm gameId={gameId} game={game} onJoined={() => toast('Bienvenue ! Du är med i tävlingen 🍸', 'success')} />
      </div>
    );
  }
  return (
    <div className="card adm-empty center">
      <div className="adm-empty__icon" aria-hidden="true">
        🥂
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Du är inte med som deltagare i det här spelet – luta dig tillbaka och njut av showen.
      </p>
    </div>
  );
}

function GameMissing() {
  return (
    <main className="page adm-page adm-missing">
      <div className="card card--deco stack center fade-up">
        <div className="adm-empty__icon" aria-hidden="true">
          🫗
        </div>
        <h2 style={{ margin: 0 }}>Spelet finns inte</h2>
        <p className="muted" style={{ margin: 0 }}>
          Det kan ha raderats. Gå tillbaka till listan och välj ett annat spel eller skapa ett nytt.
        </p>
        <a className="btn btn--gold btn--block" href={href('/admin')}>
          ← Alla spel
        </a>
      </div>
    </main>
  );
}

/** Behöver admin rösta just nu (som deltagare)? Visas som en bricka på fliken "Min röst". */
export function myVoteNeeded(game: Game, uid: string): boolean {
  const me = game.players[uid];
  if (!me || me.manual) return false;
  if (game.meta.status === 'running' && game.current?.phase === 'voting') {
    const drinkId = game.current.drinkId;
    return drinkId !== uid && !!game.players[drinkId] && !hasVoted(game, drinkId, uid);
  }
  if (game.meta.status === 'awards' && game.settings.awardsEnabled) {
    const mine = awardVoteProgress(game, AWARD_IDS).find((p) => p.playerId === uid);
    return !!mine && mine.done < mine.total;
  }
  return false;
}

/** Vald flik – sparas per spel i sessionStorage så att en omladdning visar samma vy. */
function useTab(gameId: string): [Tab, (t: Tab) => void] {
  const key = `bonjour-babes:admin-tab:${gameId}`;
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return sessionStorage.getItem(key) === 'me' ? 'me' : 'control';
    } catch {
      return 'control';
    }
  });
  const setTab = useCallback(
    (t: Tab) => {
      setTabState(t);
      try {
        sessionStorage.setItem(key, t);
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0 });
    },
    [key],
  );
  return [tab, setTab];
}

/** true när flikraden har fastnat i toppen (sentinel-elementet har scrollat ur bild). */
function useStuck(): [(el: HTMLDivElement | null) => void, boolean] {
  const [stuck, setStuck] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    observer.current = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, stuck];
}

/** Toast när någon går med medan tävlingen pågår (de hamnar sist i ordningen). */
function useJoinNotifier(game: Game | null | undefined) {
  const { toast } = useFeedback();
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!game) return;
    const ids = Object.keys(game.players);
    const prev = known.current;
    known.current = new Set(ids);
    if (!prev || game.meta.status !== 'running') return;
    for (const id of ids) {
      const p = game.players[id];
      if (!prev.has(id) && !p.manual) toast(`${p.name} gick med – ${p.drink} lades sist i ordningen`, 'info');
    }
  }, [game, toast]);
}
