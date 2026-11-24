import { QRCode } from '../../../components/QRCode';
import * as confetti from '../../../lib/confetti';
import { appUrl } from '../../../lib/format';
import * as sound from '../../../lib/sound';
import { Podium } from '../parts';
import { siteAddress, useTimeline } from '../tvHooks';
import type { StepProps } from '../TvCeremony';

/** Avslutningen: prispallen, "Merci & santé !" och QR-kod till resultatsidan. */
export function FinaleStep({ results, gameId, live, finished }: StepProps & { finished: boolean }) {
  useTimeline((at) => {
    at(150, () => sound.fanfare());
    at(450, () => confetti.cannons());
    at(1800, () => confetti.rain(9000, 0.8));
    at(1900, () => sound.applause(5000, 0.7));
  }, live);

  return (
    <div className={`tv-cer tv-finale ${live ? 'is-live' : 'is-static'}`}>
      <div className="tv-finale__main">
        <div className="tv-finale__title">
          <span className="tv-finale__merci">Merci</span>
          <span className="tv-finale__amp">&amp;</span>
          <span className="tv-finale__sante">santé !</span>
          <span className="tv-finale__glass" aria-hidden="true">
            🥂
          </span>
        </div>
        {results.ranking.length > 0 && <Podium results={results} compact animate={live} />}
      </div>
      <aside className="tv-finale__side card card--deco card--gold">
        <div className="tv-eyebrow">Les résultats</div>
        <QRCode value={appUrl(`/results/${gameId}`)} size={250} className="tv-finale__qr" />
        <div className="tv-finale__cta">Se alla resultat</div>
        <div className="tv-finale__hint">Placeringar, betyg, kommentarer &amp; en Instagram-story</div>
        <div className={`tv-finale__hof ${finished ? 'is-saved' : ''}`}>
          <span aria-hidden="true">🏆</span>{' '}
          {finished ? 'Sparad i Hall of Fame' : 'Hall of Fame'}
          <span className="tv-finale__hof-url">{siteAddress()}/#/hall-of-fame</span>
        </div>
      </aside>
    </div>
  );
}
