import type { ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { formatScore } from '../../lib/format';
import { AWARDS, CATEGORIES, type DrinkResult, type JudgeStat, type Results } from '../../lib/scoring';
import type { Game } from '../../lib/types';
import { count, SectionHeading } from './parts';

/* ------------------------------------------------------------------ */
/*  Specialpriser                                                       */
/* ------------------------------------------------------------------ */

export function AwardsSection({ results }: { results: Results }) {
  return (
    <section className="res-section" aria-labelledby="res-awards">
      <SectionHeading eyebrow="Les prix spéciaux" title="Specialpriser" id="res-awards">
        <p className="res-heading__sub">Bara ära – inga poäng.</p>
      </SectionHeading>
      <ul className="res-cards">
        {AWARDS.map((def) => {
          const award = results.awards.find((a) => a.id === def.id);
          const winners = award?.winners ?? [];
          return (
            <li key={def.id} className="res-award card card--flat">
              <div className="res-award__head">
                <span className="res-award__emoji" aria-hidden="true">
                  {def.emoji}
                </span>
                <span className="grow">
                  <span className="res-award__title">{def.title}</span>
                  <span className="res-award__fr">{def.fr}</span>
                </span>
                {winners.length > 1 && <span className="pill pill--gold">Delad seger</span>}
              </div>
              {winners.length === 0 ? (
                <p className="res-award__none">Inga röster</p>
              ) : (
                <ul className="res-award__winners">
                  {winners.map((w) => (
                    <li key={w.playerId} className="res-person">
                      <Avatar emoji={w.emoji} color={w.color} size={38} />
                      <span className="res-person__text">
                        <span className="res-person__name">{w.name}</span>
                        <span className="res-person__sub">”{w.drink}”</span>
                      </span>
                      <span className="res-person__aside tabular">
                        {w.votes}
                        <span className="res-person__of"> av {count(award?.totalVotes ?? 0, 'röst', 'röster')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bäst i varje kategori                                               */
/* ------------------------------------------------------------------ */

export function CategoriesSection({ results }: { results: Results }) {
  return (
    <section className="res-section" aria-labelledby="res-categories">
      <SectionHeading eyebrow="Les meilleurs" title="Bäst i varje kategori" id="res-categories">
        <p className="res-heading__sub">Högst snittbetyg (1–10) per kategori.</p>
      </SectionHeading>
      <ul className="res-catlist card card--flat">
        {CATEGORIES.map((c) => {
          const w = results.categoryWinners.find((x) => x.categoryId === c.id);
          return (
            <li key={c.id} className="res-cat">
              <span className="res-award__emoji" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="res-cat__text">
                <span className="res-cat__label">
                  {c.label} <span className="res-cat__weight">×{c.weight}</span>
                </span>
                {w ? (
                  <span className="res-cat__who">
                    <Avatar emoji={w.emoji} color={w.color} size={24} />
                    <span className="res-cat__name">{w.name}</span>
                    <span className="res-cat__drink">”{w.drink}”</span>
                  </span>
                ) : (
                  <span className="res-award__none">Inga röster</span>
                )}
              </span>
              {w && <span className="res-person__aside res-person__aside--big tabular">{formatScore(w.avg)}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Kvällens statistik                                                  */
/* ------------------------------------------------------------------ */

interface StatItem {
  key: string;
  emoji: string;
  title: string;
  who: ReactNode;
  value: string;
  note: string;
}

function judgeWho(j: JudgeStat): ReactNode {
  return (
    <>
      <Avatar emoji={j.emoji} color={j.color} size={34} />
      <span className="res-person__text">
        <span className="res-person__name">{j.name}</span>
      </span>
    </>
  );
}

function drinkWho(d: Pick<DrinkResult, 'emoji' | 'color' | 'drink' | 'name'>): ReactNode {
  return (
    <>
      <Avatar emoji={d.emoji} color={d.color} size={34} />
      <span className="res-person__text">
        <span className="res-person__name">{d.drink}</span>
        <span className="res-person__sub">av {d.name}</span>
      </span>
    </>
  );
}

export function StatsSection({ game, results }: { game: Game; results: Results }) {
  const s = results.stats;
  const items: StatItem[] = [];
  if (s.kindest) {
    items.push({ key: 'kindest', emoji: '😇', title: 'Snällaste domaren', who: judgeWho(s.kindest), value: formatScore(s.kindest.avgGiven), note: 'i snitt per betyg' });
  }
  if (s.harshest) {
    items.push({ key: 'harshest', emoji: '🧐', title: 'Hårdaste domaren', who: judgeWho(s.harshest), value: formatScore(s.harshest.avgGiven), note: 'i snitt per betyg' });
  }
  if (s.mostTens) {
    items.push({ key: 'tens', emoji: '🔟', title: 'Flest 10:or', who: judgeWho(s.mostTens), value: String(s.mostTens.tensGiven), note: s.mostTens.tensGiven === 1 ? 'tia utdelad' : 'tior utdelade' });
  }
  if (s.highestSingle) {
    const h = s.highestSingle;
    items.push({
      key: 'highest',
      emoji: '🚀',
      title: 'Kvällens högsta betyg',
      who: drinkWho(h.drink),
      value: formatScore(h.total),
      note: game.settings.showJudgeNames ? `från ${h.judge.name}` : 'från en domare',
    });
  }
  if (s.mostDivisive?.stdDev != null) {
    items.push({ key: 'divisive', emoji: '⚡', title: 'Mest omdiskuterad', who: drinkWho(s.mostDivisive), value: `±${formatScore(s.mostDivisive.stdDev)}`, note: 'i spridning' });
  }
  if (s.mostUnanimous?.stdDev != null) {
    items.push({ key: 'unanimous', emoji: '🤝', title: 'Mest enig jury', who: drinkWho(s.mostUnanimous), value: `±${formatScore(s.mostUnanimous.stdDev)}`, note: 'i spridning' });
  }

  const allTotals = results.ranking.flatMap((d) => d.judges.map((j) => j.total));
  const average = allTotals.length ? allTotals.reduce((a, b) => a + b, 0) / allTotals.length : null;
  const comments = results.ranking.reduce((n, d) => n + d.comments.length, 0);
  const tens = results.ranking.reduce((n, d) => n + d.tens, 0);

  return (
    <section className="res-section" aria-labelledby="res-stats">
      <SectionHeading eyebrow="Les chiffres" title="Kvällens statistik" id="res-stats" />
      <dl className="res-figures">
        <div className="res-figure">
          <dt>Betyg</dt>
          <dd className="tabular">{results.totalVotes}</dd>
        </div>
        <div className="res-figure">
          <dt>Snittbetyg</dt>
          <dd className="tabular">{formatScore(average)}</dd>
        </div>
        <div className="res-figure">
          <dt>Tior</dt>
          <dd className="tabular">{tens}</dd>
        </div>
        <div className="res-figure">
          <dt>Kommentarer</dt>
          <dd className="tabular">{comments}</dd>
        </div>
      </dl>
      {items.length > 0 && (
        <ul className="res-stats">
          {items.map((it) => (
            <li key={it.key} className="res-stat card card--flat">
              <div className="res-stat__title">
                <span aria-hidden="true">{it.emoji}</span> {it.title}
              </div>
              <div className="res-person">
                {it.who}
                <span className="res-stat__value">
                  <span className="tabular">{it.value}</span>
                  <span className="res-stat__note">{it.note}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
