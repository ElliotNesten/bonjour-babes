import { useId, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { formatScore, placeLabel } from '../../lib/format';
import { CATEGORIES, TRIM_MIN_VOTES, type DrinkResult } from '../../lib/scoring';
import type { Game } from '../../lib/types';
import { count } from './parts';

/** Hela placeringslistan – varje rad kan fällas ut för detaljer. */
export function RankingList({ game, ranking }: { game: Game; ranking: DrinkResult[] }) {
  return (
    <ol className="res-ranking">
      {ranking.map((d) => (
        <RankingRow key={d.playerId} game={game} drink={d} />
      ))}
    </ol>
  );
}

function RankingRow({ game, drink: d }: { game: Game; drink: DrinkResult }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tier = d.rank <= 3 ? d.rank : 0;
  return (
    <li className={`res-row ${tier ? `res-row--top res-medal--${tier}` : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="res-row__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className="res-row__rank tabular">{placeLabel(d.rank)}</span>
        <Avatar emoji={d.emoji} color={d.color} size={44} />
        <span className="res-row__who">
          <span className="res-row__name">{d.name}</span>
          <span className="res-row__drink">”{d.drink}”</span>
          <span className="res-row__meta">
            {d.voteCount ? count(d.voteCount, 'röst', 'röster') : 'Inga röster'}
            {d.trimmed && (
              <span className="res-os" title={`OS-regeln: högsta och lägsta betyget struket (minst ${TRIM_MIN_VOTES} röster)`}>
                🏅 OS-regeln
              </span>
            )}
          </span>
        </span>
        <span className="res-row__score">
          <span className="res-row__points tabular">{formatScore(d.score)}</span>
          <span className="res-row__unit">poäng</span>
        </span>
        <span className="res-row__chev" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div id={panelId} className="res-row__panel" hidden={!open}>
        {open && <DrinkDetails game={game} drink={d} />}
      </div>
    </li>
  );
}

function DrinkDetails({ game, drink: d }: { game: Game; drink: DrinkResult }) {
  if (d.voteCount === 0) {
    return <p className="res-details__empty italic muted">Drinken fick inga röster.</p>;
  }
  const showNames = game.settings.showJudgeNames;
  return (
    <div className="res-details">
      <section className="res-details__part res-details__part--bars" aria-label="Snitt per kategori">
        <div className="res-details__label">Snitt per kategori</div>
        <div className="res-bars">
          {CATEGORIES.map((c) => {
            const avg = d.categoryAvg[c.id];
            return (
              <div key={c.id} className="res-bar">
                <span className="res-bar__label">
                  <span aria-hidden="true">{c.emoji}</span> {c.label} <span className="res-bar__weight">×{c.weight}</span>
                </span>
                <span className="res-bar__value tabular">{formatScore(avg)}</span>
                <span className="res-bar__track" aria-hidden="true">
                  <span className="res-bar__fill" style={{ width: `${Math.max(0, Math.min(10, avg ?? 0)) * 10}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="res-details__part res-details__part--judges" aria-label="Domarnas betyg">
        <div className="res-details__label">
          Domarnas betyg <span className="res-details__sub">(av 100)</span>
        </div>
        <ul className="res-judges">
          {d.judges.map((j, i) => {
            const voter = game.players[j.voterId];
            return (
              <li key={j.voterId} className={`res-judge ${j.dropped ? 'is-dropped' : ''}`} title={j.dropped ? 'Struken enligt OS-regeln' : undefined}>
                <span className="res-judge__who">
                  {showNames && voter && <Avatar emoji={voter.emoji} color={voter.color} size={22} />}
                  <span className="res-judge__name">{showNames ? j.voterName : `Domare ${i + 1}`}</span>
                </span>
                {j.dropped ? (
                  <span className="res-judge__score tabular">
                    <s>{formatScore(j.total)}</s>
                    <span className="res-sr"> (struken enligt OS-regeln)</span>
                  </span>
                ) : (
                  <span className="res-judge__score tabular">{formatScore(j.total)}</span>
                )}
              </li>
            );
          })}
        </ul>
        {d.trimmed && <p className="res-details__note">Överstruket = struken enligt OS-regeln. Högsta och lägsta betyget räknas inte.</p>}
        <p className="res-details__note">
          Slutpoäng <strong className="tabular">{formatScore(d.score)}</strong> = snittet av {count(d.judges.filter((j) => !j.dropped).length, 'betyg', 'betyg')}.
        </p>
      </section>

      {d.comments.length > 0 && (
        <section className="res-details__part res-details__part--comments" aria-label="Anonyma kommentarer">
          <div className="res-details__label">Anonyma kommentarer</div>
          <ul className="res-comments">
            {d.comments.map((c, i) => (
              <li key={i} className="res-comment">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
