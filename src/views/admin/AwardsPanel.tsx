import { Avatar } from '../../components/Avatar';
import { goToDrink, startCeremony } from '../../lib/game';
import { AWARD_IDS, AWARDS } from '../../lib/scoring';
import { awardVoteProgress, effectiveOrder } from '../../lib/selectors';
import { useFeedback } from './feedback';
import type { PanelProps } from './panelTypes';
import { ActionBar, Cta, Progress, SectionHead } from './parts';
import { SettingsCard } from './SettingsCard';

/** Specialpris-röstningen: följ hur många som är klara och starta prisutdelningen. */
export function AwardsPanel({ game, gameId, uid, onMyVote }: PanelProps) {
  const { run, pending, confirm } = useFeedback();
  const busy = pending !== null;
  const progress = awardVoteProgress(game, AWARD_IDS).filter((p) => game.players[p.playerId]);
  const doneCount = progress.filter((p) => p.done >= p.total).length;
  const allDone = progress.length > 0 && doneCount === progress.length;
  const mine = progress.find((p) => p.playerId === uid);
  const iMustVote = game.settings.awardsEnabled && !!mine && mine.done < mine.total;
  const order = effectiveOrder(game);

  const start = async () => {
    if (game.settings.awardsEnabled && !allDone) {
      const waiting = progress.filter((p) => p.done < p.total).map((p) => game.players[p.playerId]?.name);
      const ok = await confirm({
        title: 'Alla har inte röstat klart',
        body: (
          <>
            {doneCount} av {progress.length} är klara. Väntar på: <strong>{waiting.join(', ')}</strong>. Starta prisutdelningen ändå?
          </>
        ),
        confirmLabel: 'Starta ändå',
      });
      if (!ok) return;
    }
    await run('ceremony', () => startCeremony(gameId), { success: 'Mesdames et messieurs… prisutdelningen börjar!' });
  };

  const backToDrinks = async () => {
    const last = order.length - 1;
    const p = game.players[order[last]];
    const ok = await confirm({
      title: 'Tillbaka till drinkarna?',
      body: (
        <>
          Specialpris-röstningen pausas och {p ? <strong>{p.name}s drink</strong> : 'sista drinken'} blir aktuell igen (på väg). Inga röster
          försvinner.
        </>
      ),
      confirmLabel: 'Gå tillbaka',
    });
    if (!ok || last < 0) return;
    await run('back', () => goToDrink(gameId, last));
  };

  return (
    <>
      <div className="adm-panel stack-lg">
        <section className="card card--deco card--gold stack adm-awards">
          <div className="center">
            <div className="eyebrow">Les prix spéciaux</div>
            <h2 className="adm-awards__title">Specialpriserna</h2>
            <p className="muted adm-awards__lead">
              {game.settings.awardsEnabled
                ? 'Alla röstar nu i mobilen. Bara ära – inga poäng.'
                : 'Specialpriserna är avstängda i inställningarna – du kan gå direkt till prisutdelningen.'}
            </p>
          </div>
          {game.settings.awardsEnabled && (
            <ul className="adm-award-chips" aria-label="Priserna">
              {AWARDS.map((a) => (
                <li key={a.id} className="adm-award-chip">
                  <span aria-hidden="true">{a.emoji}</span> {a.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        {iMustVote && (
          <button type="button" className="adm-nudge adm-nudge--hot" onClick={onMyVote}>
            <span className="adm-nudge__icon" aria-hidden="true">
              🗳️
            </span>
            <span className="grow">
              <strong>Din röst saknas</strong>
              <span className="adm-nudge__sub">
                Du har röstat i {mine?.done ?? 0} av {mine?.total ?? AWARD_IDS.length} priser.
              </span>
            </span>
            <span className="adm-nudge__arrow" aria-hidden="true">
              →
            </span>
          </button>
        )}

        {game.settings.awardsEnabled && (
          <section className="card stack" aria-labelledby="adm-award-progress">
            <SectionHead
              eyebrow="Le vote"
              title={<span id="adm-award-progress">Vilka är klara?</span>}
              aside={
                <span className={`pill tabular ${allDone ? 'pill--gold' : ''}`}>
                  {doneCount} av {progress.length} klara
                </span>
              }
            />
            <Progress value={doneCount} max={progress.length} label="Andel som röstat klart" />
            {progress.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Ingen deltagare har en egen mobil – det finns ingen som kan rösta.
              </p>
            ) : (
              <ul className="adm-award-progress">
                {progress.map((p) => {
                  const player = game.players[p.playerId];
                  const done = p.done >= p.total;
                  return (
                    <li key={p.playerId} className={`adm-award-row ${done ? 'is-done' : ''}`}>
                      <Avatar emoji={player.emoji} color={player.color} size={36} ring={done} dim={!done && p.done === 0} />
                      <span className="grow truncate adm-award-row__name">
                        {player.name}
                        {p.playerId === uid && <span className="adm-tag adm-tag--gold">du</span>}
                      </span>
                      <span className="adm-award-row__dots" aria-hidden="true">
                        {Array.from({ length: p.total }, (_, i) => (
                          <span key={i} className={i < p.done ? 'is-on' : ''} />
                        ))}
                      </span>
                      <span className="adm-award-row__count tabular" aria-label={`${p.done} av ${p.total} priser`}>
                        {done ? '✓' : `${p.done}/${p.total}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <details className="card adm-more">
          <summary className="adm-more__summary">
            <span>⚙️ Inställningar</span>
            <span className="adm-more__chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="stack adm-more__body">
            <SettingsCard game={game} gameId={gameId} fields={['name', 'trimExtremes', 'awardsEnabled', 'showJudgeNames']} flat />
            <button type="button" className="btn btn--ghost btn--block adm-btn-44" onClick={() => void backToDrinks()} disabled={busy || order.length === 0}>
              ◀ Tillbaka till drinkarna
            </button>
          </div>
        </details>
      </div>

      <ActionBar hint={allDone ? 'Alla har röstat – dags för det stora ögonblicket' : 'Starta när alla har röstat klart'}>
        <Cta
          kicker={game.settings.awardsEnabled ? `${doneCount} av ${progress.length} klara` : 'Le grand moment'}
          label="🎉 Starta prisutdelningen"
          onClick={() => void start()}
          disabled={busy}
          busy={pending === 'ceremony'}
          glow={allDone || !game.settings.awardsEnabled}
        />
      </ActionBar>
    </>
  );
}
