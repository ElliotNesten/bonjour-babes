import { useEffect, useState, type ReactNode } from 'react';
import { Backdrop } from './Backdrop';
import { Logo } from './Logo';
import { Ornament } from './Ornament';
import './launch.css';

/**
 * När sidan öppnar: midnatt mellan fredag 27 och lördag 28 november, svensk tid (CET, UTC+1).
 * Fram till dess täcker en nedräkning hela sidan. Ändra tiden här för en annan kväll.
 */
export const OPENS_AT = new Date('2026-11-28T00:00:00+01:00').getTime();

/**
 * Förhandsvisning före öppning (för värden): lägg till ?apercu i adressen, t.ex.
 * https://…vercel.app/?apercu#/admin – gäller sedan i den webbläsaren. ?apercu=av stänger av den.
 */
const PREVIEW_KEY = 'bonjour-babes:apercu';

function readPreviewFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('apercu')) {
      const value = params.get('apercu');
      if (value === 'av' || value === 'off' || value === '0') window.localStorage.removeItem(PREVIEW_KEY);
      else window.localStorage.setItem(PREVIEW_KEY, '1');
      params.delete('apercu');
      const search = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
    }
    return window.localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

const preview = readPreviewFlag();

/** Hur länge slöjan tonar bort när klockan slår tolv. */
const REVEAL_MS = 2600;

type GateState = 'closed' | 'revealing' | 'open';

export function LaunchGate({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<GateState>(() => (preview || Date.now() >= OPENS_AT ? 'open' : 'closed'));

  useEffect(() => {
    if (state !== 'closed') return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= OPENS_AT) setState('revealing');
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state !== 'revealing') return;
    const id = window.setTimeout(() => setState('open'), REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  if (state === 'open') return <>{children}</>;
  return (
    <>
      {state === 'revealing' && children}
      <LaunchScreen remaining={Math.max(0, OPENS_AT - now)} revealing={state === 'revealing'} />
    </>
  );
}

function LaunchScreen({ remaining, revealing }: { remaining: number; revealing: boolean }) {
  const total = Math.ceil(remaining / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const units = [
    ...(days > 0 ? [{ value: String(days), label: days === 1 ? 'dag' : 'dagar' }] : []),
    { value: String(hours).padStart(2, '0'), label: 'timmar' },
    { value: String(minutes).padStart(2, '0'), label: 'minuter' },
    { value: String(seconds).padStart(2, '0'), label: 'sekunder' },
  ];

  return (
    <div className={`launch ${revealing ? 'launch--reveal' : ''}`} role="dialog" aria-modal="true" aria-label="Bonjour Babes öppnar vid midnatt">
      <Backdrop bubbles={24} />
      <div className="launch__spot" aria-hidden="true" />
      <Sparkles />
      <div className="launch__frame" aria-hidden="true">
        <span className="launch__corner launch__corner--tl" />
        <span className="launch__corner launch__corner--tr" />
        <span className="launch__corner launch__corner--bl" />
        <span className="launch__corner launch__corner--br" />
      </div>

      <main className="launch__inner">
        <p className="launch__kicker">Mesdames et messieurs</p>
        <Logo size="xl" className="launch__logo" />
        <Ornament className="launch__ornament" width={260} />

        <Drinks />

        {revealing ? (
          <p className="launch__open">C’est l’heure&nbsp;!</p>
        ) : (
          <>
            <p className="launch__lead">Les portes s’ouvrent à minuit</p>
            <div className="launch__countdown" role="timer" aria-live="off">
              {units.map((u, i) => (
                <div key={u.label} className="launch__unit-wrap">
                  {i > 0 && <span className="launch__sep" aria-hidden="true">◆</span>}
                  <div className="launch__unit">
                    <span className="launch__num">{u.value}</span>
                    <span className="launch__label">{u.label}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="launch__date">
              <span>Natten mellan fredag och lördag</span>
              <span className="launch__date-dot" aria-hidden="true"> · </span>
              <span>28 november</span>
            </p>
          </>
        )}

        <p className="launch__script">Santé, mes chéris</p>
      </main>
    </div>
  );
}

/** Tre drinkar i guld: martini med oliv, coupe med körsbär och champagneflöjt med bubblor. */
function Drinks() {
  return (
    <div className="launch__drinks" aria-hidden="true">
      <svg className="launch__glass launch__glass--martini" viewBox="0 0 80 120" fill="none">
        <path d="M12 26 L68 26 L40 62 Z" fill="url(#bb-gin)" />
        <path d="M8 22 L72 22 L40 62 Z" stroke="#d9b26f" strokeWidth="2" strokeLinejoin="round" />
        <path d="M40 62 V104" stroke="#d9b26f" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="40" cy="107" rx="15" ry="3.2" stroke="#d9b26f" strokeWidth="2" />
        <path d="M58 6 L33 46" stroke="#f3dca5" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="39" cy="36" r="5.2" fill="#7e8f3c" stroke="#5d6b28" strokeWidth="1" />
        <circle cx="37.6" cy="34.8" r="1.7" fill="#c9374a" />
        <defs>
          <linearGradient id="bb-gin" x1="40" y1="26" x2="40" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f6ead0" stopOpacity="0.34" />
            <stop offset="1" stopColor="#d9b26f" stopOpacity="0.12" />
          </linearGradient>
        </defs>
      </svg>

      <svg className="launch__glass launch__glass--coupe" viewBox="0 0 100 120" fill="none">
        <defs>
          <linearGradient id="bb-wine" x1="50" y1="34" x2="50" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#c23a5e" />
            <stop offset="1" stopColor="#5a0f27" />
          </linearGradient>
          <clipPath id="bb-coupe-bowl">
            <path d="M14 36 C14 56 30 66 50 66 C70 66 86 56 86 36 Z" />
          </clipPath>
        </defs>
        <path d="M14 36 C14 56 30 66 50 66 C70 66 86 56 86 36 Z" fill="url(#bb-wine)" opacity="0.9" />
        <g clipPath="url(#bb-coupe-bowl)">
          <circle className="launch__bubble" cx="38" cy="64" r="1.6" fill="#f3dca5" />
          <circle className="launch__bubble launch__bubble--b" cx="52" cy="64" r="1.2" fill="#f3dca5" />
          <circle className="launch__bubble launch__bubble--c" cx="64" cy="64" r="1.4" fill="#f3dca5" />
        </g>
        <path d="M10 32 C10 56 28 68 50 68 C72 68 90 56 90 32" stroke="#d9b26f" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M10 32 H90" stroke="#f3dca5" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M50 68 V104" stroke="#d9b26f" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="50" cy="107" rx="18" ry="3.6" stroke="#d9b26f" strokeWidth="2.2" />
        <path d="M76 31 C77 22 81 15 87 10" stroke="#5d6b28" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="76" cy="34" r="6" fill="#b3122f" />
        <circle cx="74" cy="32" r="1.8" fill="#ff8aa0" opacity="0.8" />
      </svg>

      <svg className="launch__glass launch__glass--flute" viewBox="0 0 60 120" fill="none">
        <defs>
          <linearGradient id="bb-champ" x1="30" y1="12" x2="30" y2="70" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fbefcb" stopOpacity="0.9" />
            <stop offset="1" stopColor="#d9a84f" stopOpacity="0.85" />
          </linearGradient>
          <clipPath id="bb-flute-bowl">
            <path d="M19 18 L41 18 L38 64 C37 71 23 71 22 64 Z" />
          </clipPath>
        </defs>
        <path d="M19 18 L41 18 L38 64 C37 71 23 71 22 64 Z" fill="url(#bb-champ)" />
        <g clipPath="url(#bb-flute-bowl)">
          <circle className="launch__bubble" cx="27" cy="68" r="1.2" fill="#fffaf0" />
          <circle className="launch__bubble launch__bubble--b" cx="32" cy="68" r="1" fill="#fffaf0" />
          <circle className="launch__bubble launch__bubble--c" cx="35" cy="68" r="1.3" fill="#fffaf0" />
          <circle className="launch__bubble launch__bubble--d" cx="29" cy="68" r="0.9" fill="#fffaf0" />
        </g>
        <path d="M17 8 L43 8 L39 66 C38 74 22 74 21 66 Z" stroke="#d9b26f" strokeWidth="2" strokeLinejoin="round" />
        <path d="M30 73 V104" stroke="#d9b26f" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="30" cy="107" rx="13" ry="3" stroke="#d9b26f" strokeWidth="2" />
      </svg>
    </div>
  );
}

/** Små guldstjärnor som glimmar till här och där. */
function Sparkles() {
  const spots = [
    { left: '12%', top: '14%', delay: '0s', size: 10 },
    { left: '84%', top: '18%', delay: '1.2s', size: 8 },
    { left: '8%', top: '62%', delay: '2.1s', size: 7 },
    { left: '90%', top: '58%', delay: '0.6s', size: 11 },
    { left: '22%', top: '86%', delay: '1.7s', size: 8 },
    { left: '76%', top: '84%', delay: '2.6s', size: 9 },
  ];
  return (
    <div className="launch__sparkles" aria-hidden="true">
      {spots.map((s, i) => (
        <svg key={i} className="launch__sparkle" style={{ left: s.left, top: s.top, animationDelay: s.delay }} width={s.size * 2} height={s.size * 2} viewBox="0 0 20 20">
          <path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill="#f3dca5" />
        </svg>
      ))}
    </div>
  );
}
