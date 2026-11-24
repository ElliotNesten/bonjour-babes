import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Avatar } from '../../../components/Avatar';
import type { DrinkResult, Results } from '../../../lib/scoring';
import * as sound from '../../../lib/sound';
import { fitSize, useTimeline } from '../tvHooks';
import type { StepProps } from '../TvCeremony';

const SLIDE_MS = 8000;
const PAGE_WEIGHT = 6;

interface Slide {
  drink: DrinkResult;
  comments: string[];
  page: number;
  pages: number;
  /** Index bland drinkarna (för prickarna). */
  drinkIndex: number;
}

const weight = (text: string) => 1 + (text.length > 110 ? 1 : 0) + (text.length > 200 ? 1 : 0);

/** En bild per drink – långa kommentarslistor delas upp på flera sidor. */
function buildSlides(results: Results): { slides: Slide[]; drinks: DrinkResult[] } {
  const drinks = results.ranking.filter((d) => d.comments.length > 0).sort((a, b) => a.orderIndex - b.orderIndex);
  const slides: Slide[] = [];
  drinks.forEach((drink, drinkIndex) => {
    const pages: string[][] = [];
    let cur: string[] = [];
    let w = 0;
    for (const c of drink.comments) {
      const cw = weight(c);
      if (cur.length && w + cw > PAGE_WEIGHT) {
        pages.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(c);
      w += cw;
    }
    if (cur.length) pages.push(cur);
    pages.forEach((comments, page) => slides.push({ drink, comments, page, pages: pages.length, drinkIndex }));
  });
  return { slides, drinks };
}

function quoteSize(comments: string[]): number {
  const total = comments.reduce((s, c) => s + c.length, 0);
  const n = comments.length;
  let size = n === 1 ? 58 : n === 2 ? 44 : n <= 4 ? 36 : 30;
  if (total > 500) size -= 4;
  if (total > 800) size -= 4;
  if (n === 1 && total > 160) size = 46;
  return size;
}

/** Anonym kommentarsvägg: en drink i taget, byter var 8:e sekund och loopar. */
export function CommentsStep({ results, live }: StepProps) {
  const { slides, drinks } = useMemo(() => buildSlides(results), [results]);
  const [index, setIndex] = useState(0);

  useTimeline((at) => {
    at(200, () => sound.chime());
  }, live);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => window.clearInterval(t);
  }, [slides.length]);

  if (!slides.length) {
    return (
      <div className="tv-cer tv-comments">
        <div className="tv-eyebrow">Les mots doux</div>
        <h1 className="tv-comments__empty">Inga kommentarer den här gången</h1>
      </div>
    );
  }

  const slide = slides[index % slides.length];
  const size = quoteSize(slide.comments);
  const cols = slide.comments.length === 1 ? 1 : slide.comments.length <= 4 ? 2 : 3;

  return (
    <div className="tv-cer tv-comments">
      <div className="tv-comments__top">
        <div className="tv-eyebrow">Anonyma kommentarer · Les mots doux</div>
      </div>
      <div className="tv-comments__slide" key={index % slides.length}>
        <header className="tv-comments__drink">
          <Avatar emoji={slide.drink.emoji} color={slide.drink.color} size={84} />
          <div className="tv-comments__drink-text">
            <span className="tv-comments__drink-name" style={{ fontSize: fitSize(slide.drink.drink, 76, 46, 18) }}>
              {slide.drink.drink}
            </span>
            <span className="tv-comments__by">
              av {slide.drink.name}
              {slide.pages > 1 && (
                <span className="tv-comments__page tabular">
                  {' '}
                  · {slide.page + 1}/{slide.pages}
                </span>
              )}
            </span>
          </div>
        </header>
        <div className="tv-quotes" style={{ '--cols': cols, '--q': `${size}px` } as CSSProperties}>
          {slide.comments.map((c, i) => (
            <blockquote key={i} className="tv-quote" style={{ animationDelay: `${0.25 + i * 0.18}s` }}>
              <span className="tv-quote__mark" aria-hidden="true">
                “
              </span>
              <p>{c}</p>
            </blockquote>
          ))}
        </div>
      </div>
      <footer className="tv-comments__foot" aria-hidden="true">
        <div className="tv-comments__dots">
          {drinks.map((d, i) => (
            <span key={d.playerId} className={`tv-comments__dot ${i === slide.drinkIndex ? 'is-on' : ''}`} />
          ))}
        </div>
        {slides.length > 1 && (
          <div className="tv-comments__progress">
            <span key={index} style={{ animationDuration: `${SLIDE_MS}ms` }} />
          </div>
        )}
      </footer>
    </div>
  );
}
