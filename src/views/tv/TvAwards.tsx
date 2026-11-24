import type { CSSProperties } from 'react';
import { Avatar } from '../../components/Avatar';
import { AWARDS, AWARD_IDS } from '../../lib/scoring';
import { awardVoteProgress } from '../../lib/selectors';
import * as sound from '../../lib/sound';
import type { Game } from '../../lib/types';
import { CornerLogo, Heading } from './parts';
import { useArrivals, useBecameTrue } from './tvHooks';

/** Specialpris-röstningen: korten för priserna och vilka som har röstat klart. */
export function TvAwards({ game }: { game: Game }) {
  const progress = awardVoteProgress(game, AWARD_IDS);
  const done = progress.filter((p) => p.done >= p.total).map((p) => p.playerId);
  const all = progress.length > 0 && done.length >= progress.length;

  useArrivals(done, (added) => {
    added.slice(0, 5).forEach((_, i) => window.setTimeout(() => sound.ding(done.length - added.length + i), i * 140));
  });
  useBecameTrue(all, () => window.setTimeout(() => sound.chime(), 350));

  const n = progress.length;
  // Alla på en rad (upp till ~16 personer): raden är 1720 px, varje person tar avatar + 40 px + 26 px mellanrum.
  const size = Math.max(40, Math.min(96, Math.floor((1720 + 26) / Math.max(1, n)) - 67));

  return (
    <main className="tv-screen tv-awards">
      <header className="tv-topbar">
        <CornerLogo />
        <div className="tv-topbar__center">
          <span className="tv-topbar__count">Alla drinkar är klara</span>
        </div>
        <div className="tv-topbar__right" />
      </header>

      <Heading
        className="fade-up"
        eyebrow="Les prix spéciaux"
        title="Specialpriserna"
        sub="Bara ära – inga poäng. Rösta i mobilen !"
      />

      <div className="tv-award-cards">
        {AWARDS.map((a, i) => (
          <div key={a.id} className="tv-award-card card card--deco fade-up" style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
            <div className="tv-award-card__emoji" aria-hidden="true">
              {a.emoji}
            </div>
            <div className="tv-award-card__title">{a.title}</div>
            <div className="tv-award-card__fr">{a.fr}</div>
            <div className="tv-award-card__q">{a.question}</div>
          </div>
        ))}
      </div>

      <section className="tv-award-progress fade-up" style={{ animationDelay: '0.7s' }}>
        <div className={`tv-award-progress__status ${all ? 'is-all' : ''}`} aria-live="polite">
          {all ? (
            <>
              Alla har röstat ! <span aria-hidden="true">🥂</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">📱</span> Rösta i mobilen ·{' '}
              <span className="tabular">
                {done.length} / {n}
              </span>{' '}
              klara
            </>
          )}
        </div>
        <div className="tv-award-progress__people" style={{ '--size': `${size}px` } as CSSProperties}>
          {progress.map(({ playerId, done: d, total }) => {
            const p = game.players[playerId];
            if (!p) return null;
            const finished = d >= total;
            return (
              <div key={playerId} className={`tv-award-person ${finished ? 'is-done' : ''}`}>
                <Avatar
                  emoji={p.emoji}
                  color={p.color}
                  size={size}
                  ring={finished}
                  dim={!finished}
                  badge={finished ? '✓' : d > 0 ? `${d}` : undefined}
                />
                <span className="tv-award-person__name">{p.name}</span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
