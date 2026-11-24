import { useMemo } from 'react';

/** Fast bakgrund med bordeauxglöd, art deco-solfjäder och uppstigande champagnebubblor. */
export function Backdrop({ bubbles = 18, fan = true }: { bubbles?: number; fan?: boolean }) {
  const items = useMemo(
    () =>
      Array.from({ length: bubbles }, (_, i) => {
        const size = 3 + ((i * 37) % 9);
        return {
          left: `${(i * 53 + 7) % 100}%`,
          size,
          duration: 9 + ((i * 29) % 11),
          delay: -((i * 17) % 14),
          drift: `${((i * 13) % 30) - 15}px`,
        };
      }),
    [bubbles],
  );
  return (
    <div className="backdrop" aria-hidden="true">
      {fan && <div className="backdrop__fan" />}
      <div className="backdrop__grain" />
      {items.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={
            {
              left: b.left,
              width: b.size,
              height: b.size,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              '--drift': b.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
