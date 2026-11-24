import { useMemo } from 'react';
import { CoupeIcon } from '../../components/Ornament';
import { StoryButton } from '../../components/StoryButton';
import { appUrl, formatDateTime } from '../../lib/format';
import { deleteGame, reopenGame } from '../../lib/game';
import { href, navigate } from '../../lib/router';
import { computeResults } from '../../lib/scoring';
import { useFeedback } from './feedback';
import type { PanelProps } from './panelTypes';
import { ActionBar, canShare, copyText, Cta, TrashIcon } from './parts';
import { SettingsCard } from './SettingsCard';

/** Spelet är avslutat: länkar till resultat & Hall of Fame, öppna igen eller radera. */
export function FinishedPanel({ game, gameId }: PanelProps) {
  const { run, pending, confirm, toast } = useFeedback();
  const busy = pending !== null;
  const results = useMemo(() => computeResults(game), [game]);
  const resultsUrl = appUrl(`/results/${gameId}`);

  const copy = async () => {
    const ok = await copyText(resultsUrl);
    toast(ok ? 'Länken till resultatsidan är kopierad' : 'Kunde inte kopiera länken', ok ? 'success' : 'error');
  };

  const share = async () => {
    try {
      await navigator.share({ title: `${game.meta.name} – resultat`, text: 'Kvällens placeringar, betyg och drinkar 🍸', url: resultsUrl });
    } catch {
      /* avbrutet */
    }
  };

  const reopen = async () => {
    const ok = await confirm({
      title: 'Öppna prisutdelningen igen?',
      body: 'Spelet tas bort ur Hall of Fame tills du avslutar det på nytt. Storskärmen går tillbaka till prisutdelningen.',
      confirmLabel: 'Öppna igen',
    });
    if (!ok) return;
    await run('reopen', () => reopenGame(gameId, 'ceremony'), { success: 'Prisutdelningen är öppen igen' });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Radera "${game.meta.name}"?`,
      body: 'Spelet raderas helt – deltagare, betyg, kommentarer och platsen i Hall of Fame. Det går inte att ångra.',
      confirmLabel: 'Radera för alltid',
      danger: true,
    });
    if (!ok) return;
    const done = await run('delete', () => deleteGame(gameId), { success: 'Spelet är raderat' });
    if (done) navigate('/admin', true);
  };

  return (
    <>
      <div className="adm-panel stack-lg">
        <section className="card card--deco card--gold adm-fin center">
          <CoupeIcon size={56} className="adm-fin__icon float" />
          <div className="script adm-fin__script">Merci !</div>
          <h2 className="adm-fin__title">Spelet är avslutat – merci !</h2>
          <p className="muted adm-fin__lead">
            {game.meta.finishedAt ? `Avslutat ${formatDateTime(game.meta.finishedAt)}. ` : ''}
            Resultatet är sparat i Hall of Fame. Dela länken så att alla kan se placeringar, betyg och drinkar.
          </p>
          <div className="adm-fin__share">
            <button type="button" className="adm-chip" onClick={() => void copy()}>
              🔗 Kopiera resultatlänk
            </button>
            {canShare() && (
              <button type="button" className="adm-chip" onClick={() => void share()}>
                ↗ Dela
              </button>
            )}
          </div>
          {results.ranking.length > 0 && <StoryButton game={game} gameId={gameId} results={results} className="btn--bordeaux btn--block adm-btn-44" />}
          <a className="btn btn--ghost btn--block adm-btn-44" href={href('/hall-of-fame')}>
            🏆 Hall of Fame
          </a>
        </section>

        <SettingsCard game={game} gameId={gameId} fields={['showJudgeNames']} />

        <section className="card stack adm-danger">
          <div>
            <div className="eyebrow">Encore une fois ?</div>
            <h3 className="adm-section-head__title">Ångra eller städa</h3>
          </div>
          <button type="button" className="btn btn--ghost btn--block adm-btn-44 adm-btn-plain" onClick={() => void reopen()} disabled={busy}>
            {pending === 'reopen' ? 'Öppnar…' : '↺ Öppna prisutdelningen igen'}
          </button>
          <button type="button" className="btn btn--danger btn--block adm-btn-44 adm-btn-plain" onClick={() => void remove()} disabled={busy}>
            <TrashIcon /> {pending === 'delete' ? 'Raderar…' : 'Radera spelet'}
          </button>
        </section>
      </div>

      <ActionBar>
        <Cta kicker="Placeringar, betyg & drinkar" label="📜 Öppna resultatsidan" href={href(`/results/${gameId}`)} />
      </ActionBar>
    </>
  );
}
