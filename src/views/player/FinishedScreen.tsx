import { useMemo } from 'react';
import { Avatar } from '../../components/Avatar';
import { StoryButton } from '../../components/StoryButton';
import { formatScore, medal, placeLabel } from '../../lib/format';
import { href } from '../../lib/router';
import { CATEGORIES, computeResults, getAward } from '../../lib/scoring';
import type { Game } from '../../lib/types';

/** Efter prisutdelningen: min placering, min drink i siffror, kommentarerna – och länkar till resultat och story. */
export function FinishedScreen({ gameId, game, uid }: { gameId: string; game: Game; uid: string }) {
  const results = useMemo(() => computeResults(game), [game]);
  const mine = results.ranking.find((d) => d.playerId === uid) ?? null;
  const myAwards = results.awards.filter((a) => a.winners.some((w) => w.playerId === uid)).map((a) => getAward(a.id));
  const judge = results.judges.find((j) => j.playerId === uid);
  const podium = results.ranking.filter((d) => d.rank <= 3 && d.score !== null).slice(0, 3);
  const n = results.ranking.length;

  return (
    <div className="stack-lg">
      {mine && (
        <div className={`card card--deco card--gold pl-final ${mine.rank <= 3 ? `pl-final--${mine.rank}` : ''}`}>
          <div className="eyebrow">Le résultat final</div>
          {mine.rank <= 3 ? (
            <div className="pl-final__medal" aria-hidden="true">
              {medal(mine.rank)}
            </div>
          ) : (
            <div className="pl-final__place" aria-hidden="true">
              <span>N°</span>
              {mine.rank}
            </div>
          )}
          <h1 className="pl-title">
            {mine.rank === 1 ? (
              <span className="shimmer">Du vann kvällen !</span>
            ) : (
              <>
                Du kom <span className="gold-text">{placeLabel(mine.rank)}</span>
              </>
            )}
          </h1>
          <div className="pl-final__score tabular">
            {mine.score !== null ? (
              <>
                {formatScore(mine.score)}
                <small> poäng</small>
              </>
            ) : (
              <small>Inga röster</small>
            )}
          </div>
          <p className="pl-drinkname" style={{ margin: 0 }}>
            “{mine.drink}”
          </p>
          <p className="hint" style={{ margin: 0 }}>
            av {n} drinkar · {mine.voteCount} domare
            {mine.trimmed ? ' · OS-regeln tillämpad' : ''}
          </p>
        </div>
      )}

      {myAwards.length > 0 && (
        <div className="stack">
          {myAwards.map((a) => (
            <div key={a.id} className="card card--gold pl-myaward">
              <span className="pl-myaward__emoji" aria-hidden="true">
                {a.emoji}
              </span>
              <div className="grow">
                <div className="eyebrow">{a.fr}</div>
                <div className="pl-myaward__title">Du vann {a.title} !</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stack">
        <a className="btn btn--gold btn--lg btn--block" href={href(`/results/${gameId}`)}>
          Se alla resultat
        </a>
        <StoryButton game={game} gameId={gameId} results={results} className="btn--bordeaux btn--block" />
      </div>

      {mine && mine.voteCount > 0 && (
        <div className="card pl-stats">
          <div className="eyebrow">Din drink i siffror</div>
          <ul className="pl-bars">
            {CATEGORIES.map((c) => {
              const avg = mine.categoryAvg[c.id];
              return (
                <li key={c.id}>
                  <span className="pl-bars__label">
                    <span aria-hidden="true">{c.emoji}</span> {c.label}
                    <span className="pl-bars__w">×{c.weight}</span>
                  </span>
                  <span className="pl-bars__track" aria-hidden="true">
                    <span style={{ width: `${avg !== null ? (avg / 10) * 100 : 0}%` }} />
                  </span>
                  <span className="pl-bars__val tabular">{formatScore(avg)}</span>
                </li>
              );
            })}
          </ul>
          {judge && (
            <p className="hint" style={{ margin: '12px 0 0' }}>
              Som domare gav du i snitt <strong className="tabular">{formatScore(judge.avgGiven)}</strong> poäng
              {judge.tensGiven > 0 ? ` och delade ut ${judge.tensGiven} st 10:or` : ''}.
            </p>
          )}
        </div>
      )}

      {mine && (
        <div className="card pl-stats">
          <div className="row-between">
            <div className="eyebrow">Vad gästerna tyckte</div>
            {mine.comments.length > 0 && <span className="pill tabular">{mine.comments.length}</span>}
          </div>
          {mine.comments.length ? (
            <ul className="pl-comments">
              {mine.comments.map((text, i) => (
                <li key={i} className="pl-quote">
                  “{text}”
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: '10px 0 0' }}>
              Inga kommentarer den här gången – drinken fick tala för sig själv. 🍸
            </p>
          )}
        </div>
      )}

      {podium.length > 0 && (
        <div className="card pl-stats">
          <div className="eyebrow">Le podium</div>
          <ol className="pl-podium">
            {podium.map((d) => (
              <li key={d.playerId} className={d.playerId === uid ? 'is-me' : ''}>
                <span className="pl-podium__medal" aria-label={placeLabel(d.rank)}>
                  {medal(d.rank)}
                </span>
                <Avatar emoji={d.emoji} color={d.color} size={36} />
                <span className="grow pl-podium__text">
                  <span className="pl-podium__drink">{d.drink}</span>
                  <span className="pl-podium__name">{d.playerId === uid ? 'Du' : d.name}</span>
                </span>
                <span className="pl-podium__score tabular">{formatScore(d.score)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <nav className="pl-links">
        <a href={href('/hall-of-fame')}>🏆 Hall of Fame</a>
        <a href={href('/')}>Till startsidan</a>
      </nav>
      <p className="script pl-fr center">Merci et santé !</p>
    </div>
  );
}
