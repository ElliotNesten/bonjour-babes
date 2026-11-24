import type { CSSProperties } from 'react';
import { Avatar } from '../../components/Avatar';
import { CoupeIcon, Ornament } from '../../components/Ornament';
import { currentDrink, effectiveOrder, expectedVoters, hasVoted, nextDrinkIndex, votesForDrink } from '../../lib/selectors';
import * as sound from '../../lib/sound';
import type { Game, Player } from '../../lib/types';
import { CornerLogo, OrderStrip, ProgressRing, ShakerArt } from './parts';
import { fitSize, useArrivals, useBecameTrue, votesLabel } from './tvHooks';

export function TvRunning({ game }: { game: Game }) {
  const cur = currentDrink(game);
  const phase = game.current?.phase ?? 'preparing';

  return (
    <main className="tv-screen tv-run">
      <header className="tv-topbar">
        <CornerLogo />
        {cur && (
          <div className="tv-topbar__center">
            <span className="tv-topbar__count tabular">
              Drink {cur.index + 1} <span className="tv-topbar__of">av</span> {cur.total}
            </span>
          </div>
        )}
        <div className="tv-topbar__right" />
      </header>

      <div className="tv-run__main" key={cur ? `${cur.id}:${phase}` : 'none'}>
        {!cur ? (
          <Waiting />
        ) : phase === 'preparing' ? (
          <Preparing player={cur.player} index={cur.index} />
        ) : phase === 'voting' ? (
          <Voting game={game} drinkId={cur.id} player={cur.player} />
        ) : (
          <Closed game={game} drinkId={cur.id} player={cur.player} />
        )}
      </div>

      <OrderStrip game={game} />
    </main>
  );
}

function Waiting() {
  return (
    <div className="tv-prep">
      <CoupeIcon size={160} className="float" />
      <div className="tv-prep__who">Ett ögonblick…</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "Nästa drink är på väg"                                            */
/* ------------------------------------------------------------------ */

function Preparing({ player, index }: { player: Player; index: number }) {
  const drinkSize = fitSize(player.drink, 150, 76, 14);
  return (
    <div className="tv-prep">
      <div className="tv-eyebrow tv-prep__eyebrow fade-up">{index === 0 ? 'Kvällens första drink' : 'Nästa drink'} · La prochaine création</div>
      <div className="tv-prep__stage fade-up" style={{ animationDelay: '0.1s' }}>
        <div className="tv-prep__halo" aria-hidden="true" />
        <Avatar emoji={player.emoji} color={player.color} size={230} ring className="tv-prep__avatar" />
        <div className="tv-prep__shaker">
          <ShakerArt size={190} />
        </div>
      </div>
      <div className="tv-prep__who fade-up" style={{ animationDelay: '0.25s' }}>
        <span className="tv-prep__name">{player.name}</span> blandar<span className="tv-dots" aria-hidden="true" />
      </div>
      <div
        className="tv-prep__drink shimmer fade-up"
        style={{ animationDelay: '0.4s', fontSize: drinkSize } as CSSProperties}
      >
        {player.drink}
      </div>
      <div className="tv-prep__hint fade-up" style={{ animationDelay: '0.6s' }}>
        Snart serverat – håll glasen redo <span aria-hidden="true">🥂</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Röstning pågår                                                      */
/* ------------------------------------------------------------------ */

function voterGrid(n: number): { cols: number; size: number } {
  if (n <= 4) return { cols: Math.max(1, n), size: 150 };
  if (n <= 12) return { cols: Math.ceil(n / 2), size: n <= 8 ? 140 : 116 };
  return { cols: Math.ceil(n / 3), size: 88 };
}

function Voting({ game, drinkId, player }: { game: Game; drinkId: string; player: Player }) {
  const voters = expectedVoters(game, drinkId);
  const done = voters.filter((id) => hasVoted(game, drinkId, id));
  const all = voters.length > 0 && done.length >= voters.length;

  useArrivals(
    done,
    (added) => {
      added.slice(0, 5).forEach((_, i) => window.setTimeout(() => sound.ding(done.length - added.length + i), i * 140));
    },
    drinkId,
  );
  useBecameTrue(all, () => window.setTimeout(() => sound.chime(), 350), drinkId);

  const { cols, size } = voterGrid(voters.length);
  const drinkSize = fitSize(player.drink, 72, 44, 18);

  return (
    <div className="tv-vote">
      <div className="tv-vote__left">
        <div className="tv-vote__head fade-up">
          <h1 className="tv-vote__title">
            Dags att rösta ! <span aria-hidden="true">📱</span>
          </h1>
          <div className="tv-vote__drink">
            <Avatar emoji={player.emoji} color={player.color} size={84} />
            <div className="tv-vote__drink-text">
              <span className="tv-vote__drink-name" style={{ fontSize: drinkSize }}>
                {player.drink}
              </span>
              <span className="tv-vote__by">av {player.name}</span>
            </div>
          </div>
        </div>
        {voters.length === 0 ? (
          <div className="tv-vote__none">Ingen annan kan rösta på den här drinken.</div>
        ) : (
          <div className="tv-voters" style={{ '--cols': cols, '--w': `${size + 44}px` } as CSSProperties}>
            {voters.map((id, i) => {
              const p = game.players[id];
              const ok = hasVoted(game, drinkId, id);
              return (
                <div
                  key={id}
                  className={`tv-voter ${ok ? 'is-done' : ''} fade-up`}
                  style={{ animationDelay: `${0.15 + i * 0.04}s` }}
                >
                  <Avatar emoji={p.emoji} color={p.color} size={size} ring={ok} dim={!ok} badge={ok ? '✓' : undefined} />
                  <span className="tv-voter__name">{p.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="tv-vote__right fade-up" style={{ animationDelay: '0.2s' }}>
        <ProgressRing done={done.length} total={voters.length} size={420}>
          <div className="tv-vote__count tabular" aria-live="polite">
            <span className="tv-vote__count-done" key={done.length}>
              {done.length}
            </span>
            <span className="tv-vote__count-sep">/</span>
            <span className="tv-vote__count-total">{voters.length}</span>
          </div>
          <div className="tv-vote__count-label">har röstat</div>
        </ProgressRing>
        {all ? (
          <div className="tv-vote__all">
            <span className="tv-vote__all-text">Alla har röstat !</span> <span aria-hidden="true">🥂</span>
          </div>
        ) : (
          <div className="tv-vote__hint">Sätt 1–10 i fyra kategorier i mobilen</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Röstningen är låst                                                 */
/* ------------------------------------------------------------------ */

function Closed({ game, drinkId, player }: { game: Game; drinkId: string; player: Player }) {
  const nextIdx = nextDrinkIndex(game);
  const order = effectiveOrder(game);
  const nextId = nextIdx !== null ? order[nextIdx] : null;
  const next = nextId ? game.players[nextId] : null;
  const count = Object.keys(votesForDrink(game, drinkId)).length;

  return (
    <div className="tv-closed">
      <div className="tv-closed__lock pop" aria-hidden="true">
        🔒
      </div>
      <h1 className="tv-closed__title fade-up">Rösterna är låsta</h1>
      <div className="tv-closed__merci fade-up" style={{ animationDelay: '0.15s' }}>
        Merci !
      </div>
      <div className="tv-closed__done fade-up" style={{ animationDelay: '0.25s' }}>
        <em>{player.drink}</em> av {player.name} · {votesLabel(count)}
      </div>
      <Ornament className="tv-closed__orn" />
      {next ? (
        <div className="tv-next card card--deco card--gold fade-up" style={{ animationDelay: '0.4s' }}>
          <div className="tv-eyebrow">Härnäst · Ensuite</div>
          <div className="tv-next__row">
            <Avatar emoji={next.emoji} color={next.color} size={112} />
            <div className="tv-next__text">
              <span className="tv-next__name">{next.name}</span>
              <span className="tv-next__drink" style={{ fontSize: fitSize(next.drink, 48, 30, 20) }}>
                {next.drink}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="tv-next card card--deco card--gold fade-up" style={{ animationDelay: '0.4s' }}>
          <div className="tv-eyebrow">C'est fini</div>
          <div className="tv-next__last">Sista drinken är klar !</div>
          <div className="tv-next__soon">
            Snart: {game.settings.awardsEnabled ? 'specialpriserna ✨' : 'prisutdelningen 🏆'}
          </div>
        </div>
      )}
    </div>
  );
}
