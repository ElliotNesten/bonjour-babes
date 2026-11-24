import { useEffect, useMemo, useRef } from 'react';
import { Avatar } from '../../components/Avatar';
import { buildCeremonySteps, revealedPositions, type CeremonyStep } from '../../lib/ceremony';
import { formatScore, medal, placeLabel } from '../../lib/format';
import { computeResults, getAward } from '../../lib/scoring';
import type { AwardId, Game } from '../../lib/types';
import { useTimeReached, vibrate } from './util';

/**
 * Hur länge mobilen väntar efter att storskärmen bytt steg innan den visar ens egen
 * placering/pris – så att trumvirveln på storskärmen hinner klart och ingenting avslöjas i förväg.
 */
const REVEAL_DELAY_PLACE_MS = 7000;
const REVEAL_DELAY_AWARD_MS = 6000;
const revealDelayRest = (k: number) => Math.min(12000, 3000 + k * 900);

function delayFor(step: CeremonyStep, position: number): number {
  switch (step.kind) {
    case 'rest':
      return revealDelayRest(Math.max(0, step.positions.indexOf(position)));
    case 'place':
      return REVEAL_DELAY_PLACE_MS;
    case 'award':
      return REVEAL_DELAY_AWARD_MS;
    default:
      return 0;
  }
}

/** Under prisutdelningen: "Titta på storskärmen !" – och ens egen placering först när storskärmen har avslöjat den. */
export function CeremonyScreen({ game, uid }: { game: Game; uid: string }) {
  const results = useMemo(() => computeResults(game), [game]);
  const steps = useMemo(() => buildCeremonySteps(results, game.settings), [results, game.settings]);
  const stepIndex = Math.max(0, Math.min(game.ceremony?.step ?? 0, steps.length - 1));
  const stepAt = game.ceremony?.at ?? 0;

  const myPos = results.ranking.findIndex((d) => d.playerId === uid);
  const mine = myPos >= 0 ? results.ranking[myPos] : null;

  // Första steget där min placering avslöjas.
  const revealStep = useMemo(() => {
    if (myPos < 0) return -1;
    for (let i = 0; i < steps.length; i++) if (revealedPositions(steps, i).has(myPos)) return i;
    return -1;
  }, [steps, myPos]);

  let placeAt: number | null = null;
  if (revealStep >= 0 && stepIndex >= revealStep) {
    placeAt = stepIndex > revealStep ? 0 : stepAt + delayFor(steps[revealStep], myPos);
  }
  const placeVisible = useTimeReached(placeAt) && !!mine;

  // Specialpris jag har vunnit, i den ordning storskärmen visar dem.
  const myAwardSteps: { awardId: AwardId; i: number }[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'award' || i > stepIndex) return;
    const won = results.awards.find((r) => r.id === s.awardId)?.winners.some((w) => w.playerId === uid);
    if (won) myAwardSteps.push({ awardId: s.awardId, i });
  });
  const currentAward = myAwardSteps.find(({ i }) => i === stepIndex);
  const currentAwardVisible = useTimeReached(currentAward ? stepAt + REVEAL_DELAY_AWARD_MS : null);
  const visibleAwards = myAwardSteps
    .filter(({ i }) => i < stepIndex || currentAwardVisible)
    .map(({ awardId }) => getAward(awardId));

  // Vibrera en gång när min placering avslöjas.
  const buzzed = useRef(false);
  useEffect(() => {
    if (placeVisible && !buzzed.current) {
      buzzed.current = true;
      vibrate(mine && mine.rank <= 3 ? [120, 60, 120, 60, 400] : [120, 60, 120]);
    }
  }, [placeVisible, mine]);
  const awardBuzz = useRef(0);
  useEffect(() => {
    if (visibleAwards.length > awardBuzz.current) {
      if (awardBuzz.current > 0 || placeVisible) vibrate([80, 50, 80]);
      awardBuzz.current = visibleAwards.length;
    }
  }, [visibleAwards.length, placeVisible]);

  const shared = mine ? results.ranking.filter((d) => d.rank === mine.rank).length > 1 : false;

  return (
    <div className="pl-center pl-ceremony">
      <div className="pl-spotlight" aria-hidden="true" />

      {placeVisible && mine ? (
        <div className={`pl-reveal pop ${mine.rank <= 3 ? `pl-reveal--medal pl-reveal--${mine.rank}` : ''}`} role="status">
          <div className="eyebrow">{mine.rank === 1 ? 'Félicitations !' : 'Votre place'}</div>
          {mine.rank <= 3 && (
            <div className="pl-reveal__medal" aria-hidden="true">
              {medal(mine.rank)}
            </div>
          )}
          <h1 className="pl-title pl-title--xl">
            {mine.rank === 1 ? (
              <span className="shimmer">Du vann !</span>
            ) : (
              <>
                Du kom <span className="gold-text">{placeLabel(mine.rank)}</span> !
              </>
            )}
          </h1>
          <div className="pl-reveal__score tabular">
            {mine.score !== null ? (
              <>
                {formatScore(mine.score)} <small>poäng</small>
              </>
            ) : (
              <small>Inga röster</small>
            )}
          </div>
          <p className="pl-drinkname">“{mine.drink}”</p>
          {shared && <p className="hint">Delad placering – exakt lika poäng</p>}
        </div>
      ) : (
        <div className="pl-lookup">
          <div className="pl-bigemoji pl-lookup__eyes float" aria-hidden="true">
            👀
          </div>
          <h1 className="pl-title pl-title--xl">Titta på storskärmen !</h1>
          <p className="script pl-fr">Regardez l’écran…</p>
          <p className="muted pl-sub">Prisutdelningen pågår. Mesdames et messieurs, håll i glasen !</p>
        </div>
      )}

      {visibleAwards.map((a) => (
        <div key={a.id} className="card card--gold pl-myaward pop">
          <span className="pl-myaward__emoji" aria-hidden="true">
            {a.emoji}
          </span>
          <div className="grow">
            <div className="eyebrow">{a.fr}</div>
            <div className="pl-myaward__title">Du vann {a.title} !</div>
          </div>
        </div>
      ))}

      {placeVisible && mine && (
        <div className="pl-ceremony__more">
          <Avatar emoji={mine.emoji} color={mine.color} size={28} />
          <span className="muted">Fortsätt titta på storskärmen 👀</span>
        </div>
      )}
    </div>
  );
}
