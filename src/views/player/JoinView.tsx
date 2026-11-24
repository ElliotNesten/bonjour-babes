import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Backdrop } from '../../components/Backdrop';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { Ornament } from '../../components/Ornament';
import { findGameByPin, normalizePin } from '../../lib/game';
import { useGame, useUid } from '../../lib/hooks';
import { href, navigate } from '../../lib/router';
import { JoinForm } from './JoinForm';
import { formatPin } from './util';
import './player.css';

type Lookup = { pin: string; attempt: number } & ({ kind: 'found'; gameId: string } | { kind: 'notfound' } | { kind: 'error' });

/** #/join/:pin – "Bienvenue !" + namn och drink, som i Kahoot. */
export function JoinView({ pin }: { pin?: string }) {
  const uid = useUid();
  const cleanPin = normalizePin(pin ?? '');
  const valid = cleanPin.length === 6;
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    findGameByPin(cleanPin)
      .then((found) => {
        if (cancelled) return;
        setLookup(found ? { pin: cleanPin, attempt, kind: 'found', gameId: found.gameId } : { pin: cleanPin, attempt, kind: 'notfound' });
      })
      .catch(() => {
        if (!cancelled) setLookup({ pin: cleanPin, attempt, kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [cleanPin, valid, attempt]);

  const result = lookup && lookup.pin === cleanPin && lookup.attempt === attempt ? lookup : null;
  const gameId = result?.kind === 'found' ? result.gameId : null;
  const game = useGame(gameId);
  const isPlayer = !!game?.players[uid];

  // Redan med? Direkt till spelet.
  useEffect(() => {
    if (gameId && isPlayer) navigate(`/play/${gameId}`, true);
  }, [gameId, isPlayer]);

  if (!valid) {
    return (
      <Shell>
        <PinForm initial={cleanPin} />
      </Shell>
    );
  }

  if (!result || (gameId && game === undefined) || isPlayer) return <Loading full text="Letar efter spelet…" />;

  if (result.kind === 'error') {
    return (
      <Shell>
        <div className="card card--deco stack center">
          <h3 style={{ margin: 0 }}>Kunde inte ansluta</h3>
          <p className="muted" style={{ margin: 0 }}>
            Kontrollera din internetanslutning och försök igen.
          </p>
          <button className="btn btn--gold btn--block" onClick={() => setAttempt((a) => a + 1)}>
            Försök igen
          </button>
        </div>
        <BackHome />
      </Shell>
    );
  }

  if (result.kind === 'notfound' || !game || !gameId) {
    return (
      <Shell>
        <PinForm
          initial={cleanPin}
          error={`Hittade inget spel med PIN ${formatPin(cleanPin)}. Kolla koden på storskärmen.`}
          onSamePin={(p) => p === cleanPin && setAttempt((a) => a + 1)}
        />
      </Shell>
    );
  }

  const status = game.meta.status;

  if (status === 'finished') {
    return (
      <Shell>
        <div className="card card--deco card--gold stack center">
          <div className="eyebrow">C’est fini</div>
          <h3 style={{ margin: 0 }}>Tävlingen är avslutad 🥂</h3>
          <p className="muted" style={{ margin: 0 }}>
            Se hur det gick – placeringar, poäng och kvällens drinkar.
          </p>
          <a className="btn btn--gold btn--block" href={href(`/results/${gameId}`)}>
            Se resultaten
          </a>
        </div>
        <BackHome />
      </Shell>
    );
  }

  if (status !== 'lobby' && status !== 'running') {
    return (
      <Shell>
        <div className="card card--deco stack center">
          <div className="eyebrow">Désolé</div>
          <h3 style={{ margin: 0 }}>För sent för att gå med</h3>
          <p className="muted" style={{ margin: 0 }}>
            Alla drinkar är redan betygsatta. Häng med på prisutdelningen på storskärmen i stället ! 🍾
          </p>
        </div>
        <BackHome />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="card card--deco card--gold stack-lg">
        <div className="center stack" style={{ gap: 4 }}>
          {game.meta.name.trim().toLocaleLowerCase('sv') !== 'bonjour babes' && <div className="eyebrow">{game.meta.name}</div>}
          <div className="pl-pinline tabular">Spel-PIN {formatPin(game.meta.pin)}</div>
        </div>
        {status === 'running' && (
          <div className="pl-note center">Tävlingen har redan börjat – din drink hamnar sist i ordningen.</div>
        )}
        <JoinForm gameId={gameId} game={game} onJoined={() => navigate(`/play/${gameId}`, true)} />
      </div>
      <BackHome text="Fel spel? Ange en annan PIN" />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Backdrop />
      <main className="page pl-join">
        <header className="pl-join__hero fade-up">
          <Logo size="md" />
          <Ornament width={240} />
          <div className="pl-bienvenue script">Bienvenue !</div>
        </header>
        <div className="stack-lg fade-up" style={{ animationDelay: '0.08s' }}>
          {children}
        </div>
      </main>
    </>
  );
}

function BackHome({ text = 'Till startsidan' }: { text?: string }) {
  return (
    <a className="pl-backlink" href={href('/')}>
      ← {text}
    </a>
  );
}

function PinForm({
  initial,
  error: initialError,
  onSamePin,
}: {
  initial: string;
  error?: string;
  /** Anropas med den nya PIN-koden – för att kunna söka igen på samma PIN. */
  onSamePin?: (pin: string) => void;
}) {
  const [pin, setPin] = useState(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = normalizePin(pin);
    if (clean.length !== 6) {
      setError('PIN-koden har 6 siffror');
      return;
    }
    onSamePin?.(clean);
    navigate(`/join/${clean}`, true);
  };

  return (
    <>
      <form className="card card--deco card--gold stack" onSubmit={submit}>
        <label className="label center" htmlFor="pl-pin">
          Spel-PIN
        </label>
        <input
          id="pl-pin"
          className="input input--pin tabular"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          placeholder="000000"
          value={pin}
          autoFocus
          onChange={(e) => {
            setPin(normalizePin(e.target.value));
            setError(null);
          }}
          aria-describedby="pl-pin-msg"
        />
        {error ? (
          <div id="pl-pin-msg" className="error center" role="alert">
            {error}
          </div>
        ) : (
          <div id="pl-pin-msg" className="hint center">
            PIN-koden syns på storskärmen
          </div>
        )}
        <button className="btn btn--gold btn--lg btn--block" disabled={pin.length !== 6}>
          Gå med
        </button>
      </form>
      <BackHome />
    </>
  );
}
