/** Guldig art deco-avdelare: linje – romb – linje. */
export function Ornament({ className = '', width }: { className?: string; width?: number | string }) {
  return (
    <div className={`ornament ${className}`} style={width ? { maxWidth: width } : undefined} aria-hidden="true">
      <span className="ornament__line" />
      <svg width="34" height="14" viewBox="0 0 34 14" fill="none">
        <path d="M17 1 L23 7 L17 13 L11 7 Z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M17 4.5 L19.5 7 L17 9.5 L14.5 7 Z" fill="currentColor" />
        <circle cx="4" cy="7" r="1.4" fill="currentColor" />
        <circle cx="30" cy="7" r="1.4" fill="currentColor" />
      </svg>
      <span className="ornament__line" />
    </div>
  );
}

/** Coupe-glas i guld (dekoration). */
export function CoupeIcon({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M10 18c0 9 10 15 22 15s22-6 22-15H10Z" fill="rgba(155,39,71,0.55)" />
      <path d="M10 18c0 9 10 15 22 15s22-6 22-15" stroke="#d9b26f" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 18h44" stroke="#f3dca5" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M32 33v18M22 55h20" stroke="#d9b26f" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="45" cy="12" r="3" fill="#f3dca5" />
      <circle cx="39" cy="7" r="1.6" fill="#f3dca5" opacity="0.7" />
    </svg>
  );
}
