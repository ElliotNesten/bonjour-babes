import { useState, type CSSProperties } from 'react';
import { Avatar } from '../../../components/Avatar';
import { Ornament } from '../../../components/Ornament';
import * as confetti from '../../../lib/confetti';
import { formatScore, medal as medalEmoji, placeLabel } from '../../../lib/format';
import type { DrinkResult } from '../../../lib/scoring';
import * as sound from '../../../lib/sound';
import { Heading, MEDAL_FR, medalFor, Podium, Spotlights } from '../parts';
import { fitSize, ordinalWord, useCountUp, useStagger, useTimeline, votesLabel } from '../tvHooks';
import type { StepProps } from '../TvCeremony';

/* ------------------------------------------------------------------ */
/*  Intro: "Mesdames et messieurs…"                                    */
/* ------------------------------------------------------------------ */

export function IntroStep({ results, live }: StepProps) {
  useTimeline((at) => {
    at(150, () => sound.whoosh());
    at(1500, () => sound.fanfare());
  }, live);
  const n = results.ranking.length;
  return (
    <div className={`tv-cer tv-intro ${live ? 'is-live' : 'is-static'}`}>
      <Spotlights mode={live ? 'sweep' : 'focus'} />
      <div className="tv-intro__content">
        <div className="tv-intro__mesdames">Mesdames et messieurs…</div>
        <h1 className="tv-intro__title">Dags för prisutdelningen</h1>
        <Ornament className="tv-intro__orn" />
        <div className="tv-intro__facts">
          <span>
            <strong className="tabular">{n}</strong> drinkar
          </span>
          <span className="tv-intro__dot" aria-hidden="true">◆</span>
          <span>
            <strong className="tabular">{results.totalVotes}</strong> betyg
          </span>
          <span className="tv-intro__dot" aria-hidden="true">◆</span>
          <span>
            <strong>en</strong> vinnare
          </span>
        </div>
        <div className="tv-intro__fr">Le moment de vérité</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plats 4 och nedåt – avslöjas från sista plats och uppåt            */
/* ------------------------------------------------------------------ */

export function RestStep({ results, positions, live }: StepProps & { positions: number[] }) {
  // positions kommer i avslöjandeordning (sista platsen först).
  const valid = positions.filter((p) => results.ranking[p]);
  const shown = useStagger(valid.length, {
    enabled: live,
    startMs: 900,
    everyMs: 800,
    onStep: (i) => {
      sound.tick();
      if (i === valid.length - 1) window.setTimeout(() => sound.chime(), 500);
    },
  });
  const revealed = new Set(valid.slice(0, shown));
  const rows = [...valid].sort((a, b) => a - b);
  const twoCols = rows.length > 5;
  const perCol = twoCols ? Math.ceil(rows.length / 2) : rows.length;
  const columns = twoCols ? [rows.slice(0, perCol), rows.slice(perCol)] : [rows];
  const s = perCol > 5 ? 5 / perCol : 1;
  const first = results.ranking[rows[0]];
  const last = results.ranking[rows[rows.length - 1]];

  return (
    <div className={`tv-cer tv-rest ${live ? 'is-live' : 'is-static'}`}>
      <Heading
        size="md"
        eyebrow={`Le classement · Plats ${first?.rank ?? 4}–${last?.rank ?? ''}`}
        title="En applåd för hela fältet"
        sub="Från sista plats och uppåt…"
      />
      <div className={`tv-rest__cols ${twoCols ? 'is-two' : ''}`} style={{ '--s': s } as CSSProperties}>
        {columns.map((col, ci) => (
          <ol key={ci} className="tv-rest__col">
            {col.map((pos) => (
              <RestRow key={pos} d={results.ranking[pos]} revealed={revealed.has(pos)} scale={s} />
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
}

function RestRow({ d, revealed, scale }: { d: DrinkResult; revealed: boolean; scale: number }) {
  return (
    <li className={`tv-rest__row ${revealed ? 'is-revealed' : ''}`}>
      <span className="tv-rest__rank tabular">{placeLabel(d.rank)}</span>
      {revealed ? (
        <span className="tv-rest__reveal">
          <Avatar emoji={d.emoji} color={d.color} size={Math.round(78 * scale)} />
          <span className="tv-rest__text">
            <span className="tv-rest__name">{d.name}</span>
            <span className="tv-rest__drink">{d.drink}</span>
          </span>
          <span className="tv-rest__score tabular">
            {formatScore(d.score)}
            <small>{d.score === null ? 'inga röster' : 'poäng'}</small>
          </span>
        </span>
      ) : (
        <span className="tv-rest__hidden" aria-label="Inte avslöjad än">
          <span className="tv-rest__q">?</span>
          <span className="tv-rest__bar" />
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Pallplats: trumvirvel → cymbal → avslöjande                        */
/* ------------------------------------------------------------------ */

function suspenseText(d: DrinkResult, tie: boolean): string {
  if (d.rank === 1) return tie ? 'Och kvällens delade vinnare är…' : 'Och kvällens vinnare är…';
  return `${tie ? 'Delad' : 'På'} ${ordinalWord(d.rank)}${tie ? 'plats' : ' plats'}…`;
}

export function PlaceStep({ results, position, live }: StepProps & { position: number }) {
  const d = results.ranking[position];
  const [revealed, setRevealed] = useState(!live);
  const isWinnerSlot = position === 0;
  const rollMs = isWinnerSlot ? 4000 : 2500;

  useTimeline((at) => {
    if (!d) return;
    at(350, () => void sound.drumroll(rollMs));
    at(350 + rollMs, () => {
      setRevealed(true);
      sound.cymbal();
      if (d.rank === 1) {
        confetti.cannons();
        confetti.burst(1);
        sound.applause(7000, 1);
      } else {
        confetti.burst(d.rank === 2 ? 0.55 : 0.38);
        sound.applause(3200, d.rank === 2 ? 0.6 : 0.45);
      }
    });
    if (d.rank === 1) {
      at(350 + rollMs + 500, () => sound.fanfare());
      at(350 + rollMs + 1400, () => confetti.rain(7000, 1.2));
    } else {
      at(350 + rollMs + 700, () => sound.chime());
    }
  }, live);

  if (!d) return null;
  const tie = results.ranking.filter((x) => x.rank === d.rank).length > 1;
  const medal = medalFor(d.rank);

  return (
    <div className={`tv-cer tv-place medal-${medal} ${revealed ? 'is-revealed' : 'is-suspense'} ${live ? 'is-live' : 'is-static'}`}>
      <Spotlights mode="focus" />
      {!revealed ? (
        <div className="tv-suspense" style={{ '--roll': `${rollMs}ms` } as CSSProperties}>
          <div className="tv-suspense__disc" aria-hidden="true">
            <span>{d.rank}</span>
          </div>
          <div className="tv-suspense__text">{suspenseText(d, tie)}</div>
        </div>
      ) : (
        <>
          {live && <div className="tv-flash" aria-hidden="true" />}
          <RevealCard d={d} tie={tie} animate={live} />
        </>
      )}
    </div>
  );
}

function RevealCard({ d, tie, animate }: { d: DrinkResult; tie: boolean; animate: boolean }) {
  const medal = medalFor(d.rank);
  const winner = d.rank === 1;
  const score = useCountUp(d.score, { enabled: animate, durationMs: winner ? 2200 : 1500, delayMs: 350 });
  return (
    <div className={`tv-reveal ${winner ? 'is-winner' : ''}`}>
      <div className="tv-reveal__visual">
        <div className="tv-reveal__rays" aria-hidden="true" />
        <div className="tv-reveal__glow" aria-hidden="true" />
        <Avatar emoji={d.emoji} color={d.color} size={winner ? 330 : 290} ring className="tv-reveal__avatar" />
        <div className="tv-reveal__medal" aria-hidden="true">
          {medalEmoji(d.rank) || placeLabel(d.rank)}
        </div>
      </div>
      <div className="tv-reveal__info">
        <div className="tv-eyebrow tv-reveal__fr">{MEDAL_FR[medal]}</div>
        <div className="tv-reveal__place">
          {winner ? (tie ? 'Delade vinnare' : 'Kvällens vinnare') : `${tie ? 'Delad ' : ''}${placeLabel(d.rank)} plats`}
        </div>
        <div className={`tv-reveal__name ${winner ? 'shimmer' : ''}`} style={{ fontSize: fitSize(d.name, winner ? 150 : 128, 72, 9) }}>
          {d.name}
        </div>
        <div className="tv-reveal__drink" style={{ fontSize: fitSize(d.drink, 64, 38, 20) }}>
          {d.drink}
        </div>
        <div className="tv-reveal__score">
          <span className="tv-reveal__score-num tabular">{d.score === null ? '–' : formatScore(score)}</span>
          <span className="tv-reveal__score-label">
            {d.score === null ? 'inga röster' : 'poäng'}
            <small>
              {votesLabel(d.voteCount)}
              {d.trimmed ? ' · OS-regeln' : ''}
            </small>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hela prispallen                                                     */
/* ------------------------------------------------------------------ */

export function PodiumStep({ results, live }: StepProps) {
  useTimeline((at) => {
    at(200, () => sound.whoosh());
    at(1700, () => {
      sound.chime();
      confetti.burst(0.3, { y: 0.35 });
    });
    at(2200, () => confetti.rain(5000, 0.7));
  }, live);
  return (
    <div className={`tv-cer tv-podium-step ${live ? 'is-live' : 'is-static'}`}>
      <Spotlights mode="idle" />
      <Heading size="md" eyebrow="Le Podium" title="Kvällens prispall" className="fade-up" />
      <Podium results={results} animate={live} />
    </div>
  );
}
