import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { formatScore, placeLabel } from '../../lib/format';
import type { DrinkResult, Results } from '../../lib/scoring';
import { completedDrinkIds, effectiveOrder } from '../../lib/selectors';
import type { Game } from '../../lib/types';
import { fitSize, formatPin, siteAddress } from './tvHooks';

export type Medal = 'gold' | 'silver' | 'bronze' | 'none';

export function medalFor(rank: number): Medal {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'none';
}

export const MEDAL_FR: Record<Medal, string> = {
  gold: "La médaille d'or",
  silver: "La médaille d'argent",
  bronze: 'La médaille de bronze',
  none: 'Le classement',
};

/* ------------------------------------------------------------------ */
/*  Logga i hörnet                                                      */
/* ------------------------------------------------------------------ */

export function CornerLogo() {
  return (
    <div className="tv-corner-logo" aria-hidden="true">
      <span className="tv-corner-logo__bonjour">Bonjour</span>
      <span className="tv-corner-logo__babes">Babes</span>
    </div>
  );
}

/** Rubrikblock: eyebrow + titel + fransk/kursiv undertitel. */
export function Heading({ eyebrow, title, sub, size = 'lg', className = '' }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; size?: 'md' | 'lg' | 'xl'; className?: string }) {
  return (
    <header className={`tv-heading tv-heading--${size} ${className}`}>
      {eyebrow && <div className="tv-eyebrow">{eyebrow}</div>}
      <h1 className="tv-heading__title">{title}</h1>
      {sub && <div className="tv-heading__sub">{sub}</div>}
    </header>
  );
}

/** Liten diskret PIN-bricka för sena gäster. */
export function PinChip({ pin }: { pin: string }) {
  return (
    <div className="tv-pin-chip" aria-label={`Spel-PIN ${pin}`}>
      <span className="tv-pin-chip__live" aria-hidden="true" />
      <span className="tv-pin-chip__label">Gå med</span>
      <span className="tv-pin-chip__site">{siteAddress()}</span>
      <span className="tv-pin-chip__sep" aria-hidden="true">·</span>
      <span className="tv-pin-chip__label">PIN</span>
      <span className="tv-pin-chip__pin tabular">{formatPin(pin)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ordningslisten längst ner under tävlingen                          */
/* ------------------------------------------------------------------ */

export function OrderStrip({ game }: { game: Game }) {
  const order = effectiveOrder(game);
  const done = new Set(completedDrinkIds(game));
  const currentId = game.current?.drinkId;
  const n = order.length;
  const size = n <= 8 ? 64 : n <= 12 ? 56 : n <= 16 ? 44 : 36;
  const slot = n <= 8 ? 170 : n <= 12 ? 138 : n <= 16 ? 104 : 84;
  return (
    <nav className="tv-strip" aria-label="Kvällens ordning" style={{ '--slot': `${slot}px` } as CSSProperties}>
      <div className="tv-strip__track">
        {order.map((id, i) => {
          const p = game.players[id];
          const isCurrent = id === currentId;
          const isDone = done.has(id);
          return (
            <div key={id} className={`tv-strip__item ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}>
              <span className="tv-strip__num tabular">{i + 1}</span>
              <Avatar
                emoji={p.emoji}
                color={p.color}
                size={isCurrent ? Math.round(size * 1.35) : size}
                ring={isCurrent}
                dim={!isCurrent && !isDone}
                badge={isDone ? '✓' : undefined}
              />
              <span className="tv-strip__name">{p.name}</span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Rösträknare med ring                                               */
/* ------------------------------------------------------------------ */

export function ProgressRing({ done, total, size = 360, children }: { done: number; total: number; size?: number; children?: ReactNode }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className={`tv-ring ${total > 0 && done >= total ? 'is-full' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="tv-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbefcb" />
            <stop offset="0.5" stopColor="#d9b26f" />
            <stop offset="1" stopColor="#a8823f" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} className="tv-ring__track" />
        {Array.from({ length: Math.max(0, total) }, (_, i) => {
          const a = (i / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
          return <circle key={i} cx={50 + Math.cos(a) * r} cy={50 + Math.sin(a) * r} r={0.9} className="tv-ring__tick" />;
        })}
        <circle
          cx="50"
          cy="50"
          r={r}
          className="tv-ring__bar"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="tv-ring__content">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cocktailshaker (dekor)                                             */
/* ------------------------------------------------------------------ */

export function ShakerArt({ size = 220, still = false }: { size?: number; still?: boolean }) {
  return (
    <div className={`tv-shaker ${still ? 'is-still' : ''}`} style={{ width: size * 0.6, height: size }} aria-hidden="true">
      <svg viewBox="0 0 72 120" width={size * 0.6} height={size} className="tv-shaker__svg">
        <defs>
          <linearGradient id="tv-shaker-body" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#6e5020" />
            <stop offset="0.2" stopColor="#d9b26f" />
            <stop offset="0.4" stopColor="#fbefcb" />
            <stop offset="0.62" stopColor="#d9b26f" />
            <stop offset="1" stopColor="#5f441a" />
          </linearGradient>
        </defs>
        <rect x="27" y="2" width="18" height="11" rx="4" fill="url(#tv-shaker-body)" />
        <path d="M25 13 H47 L54 38 H18 Z" fill="url(#tv-shaker-body)" />
        <rect x="14" y="38" width="44" height="7" rx="2" fill="#f3dca5" />
        <path d="M16 46 H56 L50 110 Q49 116 43 116 H29 Q23 116 22 110 Z" fill="url(#tv-shaker-body)" />
        <path d="M27 62 L36 53 L45 62 M30 70 L36 64 L42 70" stroke="#0a0910" strokeOpacity="0.3" strokeWidth="1.4" fill="none" />
        <path d="M36 74 V104" stroke="#0a0910" strokeOpacity="0.2" strokeWidth="1.2" />
        <path d="M23 50 L28 108" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {!still && (
        <>
          <span className="tv-shaker__drop" style={{ left: '2%', animationDelay: '0s' }} />
          <span className="tv-shaker__drop" style={{ left: '88%', animationDelay: '0.4s' }} />
          <span className="tv-shaker__drop" style={{ left: '14%', animationDelay: '0.8s' }} />
          <span className="tv-shaker__drop" style={{ left: '76%', animationDelay: '1.2s' }} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Strålkastare                                                        */
/* ------------------------------------------------------------------ */

export function Spotlights({ mode = 'idle' }: { mode?: 'idle' | 'sweep' | 'focus' }) {
  return (
    <div className={`tv-spots tv-spots--${mode}`} aria-hidden="true">
      <span className="tv-spots__beam tv-spots__beam--l" />
      <span className="tv-spots__beam tv-spots__beam--r" />
      <span className="tv-spots__pool" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Prispallen                                                          */
/* ------------------------------------------------------------------ */

export function Podium({ results, compact = false, animate = true }: { results: Results; compact?: boolean; animate?: boolean }) {
  const top = results.ranking.slice(0, 3);
  // Klassisk uppställning: 2 – 1 – 3
  const layout: { d: DrinkResult; slot: 'left' | 'center' | 'right' }[] = [];
  if (top[1]) layout.push({ d: top[1], slot: 'left' });
  if (top[0]) layout.push({ d: top[0], slot: 'center' });
  if (top[2]) layout.push({ d: top[2], slot: 'right' });
  const order: Record<string, number> = { right: 0, left: 1, center: 2 };
  return (
    <div className={`tv-podium ${compact ? 'tv-podium--compact' : ''} ${animate ? 'is-animated' : ''}`}>
      {layout.map(({ d, slot }) => {
        const medal = medalFor(d.rank);
        const nameSize = fitSize(d.name, compact ? 34 : 44, compact ? 22 : 26, 12);
        const drinkSize = fitSize(d.drink, compact ? 24 : 30, compact ? 16 : 19, 18);
        return (
          <div
            key={d.playerId}
            className={`tv-podium__col tv-podium__col--${slot} medal-${medal}`}
            style={{ '--i': order[slot] } as CSSProperties}
          >
            <div className="tv-podium__who">
              <Avatar emoji={d.emoji} color={d.color} size={slot === 'center' ? (compact ? 132 : 170) : compact ? 104 : 136} ring={slot === 'center'} />
              <div className="tv-podium__name" style={{ fontSize: nameSize }}>
                {d.name}
              </div>
              <div className="tv-podium__drink" style={{ fontSize: drinkSize }}>
                {d.drink}
              </div>
            </div>
            <div className="tv-podium__block">
              <span className="tv-podium__rank">{d.rank}</span>
              <span className="tv-podium__score tabular">{formatScore(d.score)}</span>
              <span className="tv-podium__place">{placeLabel(d.rank)} plats</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
