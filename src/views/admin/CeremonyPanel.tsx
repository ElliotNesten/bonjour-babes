import { useEffect, useMemo, useRef } from 'react';
import { buildCeremonySteps, stepLabel, type CeremonyStep } from '../../lib/ceremony';
import { placeLabel } from '../../lib/format';
import { finishGame, setCeremonyStep } from '../../lib/game';
import { computeResults, type Results } from '../../lib/scoring';
import { useFeedback } from './feedback';
import type { PanelProps } from './panelTypes';
import { ActionBar, Cta, Progress } from './parts';

/**
 * Prisutdelningen: admin bläddrar steg för steg medan storskärmen avslöjar.
 * Etiketterna (stepLabel) avslöjar aldrig vem som vinner – inga poäng visas här.
 */
export function CeremonyPanel({ game, gameId, active }: PanelProps) {
  const { run, pending, confirm, modalOpen } = useFeedback();
  const busy = pending !== null;
  const results = useMemo(() => computeResults(game), [game]);
  const steps = useMemo(() => buildCeremonySteps(results, game.settings), [results, game.settings]);
  const labels = useMemo(() => steps.map((s) => adminStepLabel(s, results)), [steps, results]);
  const last = steps.length - 1;
  const step = Math.max(0, Math.min(game.ceremony?.step ?? 0, last));
  const isLast = step >= last;
  const currentRef = useRef<HTMLLIElement>(null);

  const goTo = (target: number) => run(`step:${target}`, () => setCeremonyStep(gameId, target));
  const next = () => (isLast ? undefined : goTo(step + 1));
  const back = () => (step > 0 ? goTo(step - 1) : undefined);
  const finish = () => run('finish', () => finishGame(gameId), { success: 'Sparat i Hall of Fame – merci !' });

  const jump = async (target: number) => {
    if (target === step) return;
    if (target > step + 1) {
      const ok = await confirm({
        title: `Hoppa till steg ${target + 1}?`,
        body: (
          <>
            Storskärmen hoppar direkt till <strong>{labels[target]}</strong> och hoppar över {target - step - 1} steg på vägen.
          </>
        ),
        confirmLabel: 'Hoppa',
      });
      if (!ok) return;
    }
    await goTo(target);
  };

  // Håll det aktuella steget i bild.
  useEffect(() => {
    if (!active) return;
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step, active]);

  // Piltangenter / presentationsklicker (PageDown/PageUp) när admin kör från en dator.
  const keyRef = useRef({ next, back });
  useEffect(() => {
    keyRef.current = { next, back };
  });
  useEffect(() => {
    if (!active || modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        void keyRef.current.next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        void keyRef.current.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, modalOpen]);

  return (
    <>
      <div className="adm-panel stack-lg">
        <section className="card card--deco card--gold stack adm-cer">
          <div className="center">
            <div className="eyebrow">Le grand finale</div>
            <h2 className="adm-cer__title">Prisutdelning</h2>
          </div>
          <div className="adm-cer__tip">
            <span aria-hidden="true">📺</span>
            <span>Tryck när storskärmen är klar med avslöjandet</span>
          </div>
          <div className="row-between adm-cer__progress-label">
            <span>
              Steg <strong className="tabular">{step + 1}</strong> av <span className="tabular">{steps.length}</span>
            </span>
            <span className="dim">Inga poäng visas här – no spoilers</span>
          </div>
          <Progress value={step + 1} max={steps.length} label="Prisutdelningens förlopp" />
        </section>

        <ol className="adm-steps" aria-label="Prisutdelningens steg">
          {labels.map((label, i) => {
            const state = i < step ? 'past' : i === step ? 'current' : 'next';
            return (
              <li key={`${i}-${steps[i].kind}`} ref={i === step ? currentRef : undefined} className={`adm-step adm-step--${state}`}>
                <button
                  type="button"
                  className="adm-step__btn"
                  onClick={() => void jump(i)}
                  disabled={busy || i === step}
                  aria-current={i === step ? 'step' : undefined}
                >
                  <span className="adm-step__marker tabular" aria-hidden="true">
                    {state === 'past' ? '✓' : i + 1}
                  </span>
                  <span className="adm-step__label">{label}</span>
                  {state === 'current' && <span className="pill pill--live adm-step__live">På skärmen</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <ActionBar hint={isLast ? 'Sista steget – avsluta när applåderna lagt sig' : undefined}>
        <button type="button" className="btn btn--ghost adm-back" onClick={() => void back()} disabled={busy || step === 0} aria-label="Bakåt – föregående steg">
          ◀<span className="adm-back__text">Bakåt</span>
        </button>
        {isLast ? (
          <Cta kicker="Merci !" label="Avsluta & spara i Hall of Fame" onClick={() => void finish()} disabled={busy} busy={pending === 'finish'} glow />
        ) : (
          <Cta kicker="Nästa ▶" label={labels[step + 1]} onClick={() => void next()} disabled={busy} busy={pending === `step:${step + 1}`} compact={labels[step + 1].length > 30} glow />
        )}
      </ActionBar>
    </>
  );
}

const PLACE_MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Stegets etikett i adminpanelen. Placeringsstegen namnges efter position i stället för
 * rank, så att etiketterna inte heller avslöjar delade placeringar (t.ex. "plats 1–1").
 */
function adminStepLabel(step: CeremonyStep, results: Results): string {
  if (step.kind === 'place') return `Avslöja ${placeLabel(step.position + 1)} plats ${PLACE_MEDALS[step.position] ?? ''}`.trim();
  if (step.kind === 'rest' && step.positions.length) {
    const from = Math.min(...step.positions) + 1;
    const to = Math.max(...step.positions) + 1;
    return from === to ? `Avslöja ${placeLabel(from)} plats` : `Avslöja plats ${from}–${to}`;
  }
  return stepLabel(step, results);
}
