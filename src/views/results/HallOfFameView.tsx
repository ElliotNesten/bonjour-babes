import { useMemo } from 'react';
import { Avatar } from '../../components/Avatar';
import { Backdrop } from '../../components/Backdrop';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { CoupeIcon, Ornament } from '../../components/Ornament';
import { formatDate, formatScore } from '../../lib/format';
import { useHallOfFame } from '../../lib/hooks';
import { href } from '../../lib/router';
import { champions, normalizeHallOfFame, topDrinks, topWinningScores, totals, winnersOf, type HofDrink, type HofNight } from './hallOfFame';
import { count, joinNames, MiniPodium, ResultsFooter, SectionHeading, useDocumentTitle } from './parts';
import './results.css';

/** Hall of Fame – alla avslutade kvällar och rekord genom tiderna. */
export function HallOfFameView() {
  const raw = useHallOfFame();
  const nights = useMemo(() => normalizeHallOfFame(raw), [raw]);
  useDocumentTitle('Hall of Fame · Bonjour Babes');

  if (raw === undefined) return <Loading full text="Hämtar legenderna…" />;

  return (
    <>
      <Backdrop bubbles={14} />
      <main className="page page--wide res hof">
        <header className="res-hero fade-up">
          <a href={href('/')} className="res-hero__logo" aria-label="Bonjour Babes – till startsidan">
            <Logo size="md" />
          </a>
          <Ornament width={260} />
          <div className="eyebrow">Les légendes</div>
          <h1 className="res-hero__title">Hall of Fame</h1>
          <p className="res-hero__lead">Alla kvällar, alla vinnare och de bästa drinkarna genom tiderna.</p>
        </header>

        {nights.length === 0 ? <Empty /> : <HallOfFameContent nights={nights} />}

        <ResultsFooter showHallOfFame={false} />
      </main>
    </>
  );
}

function Empty() {
  return (
    <div className="card card--deco card--gold res-wait__card hof-empty fade-up" style={{ animationDelay: '0.1s' }}>
      <CoupeIcon size={56} className="res-wait__icon float" />
      <p className="hof-empty__text">Inga avslutade kvällar än – första kvällen skriver historia !</p>
      <a className="btn btn--gold btn--block" href={href('/')}>
        C’est parti
      </a>
    </div>
  );
}

function HallOfFameContent({ nights }: { nights: HofNight[] }) {
  const sum = totals(nights);
  const champs = champions(nights).slice(0, 5);
  const bestWinners = topWinningScores(nights, 5);
  const bestDrinks = topDrinks(nights, 10);

  return (
    <>
      <dl className="res-figures hof-totals fade-up" style={{ animationDelay: '0.08s' }}>
        <div className="res-figure">
          <dt>{sum.nights === 1 ? 'Kväll' : 'Kvällar'}</dt>
          <dd className="tabular">{sum.nights}</dd>
        </div>
        <div className="res-figure">
          <dt>Drinkar betygsatta</dt>
          <dd className="tabular">{sum.drinks}</dd>
        </div>
        <div className="res-figure">
          <dt>Bartenders</dt>
          <dd className="tabular">{sum.guests}</dd>
        </div>
      </dl>

      <section className="res-section fade-up" style={{ animationDelay: '0.14s' }} aria-labelledby="hof-nights">
        <SectionHeading eyebrow="Les soirées" title="Kvällarna" id="hof-nights" />
        <ul className="hof-nights">
          {nights.map((n) => (
            <li key={n.gameId}>
              <NightCard night={n} />
            </li>
          ))}
        </ul>
      </section>

      <div className="res-columns">
        {champs.length > 0 && (
          <section className="res-section" aria-labelledby="hof-champs">
            <SectionHeading eyebrow="Les champions" title="Flest segrar" id="hof-champs" />
            <ol className="hof-list card card--flat">
              {champs.map((c, i) => (
                <li key={c.key} className="hof-item">
                  <span className="hof-item__pos tabular">{i + 1}</span>
                  <Avatar emoji={c.emoji} color={c.color} size={38} />
                  <span className="res-person__text">
                    <span className="res-person__name">{c.name}</span>
                    <span className="res-person__sub">senast {formatDate(c.lastWin)}</span>
                  </span>
                  <span className="hof-item__value">
                    <span className="hof-trophies" aria-hidden="true">
                      {'🥇'.repeat(Math.min(c.wins, 3))}
                      {c.wins > 3 ? '+' : ''}
                    </span>
                    <span className="hof-item__count">{count(c.wins, 'seger', 'segrar')}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {bestWinners.length > 0 && (
          <section className="res-section" aria-labelledby="hof-best-winners">
            <SectionHeading eyebrow="Les records" title="Högsta vinnarpoäng genom tiderna" id="hof-best-winners" />
            <DrinkList drinks={bestWinners} />
          </section>
        )}
      </div>

      {bestDrinks.length > 0 && (
        <section className="res-section" aria-labelledby="hof-top10">
          <SectionHeading eyebrow="Le top 10" title="Topp 10 drinkar genom tiderna" id="hof-top10" />
          <DrinkList drinks={bestDrinks} numbered />
        </section>
      )}
    </>
  );
}

function NightCard({ night }: { night: HofNight }) {
  const winners = winnersOf(night);
  const winner = winners[0];
  return (
    <a className="hof-night card card--deco" href={href(`/results/${night.gameId}`)}>
      <div className="hof-night__top">
        <span className="hof-night__date">{formatDate(night.finishedAt || night.createdAt)}</span>
        <span className="pill">{count(night.participants, 'deltagare', 'deltagare')}</span>
      </div>
      <div className="hof-night__name">{night.name}</div>
      <div className="hof-night__body">
        <MiniPodium
          entries={night.ranking.map((r, i) => ({ key: `${i}`, rank: r.rank, name: r.name, emoji: r.emoji, color: r.color }))}
          label={`Prispall ${night.name}`}
        />
        {winner ? (
          <div className="hof-night__winner">
            <span className="hof-night__label">🥇 {winners.length > 1 ? 'Delad seger' : 'Vinnare'}</span>
            <span className="hof-night__who">{joinNames(winners.map((w) => w.name))}</span>
            <span className="hof-night__drink">{winners.length === 1 ? `”${winner.drink}”` : winners.map((w) => `”${w.drink}”`).join(' & ')}</span>
            <span className="hof-night__score tabular">
              {formatScore(winner.score)} <span>poäng</span>
            </span>
          </div>
        ) : (
          <div className="hof-night__winner">
            <span className="hof-night__drink">Inga drinkar</span>
          </div>
        )}
      </div>
      <span className="hof-night__cta">
        Se resultatet <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

function DrinkList({ drinks, numbered = false }: { drinks: HofDrink[]; numbered?: boolean }) {
  return (
    <ol className="hof-list card card--flat">
      {drinks.map((d, i) => (
        <li key={`${d.gameId}-${d.rank}-${d.name}-${i}`}>
          <a className="hof-item hof-item--link" href={href(`/results/${d.gameId}`)}>
            {numbered && <span className={`hof-item__pos tabular ${i < 3 ? `res-medal--${i + 1}` : ''}`}>{i + 1}</span>}
            <Avatar emoji={d.emoji} color={d.color} size={38} />
            <span className="res-person__text">
              <span className="res-person__name">{d.drink}</span>
              <span className="res-person__sub">
                {d.name} · {formatDate(d.date)}
              </span>
            </span>
            <span className="hof-item__score tabular">{formatScore(d.score)}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
