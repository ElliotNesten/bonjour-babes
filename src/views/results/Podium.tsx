import { useId } from 'react';
import { Avatar } from '../../components/Avatar';
import { formatScore, placeLabel } from '../../lib/format';
import type { DrinkResult } from '../../lib/scoring';

/**
 * Prispallen 2–1–3. Listan ligger i placeringsordning i DOM:en (bra för
 * skärmläsare) och flyttas om visuellt med CSS order.
 */
export function Podium({ ranking }: { ranking: DrinkResult[] }) {
  const top = ranking.slice(0, 3);
  if (!top.length) return null;
  return (
    <ol className={`res-podium res-podium--${top.length}`} aria-label="Prispallen">
      {top.map((d, pos) => {
        const tier = Math.min(3, Math.max(1, d.rank));
        return (
          <li key={d.playerId} className={`res-podium__col res-podium__col--p${pos} res-medal--${tier}`}>
            <div className="res-podium__who">
              <span className="res-sr">{placeLabel(d.rank)} plats: </span>
              {tier === 1 && <Crown />}
              <Avatar emoji={d.emoji} color={d.color} size={tier === 1 ? 80 : 62} badge={String(d.rank)} className="res-podium__avatar" />
              <div className={`res-podium__name ${tier === 1 ? 'gold-text' : ''}`}>{d.name}</div>
              <div className="res-podium__drink">”{d.drink}”</div>
            </div>
            <div className="res-podium__block">
              <span className="res-podium__score tabular">{formatScore(d.score)}</span>
              <span className="res-podium__label">{d.score === null ? 'inga röster' : 'poäng'}</span>
              <span className="res-podium__place" aria-hidden="true">
                {d.rank}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Crown() {
  const id = `res-crown-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className="res-crown" width="44" height="28" viewBox="0 0 44 28" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c8" />
          <stop offset="0.5" stopColor="#e9c46a" />
          <stop offset="1" stopColor="#9a7023" />
        </linearGradient>
      </defs>
      <path d="M5 22 L2 7 L12 14 L22 2 L32 14 L42 7 L39 22 Z" fill={`url(#${id})`} />
      <rect x="5" y="23" width="34" height="4" rx="1" fill={`url(#${id})`} />
      <circle cx="2" cy="7" r="2.2" fill="#fff6da" />
      <circle cx="22" cy="2.4" r="2.4" fill="#fff6da" />
      <circle cx="42" cy="7" r="2.2" fill="#fff6da" />
      <path d="M22 11 L25 15 L22 19 L19 15 Z" fill="#9b2747" />
    </svg>
  );
}
