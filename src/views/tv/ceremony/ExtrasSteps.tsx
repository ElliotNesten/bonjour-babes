import { useState, type CSSProperties, type ReactNode } from 'react';
import { Avatar } from '../../../components/Avatar';
import * as confetti from '../../../lib/confetti';
import { formatScore } from '../../../lib/format';
import { getAward, getCategory, type DrinkResult, type JudgeStat } from '../../../lib/scoring';
import * as sound from '../../../lib/sound';
import type { AwardId } from '../../../lib/types';
import { Heading, Spotlights } from '../parts';
import { fitSize, useStagger, useTimeline, votesLabel } from '../tvHooks';
import type { StepProps } from '../TvCeremony';

/* ------------------------------------------------------------------ */
/*  Specialpris                                                         */
/* ------------------------------------------------------------------ */

export function AwardStep({ results, awardId, live }: StepProps & { awardId: AwardId }) {
  const def = getAward(awardId);
  const result = results.awards.find((a) => a.id === awardId);
  const winners = result?.winners ?? [];
  const [revealed, setRevealed] = useState(!live);

  useTimeline((at) => {
    at(150, () => sound.whoosh());
    at(800, () => void sound.drumroll(1800));
    at(2600, () => {
      setRevealed(true);
      sound.cymbal();
      confetti.burst(0.42, { y: 0.55 });
    });
    at(3300, () => sound.chime());
  }, live);

  const many = winners.length > 2;
  return (
    <div className={`tv-cer tv-award ${live ? 'is-live' : 'is-static'} ${revealed ? 'is-revealed' : ''}`}>
      <Spotlights mode="focus" />
      <div className="tv-award__head">
        <div className="tv-award__emoji" aria-hidden="true">
          {def.emoji}
        </div>
        <div className="tv-eyebrow">Specialpris · {def.fr}</div>
        <h1 className="tv-award__title">{def.title}</h1>
      </div>
      {!revealed ? (
        <div className="tv-award__suspense">
          Och priset går till<span className="tv-dots" aria-hidden="true" />
        </div>
      ) : winners.length === 0 ? (
        <div className="tv-award__suspense">Inga röster lades i den här kategorin</div>
      ) : (
        <div className={`tv-award__winners ${many ? 'is-many' : ''}`}>
          {winners.length > 1 && <div className="pill pill--gold tv-award__tie">Delat pris !</div>}
          <div className="tv-award__list">
            {winners.map((w, i) => (
              <div key={w.playerId} className="tv-award__winner" style={{ animationDelay: `${i * 0.15}s` }}>
                <Avatar emoji={w.emoji} color={w.color} size={many ? 140 : 200} ring />
                <div className="tv-award__name" style={{ fontSize: fitSize(w.name, many ? 46 : 64, 30, 12) }}>
                  {w.name}
                </div>
                <div className="tv-award__drink" style={{ fontSize: fitSize(w.drink, many ? 28 : 36, 20, 20) }}>
                  {w.drink}
                </div>
                <div className="tv-award__votes">{votesLabel(w.votes)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bäst i varje kategori                                               */
/* ------------------------------------------------------------------ */

export function CategoriesStep({ results, live }: StepProps) {
  const winners = results.categoryWinners;
  const shown = useStagger(winners.length, {
    enabled: live,
    startMs: 700,
    everyMs: 750,
    onStep: (i) => sound.ding(i * 2),
  });
  return (
    <div className={`tv-cer tv-cats ${live ? 'is-live' : 'is-static'}`}>
      <Heading size="md" eyebrow="Les meilleurs" title="Bäst i varje kategori" className="fade-up" />
      <div className="tv-cats__grid" style={{ '--n': winners.length } as CSSProperties}>
        {winners.map((w, i) => {
          const c = getCategory(w.categoryId);
          const on = i < shown;
          return (
            <div key={w.categoryId} className={`tv-cat card card--deco ${on ? 'is-on' : ''}`}>
              <div className="tv-cat__emoji" aria-hidden="true">
                {c.emoji}
              </div>
              <div className="tv-cat__label">{c.label}</div>
              <div className="tv-cat__fr">{c.fr}</div>
              <div className="tv-cat__winner">
                <Avatar emoji={w.emoji} color={w.color} size={124} ring />
                <div className="tv-cat__name" style={{ fontSize: fitSize(w.name, 40, 26, 11) }}>
                  {w.name}
                </div>
                <div className="tv-cat__drink" style={{ fontSize: fitSize(w.drink, 26, 18, 18) }}>
                  {w.drink}
                </div>
              </div>
              <div className="tv-cat__avg">
                <span className="tabular">{formatScore(w.avg)}</span>
                <small>i snitt av 10</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kvällens statistik                                                  */
/* ------------------------------------------------------------------ */

interface StatCard {
  key: string;
  icon: string;
  title: string;
  who: ReactNode;
  detail: ReactNode;
}

function judgeWho(j: JudgeStat) {
  return (
    <span className="tv-stat__who">
      <Avatar emoji={j.emoji} color={j.color} size={92} />
      <span className="tv-stat__name" style={{ fontSize: fitSize(j.name, 46, 28, 11) }}>
        {j.name}
      </span>
    </span>
  );
}

function drinkWho(d: DrinkResult) {
  return (
    <span className="tv-stat__who">
      <Avatar emoji={d.emoji} color={d.color} size={92} />
      <span className="tv-stat__drinkwrap">
        <span className="tv-stat__drink" style={{ fontSize: fitSize(d.drink, 40, 24, 16) }}>
          {d.drink}
        </span>
        <span className="tv-stat__by">av {d.name}</span>
      </span>
    </span>
  );
}

function range(d: DrinkResult): [string, string] {
  const totals = d.judges.map((j) => j.total);
  return [formatScore(Math.min(...totals), 0), formatScore(Math.max(...totals), 0)];
}

export function StatsStep({ game, results, live }: StepProps) {
  const s = results.stats;
  const cards: StatCard[] = [];
  if (s.kindest)
    cards.push({
      key: 'kindest',
      icon: '😇',
      title: 'Snällaste domaren',
      who: judgeWho(s.kindest),
      detail: (
        <>
          Gav i snitt <strong>{formatScore(s.kindest.avgGiven)}</strong> poäng
        </>
      ),
    });
  if (s.harshest)
    cards.push({
      key: 'harshest',
      icon: '🧐',
      title: 'Hårdaste domaren',
      who: judgeWho(s.harshest),
      detail: (
        <>
          Gav i snitt <strong>{formatScore(s.harshest.avgGiven)}</strong> poäng
        </>
      ),
    });
  if (s.mostDivisive) {
    const [lo, hi] = range(s.mostDivisive);
    cards.push({
      key: 'divisive',
      icon: '⚡',
      title: 'Mest splittrade drinken',
      who: drinkWho(s.mostDivisive),
      detail: (
        <>
          Betygen spände från <strong>{lo}</strong> till <strong>{hi}</strong>
        </>
      ),
    });
  }
  if (s.mostUnanimous) {
    const [lo, hi] = range(s.mostUnanimous);
    cards.push({
      key: 'unanimous',
      icon: '🤝',
      title: 'Mest eniga drinken',
      who: drinkWho(s.mostUnanimous),
      detail: (
        <>
          Alla gav mellan <strong>{lo}</strong> och <strong>{hi}</strong>
        </>
      ),
    });
  }
  if (s.mostTens)
    cards.push({
      key: 'tens',
      icon: '🔟',
      title: 'Flest 10:or',
      who: judgeWho(s.mostTens),
      detail: (
        <>
          Delade ut <strong>{s.mostTens.tensGiven}</strong> {s.mostTens.tensGiven === 1 ? 'tia' : 'tior'}
        </>
      ),
    });
  if (s.highestSingle)
    cards.push({
      key: 'highest',
      icon: '🚀',
      title: 'Kvällens högsta betyg',
      who: drinkWho(s.highestSingle.drink),
      detail: (
        <>
          <strong>{formatScore(s.highestSingle.total)}</strong> poäng{' '}
          {game.settings.showJudgeNames ? `från ${s.highestSingle.judge.name}` : 'från en anonym domare'}
        </>
      ),
    });

  const shown = useStagger(cards.length, {
    enabled: live,
    startMs: 700,
    everyMs: 650,
    onStep: (i) => sound.ding(i + 2),
  });
  const cols = cards.length <= 3 ? cards.length : cards.length === 4 ? 2 : 3;

  return (
    <div className={`tv-cer tv-stats ${live ? 'is-live' : 'is-static'}`}>
      <Heading size="md" eyebrow="Les statistiques" title="Kvällens statistik" className="fade-up" />
      <div className="tv-stats__grid" style={{ '--cols': Math.max(1, cols) } as CSSProperties}>
        {cards.map((c, i) => (
          <div key={c.key} className={`tv-stat card card--deco ${i < shown ? 'is-on' : ''}`}>
            <div className="tv-stat__head">
              <span className="tv-stat__icon" aria-hidden="true">
                {c.icon}
              </span>
              <span className="tv-stat__title">{c.title}</span>
            </div>
            {c.who}
            <div className="tv-stat__detail">{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
