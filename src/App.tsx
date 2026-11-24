import { useEffect, useState, type ReactNode } from 'react';
import { Backdrop } from './components/Backdrop';
import { ConnectionBanner } from './components/ConnectionBanner';
import { LaunchGate } from './components/LaunchGate';
import { Loading } from './components/Loading';
import { Logo } from './components/Logo';
import { backend, isNoDatabaseError } from './lib/backend';
import { useRoute } from './lib/router';
import { AdminView } from './views/admin/AdminView';
import { HomeView } from './views/HomeView';
import { JoinView } from './views/player/JoinView';
import { PlayView } from './views/player/PlayView';
import { HallOfFameView } from './views/results/HallOfFameView';
import { ResultsView } from './views/results/ResultsView';
import { TvView } from './views/tv/TvView';

/** Väntar på en (anonym) session från servern innan något renderas. */
function BackendGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | Error>(backend.uid() ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    backend
      .ready()
      .then(() => !cancelled && setState('ready'))
      .catch((err: unknown) => !cancelled && setState(err instanceof Error ? err : new Error(String(err))));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state === 'loading') return <Loading full text="Bonsoir…" />;
  if (state instanceof Error) {
    return (
      <>
        <Backdrop bubbles={8} />
        <div className="setup-error stack-lg center">
          <Logo size="md" />
          <div className="card card--deco stack">
            <h3>Kunde inte ansluta</h3>
            <p className="muted">{state.message || 'Något gick fel – försök igen.'}</p>
            {isNoDatabaseError(state) && (
              <p className="hint">
                Skapa en Postgres-databas (Neon) under <strong>Storage</strong> i ditt Vercel-projekt och gör en ny
                deploy.
              </p>
            )}
            <button className="btn btn--gold" onClick={() => {
              setState('loading');
              setAttempt((a) => a + 1);
            }}>
              Försök igen
            </button>
          </div>
        </div>
      </>
    );
  }
  return <>{children}</>;
}

function Router() {
  const [section, id] = useRoute();
  switch (section) {
    case 'join':
      return <JoinView pin={id} />;
    case 'play':
      return id ? <PlayView gameId={id} /> : <HomeView />;
    case 'tv':
      return <TvView gameId={id} />;
    case 'admin':
      return <AdminView gameId={id} />;
    case 'results':
      return id ? <ResultsView gameId={id} /> : <HomeView />;
    case 'hall-of-fame':
      return <HallOfFameView />;
    default:
      return <HomeView />;
  }
}

export function App() {
  return (
    <LaunchGate>
      <BackendGate>
        <ConnectionBanner />
        <Router />
      </BackendGate>
    </LaunchGate>
  );
}
