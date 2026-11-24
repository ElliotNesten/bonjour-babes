import { useMemo, useState, type CSSProperties } from 'react';
import { Avatar } from '../../components/Avatar';
import * as sound from '../../lib/sound';
import type { Player } from '../../lib/types';
import { fitSize, useReducedMotion, useTimeline } from './tvHooks';

const CARD_W = 220;
const CARD_H = 296;
const GAP = 26;

interface Slot {
  x: number;
  y: number;
}

/** Kortens platser (relativt mitten av rutnätet), sista raden centrerad. */
function layout(n: number): { slots: Slot[]; s: number } {
  const rows = n <= 6 ? 1 : n <= 12 ? 2 : 3;
  const cols = Math.ceil(n / rows);
  const s = Math.min(1, 1520 / (cols * (CARD_W + GAP)), (rows === 3 ? 640 : 680) / (rows * (CARD_H + GAP)));
  const w = (CARD_W + GAP) * s;
  const h = (CARD_H + GAP) * s;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const c = i - r * cols;
    slots.push({ x: (c - (inRow - 1) / 2) * w, y: (r - (rows - 1) / 2) * h });
  }
  return { slots, s };
}

interface Jitter {
  x: number;
  y: number;
  r: number;
  z: number;
}

function jitter(n: number): Jitter[] {
  return Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * 460,
    y: (Math.random() - 0.5) * 150,
    r: (Math.random() - 0.5) * 50,
    z: Math.floor(Math.random() * 100),
  }));
}

/**
 * Lottningsanimationen (≈6–7 s): korten blandas med tickande ljud, flyger till sina
 * platser och vänds ett i taget. Visas som ett överlägg över lobbyn/tävlingen.
 */
export function TvLottery({
  ids,
  players,
  startNumber = 1,
  onDone,
}: {
  ids: string[];
  players: Record<string, Player>;
  startNumber?: number;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const n = ids.length;
  const { slots, s } = useMemo(() => layout(n), [n]);
  const [phase, setPhase] = useState<'intro' | 'shuffle' | 'reveal' | 'done' | 'leaving'>('intro');
  // Med reducerad rörelse ligger korten i en prydlig hög i stället för att blandas.
  const [pile, setPile] = useState<Jitter[]>(() =>
    reduced ? Array.from({ length: n }, (_, i) => ({ x: 0, y: -i * 3, r: 0, z: i })) : jitter(n),
  );
  const [revealed, setRevealed] = useState(0);

  const shuffleStart = reduced ? 300 : 450;
  const shuffleEnd = reduced ? 300 : 2500;
  const step = Math.max(240, Math.min(400, 3200 / Math.max(1, n)));
  const revealEnd = shuffleEnd + 250 + n * step;

  useTimeline((at) => {
    at(shuffleStart, () => setPhase('shuffle'));
    if (!reduced) {
      for (let t = shuffleStart; t < shuffleEnd - 100; t += 170) {
        at(t, () => {
          setPile(jitter(n));
          sound.tick();
        });
      }
    }
    at(shuffleEnd, () => {
      setPhase('reveal');
      sound.whoosh();
    });
    for (let i = 0; i < n; i++) {
      at(shuffleEnd + 250 + i * step, () => {
        setRevealed(i + 1);
        sound.ding(i);
      });
    }
    at(revealEnd + 350, () => {
      setPhase('done');
      sound.chime();
    });
    at(revealEnd + 2200, () => setPhase('leaving'));
    at(revealEnd + 2800, onDone);
  });

  const title = phase === 'intro' || phase === 'shuffle' ? 'Vi lottar kvällens ordning…' : 'Kvällens ordning';

  return (
    <div className={`tv-lottery ${phase === 'leaving' ? 'is-leaving' : ''}`} role="status" aria-live="polite">
      <header className="tv-lottery__head">
        <div className="tv-eyebrow">La loterie</div>
        <h1 className="tv-lottery__title" key={title}>
          {title}
        </h1>
        <div className={`tv-lottery__sub ${phase === 'done' || phase === 'leaving' ? 'is-on' : ''}`}>C'est parti !</div>
      </header>
      <div className="tv-lottery__table" style={{ '--s': s } as CSSProperties}>
        {ids.map((id, i) => {
          const p = players[id];
          if (!p) return null;
          const slot = slots[i];
          const isPlaced = phase !== 'intro' && phase !== 'shuffle' && i < revealed;
          const j = pile[i] ?? { x: 0, y: 0, r: 0, z: 0 };
          const transform = isPlaced
            ? `translate(${slot.x}px, ${slot.y}px) scale(${s})`
            : phase === 'intro'
              ? `translate(0px, 40px) scale(${s * 0.92}) rotate(${(i - n / 2) * 2}deg)`
              : `translate(${j.x * s}px, ${j.y * s}px) rotate(${j.r}deg) scale(${s})`;
          return (
            <div
              key={id}
              className={`tv-lcard ${isPlaced ? 'is-placed' : ''} ${phase === 'intro' ? 'is-intro' : ''}`}
              style={{ transform, zIndex: isPlaced ? 200 + i : j.z, '--d': `${i * 0.03}s` } as CSSProperties}
            >
              <div className="tv-lcard__inner">
                <div className="tv-lcard__back">
                  <span className="tv-lcard__mono">BB</span>
                </div>
                <div className="tv-lcard__front">
                  <span className="tv-lcard__num tabular">{startNumber + i}</span>
                  <Avatar emoji={p.emoji} color={p.color} size={104} />
                  <span className="tv-lcard__name" style={{ fontSize: fitSize(p.name, 30, 19, 11) }}>
                    {p.name}
                  </span>
                  <span className="tv-lcard__drink" style={{ fontSize: fitSize(p.drink, 21, 15, 17) }}>
                    {p.drink}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
