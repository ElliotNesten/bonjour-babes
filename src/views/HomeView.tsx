import { useEffect, useState, type FormEvent } from 'react';
import { Backdrop } from '../components/Backdrop';
import { Logo } from '../components/Logo';
import { Ornament } from '../components/Ornament';
import { backend } from '../lib/backend';
import { findGameByPin, lastGame, loadGame, normalizePin } from '../lib/game';
import { href, navigate } from '../lib/router';

/** Startsidan: ange spel-PIN som i Kahoot. */
export function HomeView() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<{ gameId: string; pin: string; name: string } | null>(null);

  // Erbjud "Fortsätt" om man redan är med i ett pågående spel.
  useEffect(() => {
    const last = lastGame();
    if (!last) return;
    let cancelled = false;
    loadGame(last.gameId)
      .then((game) => {
        const uid = backend.uid();
        if (cancelled || !game || !uid || !game.players[uid] || game.meta.status === 'finished') return;
        setResume({ ...last, name: game.players[uid].name });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = normalizePin(pin);
    if (clean.length !== 6) {
      setError('PIN-koden har 6 siffror');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await findGameByPin(clean);
      if (!found) {
        setError('Hittade inget spel med den PIN-koden');
        return;
      }
      if (found.game.meta.status === 'finished') {
        navigate(`/results/${found.gameId}`);
        return;
      }
      const uid = backend.uid();
      if (uid && found.game.players[uid]) navigate(`/play/${found.gameId}`);
      else navigate(`/join/${clean}`);
    } catch {
      setError('Något gick fel – försök igen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Backdrop />
      <main className="page home">
        <div className="home__hero fade-up">
          <Logo size="lg" />
          <Ornament />
          <p className="home__tagline">Une soirée de cocktails · kvällens drinktävling</p>
        </div>

        {resume && (
          <a className="btn btn--bordeaux btn--block fade-up" href={href(`/play/${resume.gameId}`)}>
            Fortsätt som {resume.name} →
          </a>
        )}

        <form className="card card--deco card--gold stack fade-up" onSubmit={submit} style={{ animationDelay: '0.1s' }}>
          <label className="label center" htmlFor="pin">
            Spel-PIN
          </label>
          <input
            id="pin"
            className="input input--pin tabular"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            placeholder="000000"
            value={pin}
            onChange={(e) => {
              setPin(normalizePin(e.target.value));
              setError(null);
            }}
            aria-describedby="pin-hint"
          />
          {error ? (
            <div className="error center" role="alert">
              {error}
            </div>
          ) : (
            <div id="pin-hint" className="hint center">
              PIN-koden syns på storskärmen
            </div>
          )}
          <button className="btn btn--gold btn--lg btn--block" disabled={busy || pin.length !== 6}>
            {busy ? 'Letar…' : 'Gå med'}
          </button>
        </form>

        <nav className="home__links fade-up" style={{ animationDelay: '0.2s' }}>
          <a href={href('/hall-of-fame')}>🏆 Hall of Fame</a>
          <a href={href('/tv')}>📺 Storskärm</a>
          <a href={href('/admin')}>🔑 Admin</a>
        </nav>
      </main>
    </>
  );
}
