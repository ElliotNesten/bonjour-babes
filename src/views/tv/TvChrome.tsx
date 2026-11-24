import { useEffect, useState, type ReactNode } from 'react';
import { Backdrop } from '../../components/Backdrop';
import { Logo } from '../../components/Logo';
import { Ornament } from '../../components/Ornament';
import * as sound from '../../lib/sound';
import { useMuted, useStageSize } from './tvHooks';

/** Låser sidan (ingen scroll) medan storskärmen visas. */
function useBodyLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('tv-lock');
    return () => root.classList.remove('tv-lock');
  }, []);
}

/**
 * Scen i 1920×1080 logiska pixlar som skalas för att fylla fönstret (ingen scroll,
 * samma layout på alla skärmar). Bakgrunden ligger utanför scenen och fyller allt.
 */
export function TvStage({ children, className = '' }: { children: ReactNode; className?: string }) {
  useBodyLock();
  const { scale, width, height } = useStageSize();
  return (
    <>
      <Backdrop bubbles={28} />
      <div className="tv-vignette" aria-hidden="true" />
      <div className={`tv-stage ${className}`} style={{ width, height, transform: `scale(${scale})` }}>
        <div className="tv-frame" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}

function canFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

export function toggleFullscreen() {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (canFullscreen()) void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Ljud av/på i hörnet. */
export function MuteButton() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      type="button"
      className={`tv-mute ${muted ? 'is-muted' : ''}`}
      onClick={() => {
        void sound.unlock();
        setMuted(!muted);
      }}
      aria-label={muted ? 'Slå på ljudet' : 'Stäng av ljudet'}
      aria-pressed={muted}
      title={muted ? 'Slå på ljudet (M)' : 'Stäng av ljudet (M)'}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}

/** Kortkommandon för den som styr storskärmen från en dator: F = helskärm, M = ljud. */
export function useTvShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      void sound.unlock();
      const key = e.key.toLowerCase();
      if (key === 'f') toggleFullscreen();
      if (key === 'm') sound.setMuted(!sound.isMuted());
    };
    // Varje klick/tangent är en chans att låsa upp ljudet (autoplay-reglerna).
    const onPointer = () => void sound.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);
}

/**
 * Engångsöverlägg vid start: låser upp ljudet (kräver en gest) och går i helskärm.
 * Kan hoppas över. Visas igen efter omladdning eftersom webbläsaren kräver en ny gest.
 */
export function StartOverlay({ onStart, pin }: { onStart: () => void; pin?: string }) {
  const [leaving, setLeaving] = useState(false);
  const close = (fullscreen: boolean) => {
    if (leaving) return;
    if (fullscreen && canFullscreen() && !document.fullscreenElement) {
      try {
        void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    void sound.unlock().then((ok) => {
      if (ok && fullscreen) sound.chime();
    });
    setLeaving(true);
    window.setTimeout(onStart, 450);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        close(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`tv-start ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Starta storskärmen">
      <div className="tv-start__inner">
        <Logo size="xl" className="tv-start__logo" />
        <Ornament className="tv-start__orn" />
        <p className="tv-start__lead">Bonsoir ! Storskärmen är redo{pin ? ` för spel ${pin.slice(0, 3)} ${pin.slice(3)}` : ''}.</p>
        <button type="button" className="btn btn--gold tv-start__btn" onClick={() => close(true)} autoFocus>
          Starta storskärmen <span aria-hidden="true">🔊</span>
        </button>
        <button type="button" className="tv-start__skip" onClick={() => close(false)}>
          Hoppa över
        </button>
        <p className="tv-start__hint">Ljud och helskärm kräver ett klick · F = helskärm · M = ljud av/på</p>
      </div>
    </div>
  );
}
