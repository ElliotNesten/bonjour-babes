import type { CSSProperties } from 'react';

export interface AvatarProps {
  emoji: string;
  color: string;
  size?: number;
  /** Guldring (t.ex. "har röstat"). */
  ring?: boolean;
  /** Nedtonad (t.ex. "har inte röstat än"). */
  dim?: boolean;
  /** Liten bricka nere till höger, t.ex. "✓" eller placering. */
  badge?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Avatar({ emoji, color, size = 44, ring, dim, badge, title, className = '', style }: AvatarProps) {
  return (
    <span
      className={`avatar ${ring ? 'avatar--ring' : ''} ${dim ? 'avatar--dim' : ''} ${className}`}
      style={{ '--size': `${size}px`, background: `radial-gradient(circle at 35% 30%, ${color}ee, ${color} 60%, #00000055)`, ...style } as CSSProperties}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <span aria-hidden="true">{emoji}</span>
      {badge && <span className="avatar__badge">{badge}</span>}
    </span>
  );
}
