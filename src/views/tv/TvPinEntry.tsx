import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CoupeIcon, Ornament } from '../../components/Ornament';
import { Logo } from '../../components/Logo';
import { findGameByPin, lastGame, normalizePin } from '../../lib/game';
import { href, navigate } from '../../lib/router';

/** Storskärm utan spel: ange PIN så kopplas skärmen till spelet. */
export function TvPinEntry() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const recent = lastGame();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
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
        input.current?.select();
        return;
      }
      navigate(`/tv/${found.gameId}`);
    } catch {
      setError('Något gick fel – försök igen');
    } finally {
      setBusy(false);
    }
  };

  const digits = pin.padEnd(6, ' ').split('');

  return (
    <main className="tv-screen tv-pin">
      <div className="tv-pin__hero fade-up">
        <Logo size="xl" className="tv-pin__logo" />
        <Ornament className="tv-pin__orn" />
        <div className="tv-eyebrow">L'écran de la soirée · Storskärmen</div>
      </div>

      <form className="tv-pin__form fade-up" style={{ animationDelay: '0.12s' }} onSubmit={submit}>
        <label className="tv-pin__label" htmlFor="tv-pin-input">
          Ange spelets PIN
        </label>
        <div className={`tv-pin__boxes ${error ? 'has-error' : ''}`} onClick={() => input.current?.focus()}>
          {digits.map((d, i) => (
            <span key={i} className={`tv-pin__box ${d.trim() ? 'is-filled' : ''} ${i === pin.length ? 'is-caret' : ''}`}>
              {d.trim()}
            </span>
          ))}
          <input
            id="tv-pin-input"
            ref={input}
            className="tv-pin__input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPin(normalizePin(e.target.value));
              setError(null);
            }}
            aria-describedby="tv-pin-hint"
            aria-invalid={!!error}
          />
        </div>
        <div id="tv-pin-hint" className={`tv-pin__hint ${error ? 'is-error' : ''}`} role={error ? 'alert' : undefined}>
          {error ?? 'PIN-koden hittar du i adminvyn'}
        </div>
        <button className="btn btn--gold tv-pin__btn" disabled={busy || pin.length !== 6}>
          {busy ? 'Letar…' : 'Visa på storskärmen'}
        </button>
        {recent && (
          <a className="tv-pin__recent" href={href(`/tv/${recent.gameId}`)}>
            <CoupeIcon size={28} /> Senaste spelet · PIN {recent.pin}
          </a>
        )}
      </form>
    </main>
  );
}
