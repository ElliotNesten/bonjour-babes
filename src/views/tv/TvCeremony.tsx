import { useEffect, useMemo, useState } from 'react';
import { buildCeremonySteps, type CeremonyStep } from '../../lib/ceremony';
import { computeResults, type Results } from '../../lib/scoring';
import * as sound from '../../lib/sound';
import { stopRain } from '../../lib/confetti';
import type { Game } from '../../lib/types';
import { CommentsStep } from './ceremony/CommentsStep';
import { AwardStep, CategoriesStep, StatsStep } from './ceremony/ExtrasSteps';
import { FinaleStep } from './ceremony/FinaleStep';
import { IntroStep, PlaceStep, PodiumStep, RestStep } from './ceremony/RevealSteps';

export interface StepProps {
  game: Game;
  gameId: string;
  results: Results;
  /** true = steget visas för första gången (spela upp ljud, trumvirvlar och konfetti). */
  live: boolean;
}

/**
 * Prisutdelningen på storskärmen. Renderar steget game.ceremony.step av
 * buildCeremonySteps(...). Dramatiken (ljud/konfetti/trumvirvlar) spelas bara när
 * steg-indexet ÖKAR medan skärmen är öppen – inte vid omladdning, bakåtsteg eller
 * när datan bara uppdateras.
 */
export function TvCeremony({ game, gameId, initialLive }: { game: Game; gameId: string; initialLive: boolean }) {
  const results = useMemo(() => computeResults(game), [game]);
  const steps = useMemo(() => buildCeremonySteps(results, game.settings), [results, game.settings]);
  const finished = game.meta.status === 'finished';
  const raw = finished ? steps.length - 1 : (game.ceremony?.step ?? 0);
  const stepIndex = Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, steps.length - 1));

  // Härled "live" när steget byts (React-mönstret för state som beror på props).
  const [view, setView] = useState({ index: stepIndex, live: initialLive });
  if (view.index !== stepIndex) setView({ index: stepIndex, live: stepIndex > view.index });

  // Byter admin steg mitt i en trumvirvel ska den inte fortsätta in i nästa steg.
  useEffect(
    () => () => {
      sound.stopAll('drumroll');
      stopRain();
    },
    [stepIndex],
  );

  const step = steps[stepIndex];
  const props: StepProps = { game, gameId, results, live: view.live && view.index === stepIndex };

  return (
    <main className={`tv-screen tv-cer-screen tv-cer-screen--${step.kind}`} key={`${stepIndex}:${step.kind}`}>
      {renderStep(step, props, finished)}
    </main>
  );
}

function renderStep(step: CeremonyStep, props: StepProps, finished: boolean) {
  switch (step.kind) {
    case 'intro':
      return <IntroStep {...props} />;
    case 'rest':
      return <RestStep {...props} positions={step.positions} />;
    case 'place':
      return <PlaceStep {...props} position={step.position} />;
    case 'podium':
      return <PodiumStep {...props} />;
    case 'award':
      return <AwardStep {...props} awardId={step.awardId} />;
    case 'categories':
      return <CategoriesStep {...props} />;
    case 'stats':
      return <StatsStep {...props} />;
    case 'comments':
      return <CommentsStep {...props} />;
    case 'finale':
      return <FinaleStep {...props} finished={finished} />;
  }
}
