import { useEffect, useState, type ReactNode } from 'react';
import { Backdrop } from '../../components/Backdrop';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { rememberGame } from '../../lib/game';
import { useGame, useUid, useWakeLock } from '../../lib/hooks';
import { href } from '../../lib/router';
import { JoinForm } from './JoinForm';
import { PlayerGame } from './PlayerGame';
import './player.css';

/** #/play/:gameId – spelarens mobilvy. All state kommer från databasen, så en omladdning återställer skärmen. */
export function PlayView({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const uid = useUid();
  useWakeLock();

  const me = game?.players[uid];
  const [wasPlayer, setWasPlayer] = useState(false);
  useEffect(() => {
    if (me) setWasPlayer(true);
  }, [me]);

  // Kom ihåg spelet för "Fortsätt som …" på startsidan.
  const pin = game?.meta.pin;
  useEffect(() => {
    if (me && pin) rememberGame(gameId, pin);
  }, [gameId, pin, me]);

  if (game === undefined) return <Loading full text="Bonsoir…" />;

  if (game === null) {
    return (
      <Shell>
        <div className="card card--deco stack center">
          <div className="eyebrow">Oups !</div>
          <h3 style={{ margin: 0 }}>Hittade inte spelet</h3>
          <p className="muted" style={{ margin: 0 }}>
            Spelet kan ha raderats, eller så är länken fel. Ange PIN-koden från storskärmen igen.
          </p>
          <a className="btn btn--gold btn--block" href={href('/')}>
            Ange PIN
          </a>
        </div>
      </Shell>
    );
  }

  if (!me) {
    const status = game.meta.status;
    const open = status === 'lobby' || status === 'running';
    return (
      <Shell>
        {wasPlayer && (
          <div className="pl-note center" role="status">
            Du är inte längre med i spelet – värden kan ha tagit bort dig.
            {open ? ' Gå med igen nedan.' : ''}
          </div>
        )}
        {open ? (
          <div className="card card--deco card--gold stack-lg">
            <div className="center stack" style={{ gap: 4 }}>
              <div className="pl-bienvenue script">Bienvenue !</div>
              <div className="eyebrow">{game.meta.name}</div>
            </div>
            <JoinForm gameId={gameId} game={game} onJoined={() => {}} />
          </div>
        ) : (
          <div className="card card--deco stack center">
            <h3 style={{ margin: 0 }}>{status === 'finished' ? 'Tävlingen är avslutad 🥂' : 'För sent för att gå med'}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {status === 'finished'
                ? 'Se hur det gick för alla drinkar.'
                : 'Alla drinkar är redan betygsatta – häng med på prisutdelningen på storskärmen !'}
            </p>
            {status === 'finished' && (
              <a className="btn btn--gold btn--block" href={href(`/results/${gameId}`)}>
                Se resultaten
              </a>
            )}
            <a className="btn btn--ghost btn--block" href={href('/')}>
              Till startsidan
            </a>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <>
      <Backdrop bubbles={12} />
      <main className="page pl-page">
        <PlayerGame gameId={gameId} game={game} />
      </main>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Backdrop />
      <main className="page pl-join">
        <header className="pl-join__hero pl-join__hero--sm fade-up">
          <Logo size="md" />
        </header>
        <div className="stack-lg fade-up" style={{ animationDelay: '0.08s' }}>
          {children}
        </div>
      </main>
    </>
  );
}
