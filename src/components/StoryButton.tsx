import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Results } from '../lib/scoring';
import { createStoryImage, storyFileName } from '../lib/storyImage';
import type { Game } from '../lib/types';
import '../views/results/story.css';

/**
 * Knapp som skapar en Instagram Story-bild (1080×1920) med prispallen och
 * delar den via Web Share API – eller visar den i en ruta med nedladdning
 * där delning av filer inte stöds.
 *
 * Bilden förbereds i bakgrunden när webbläsaren har tid över, så att
 * delningen kan starta direkt i klicket (iOS kräver det).
 */
export function StoryButton({ game, gameId, results, className = '' }: { game: Game; gameId: string; results: Results; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const cache = useRef<{ key: string; promise: Promise<File> } | null>(null);
  const mounted = useRef(true);

  const key = storyKey(gameId, game, results);

  const getFile = useCallback((): Promise<File> => {
    if (cache.current?.key === key) return cache.current.promise;
    const promise = createStoryImage(game, results).then(
      (blob) => new File([blob], storyFileName(game), { type: 'image/png', lastModified: Date.now() }),
    );
    promise.catch(() => {
      if (cache.current?.promise === promise) cache.current = null;
    });
    cache.current = { key, promise };
    return promise;
    // Nyckeln fångar allt som syns på bilden, så game/results behöver inte vara beroenden.
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Förbered bilden i bakgrunden.
  useEffect(() => {
    const run = () => {
      getFile().catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, [getFile]);

  // Släpp förhandsvisningens objekt-URL när rutan stängs eller byts ut.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  const title = `${game.meta.name || 'Bonjour Babes'} – Le Podium`;

  const share = useCallback(
    async (file: File): Promise<'shared' | 'cancelled' | 'unsupported'> => {
      if (!canShareFile(file)) return 'unsupported';
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        return 'unsupported';
      }
    },
    [title],
  );

  const onClick = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    let file: File;
    try {
      file = await getFile();
    } catch {
      if (mounted.current) {
        setBusy(false);
        setError('Kunde inte skapa bilden – försök igen.');
      }
      return;
    }
    if (!mounted.current) return;
    setBusy(false);
    const outcome = await share(file);
    if (outcome === 'unsupported' && mounted.current) {
      setPreview({ url: URL.createObjectURL(file), file });
    }
  };

  const closePreview = useCallback(() => setPreview(null), []);
  const variant = /\bbtn--(gold|bordeaux|ghost|danger)\b/.test(className) ? '' : 'btn--gold';

  return (
    <>
      <button
        type="button"
        className={`btn ${variant} ${className}`.replace(/\s+/g, ' ').trim()}
        onClick={onClick}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? (
          <>
            <span className="story-spinner" aria-hidden="true" />
            <span className="story-btn__label">Skapar bilden…</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">📸</span>
            <span className="story-btn__label">Dela på Instagram Story</span>
          </>
        )}
      </button>
      {error && (
        <p className="error story-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <StoryPreview
          url={preview.url}
          file={preview.file}
          onClose={closePreview}
          onShare={canShareFile(preview.file) ? () => void share(preview.file) : undefined}
        />
      )}
    </>
  );
}

function StoryPreview({ url, file, onClose, onShare }: { url: string; file: File; onClose: () => void; onShare?: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);

  // Håll tabb-fokus inne i rutan.
  const trapFocus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="story-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="story-modal__panel card card--deco card--gold"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-modal-title"
        onKeyDown={trapFocus}
      >
        <button ref={closeRef} type="button" className="btn btn--ghost btn--icon story-modal__close" aria-label="Stäng" onClick={onClose}>
          ✕
        </button>
        <div className="eyebrow center">Instagram Story</div>
        <h3 id="story-modal-title" className="story-modal__title center">
          Voilà – din story är klar
        </h3>
        <div className="story-modal__frame">
          <img className="story-modal__img" src={url} width={1080} height={1920} alt="Story-bild med kvällens prispall" />
        </div>
        <a className="btn btn--gold btn--block btn--lg" href={url} download={file.name}>
          <span aria-hidden="true">⬇</span> Ladda ner bilden
        </a>
        {onShare && (
          <button type="button" className="btn btn--bordeaux btn--block" onClick={onShare}>
            Dela bilden
          </button>
        )}
        <p className="hint center story-modal__hint">Spara bilden och lägg upp den som story 💫</p>
        <p className="hint dim center story-modal__tip">I mobilen kan du också hålla fingret på bilden och välja ”Spara bild”.</p>
      </div>
    </div>,
    document.body,
  );
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Allt som syns på bilden – ändras något ritas bilden om. */
function storyKey(gameId: string, game: Game, results: Results): string {
  return JSON.stringify([
    gameId,
    game.meta.name,
    game.meta.createdAt,
    game.settings.awardsEnabled,
    results.ranking.slice(0, 3).map((d) => [d.playerId, d.name, d.drink, d.emoji, d.color, d.score, d.rank]),
    results.awards.map((a) => [a.id, a.winners.map((w) => [w.playerId, w.name, w.drink])]),
    results.categoryWinners.map((c) => [c.categoryId, c.playerId, c.name, c.drink]),
    [results.stats.kindest?.name, results.stats.harshest?.name, results.stats.mostDivisive?.playerId],
  ]);
}
