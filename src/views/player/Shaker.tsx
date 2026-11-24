import { useId } from 'react';

/** Cocktailshaker i guld som skakas – visas medan någon blandar sin drink. */
export function Shaker({ size = 120, still = false }: { size?: number; still?: boolean }) {
  const id = useId().replace(/:/g, '');
  const body = `pl-sh-body-${id}`;
  const shine = `pl-sh-shine-${id}`;
  return (
    <div className={`pl-shaker ${still ? 'is-still' : ''}`} style={{ width: size * 0.6, height: size }} aria-hidden="true">
      <svg className="pl-shaker__svg" viewBox="0 0 72 120" width={size * 0.6} height={size}>
        <defs>
          <linearGradient id={body} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#7d5c25" />
            <stop offset="0.22" stopColor="#d9b26f" />
            <stop offset="0.42" stopColor="#fbefcb" />
            <stop offset="0.62" stopColor="#d9b26f" />
            <stop offset="1" stopColor="#6e5020" />
          </linearGradient>
          <linearGradient id={shine} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Lock */}
        <rect x="27" y="2" width="18" height="11" rx="4" fill={`url(#${body})`} />
        {/* Silhuvud */}
        <path d="M25 13 H47 L54 38 H18 Z" fill={`url(#${body})`} />
        {/* Band */}
        <rect x="14" y="38" width="44" height="7" rx="2" fill="#f3dca5" />
        <rect x="14" y="44" width="44" height="2" fill="#0a0910" opacity="0.25" />
        {/* Kropp */}
        <path d="M16 46 H56 L50 110 Q49 116 43 116 H29 Q23 116 22 110 Z" fill={`url(#${body})`} />
        {/* Art deco-dekor */}
        <path d="M27 62 L36 53 L45 62 M30 70 L36 64 L42 70" stroke="#0a0910" strokeOpacity="0.28" strokeWidth="1.4" fill="none" />
        <path d="M36 74 V104" stroke="#0a0910" strokeOpacity="0.18" strokeWidth="1.2" />
        {/* Glans */}
        <path d="M22 50 L27 108" stroke={`url(#${shine})`} strokeWidth="3.5" strokeLinecap="round" />
      </svg>
      {!still && (
        <>
          <span className="pl-shaker__drop" style={{ left: '8%', animationDelay: '0s' }} />
          <span className="pl-shaker__drop" style={{ left: '82%', animationDelay: '0.35s' }} />
          <span className="pl-shaker__drop" style={{ left: '18%', animationDelay: '0.7s' }} />
          <span className="pl-shaker__drop" style={{ left: '72%', animationDelay: '1.05s' }} />
        </>
      )}
    </div>
  );
}
