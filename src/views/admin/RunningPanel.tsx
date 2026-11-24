import { Avatar } from '../../components/Avatar';
import { closeVoting, drawOrder, goToDrink, nextDrink, openVoting, startAwards, startCeremony } from '../../lib/game';
import { completedDrinkIds, currentDrink, effectiveOrder, expectedVoters, hasVoted, nextDrinkIndex } from '../../lib/selectors';
import type { Game, RoundPhase } from '../../lib/types';
import { useFeedback } from './feedback';
import type { PanelProps } from './panelTypes';
import { ActionBar, Cta, Progress, SectionHead } from './parts';
import { PlayerList } from './PlayerList';
import { AddManualPlayer, SettingsCard } from './SettingsCard';

const PHASE_PILL: Record<RoundPhase, { text: string; cls: string }> = {
  preparing: { text: 'På väg 🍸', cls: 'pill--gold' },
  voting: { text: 'Röstning pågår', cls: 'pill--live' },
  closed: { text: 'Låst 🔒', cls: '' },
};

/** Tävlingen pågår: en drink i taget – serveras, röstas, låses, nästa. */
export function RunningPanel({ game, gameId, uid, onMyVote }: PanelProps) {
  const { run, pending, confirm } = useFeedback();
  const busy = pending !== null;
  const order = effectiveOrder(game);
  const cur = currentDrink(game);
  const phase: RoundPhase = game.current?.phase ?? 'preparing';
  const doneCount = completedDrinkIds(game).length;
  const nextIdx = nextDrinkIndex(game);
  const nextPlayer = nextIdx !== null ? game.players[order[nextIdx]] : undefined;
  const voters = cur ? expectedVoters(game, cur.id) : [];
  const voted = cur ? voters.filter((v) => hasVoted(game, cur.id, v)) : [];
  const missing = voters.filter((v) => !voted.includes(v));
  const allVoted = voters.length > 0 && missing.length === 0;
  const iMustVote = !!cur && phase === 'voting' && voters.includes(uid) && !voted.includes(uid);
  const upcomingCount = order.length - (cur ? cur.index + 1 : 0);
  const startedAt = game.meta.startedAt ?? 0;
  const lateJoiners = startedAt ? order.filter((id) => game.players[id] && game.players[id].joinedAt > startedAt) : [];

  /* ------------------------------ åtgärder ------------------------------ */

  const open = () => run('open', () => openVoting(gameId));

  const close = async () => {
    if (voters.length > 0 && missing.length > 0) {
      const names = missing.map((id) => game.players[id]?.name).filter(Boolean);
      const ok = await confirm({
        title: 'Alla har inte röstat',
        body: (
          <>
            {voted.length} av {voters.length} har röstat. Saknas: <strong>{names.join(', ')}</strong>. Du kan öppna röstningen igen efteråt
            om någon hann före.
          </>
        ),
        confirmLabel: 'Lås ändå',
      });
      if (!ok) return;
    }
    await run('close', () => closeVoting(gameId));
  };

  const next = () =>
    run('next', async () => {
      if (!(await nextDrink(gameId))) throw new Error('Det finns inga fler drinkar');
    });

  const toAwards = () => run('awards', () => startAwards(gameId), { success: 'Specialpriserna är öppna – alla röstar i mobilen' });
  const toCeremony = () => run('ceremony', () => startCeremony(gameId), { success: 'Mesdames et messieurs… prisutdelningen börjar!' });

  const recover = () => {
    const index = Math.max(0, Math.min(game.current?.index ?? 0, order.length - 1));
    return run('recover', () => goToDrink(gameId, index));
  };

  const redrawRest = async () => {
    const ok = await confirm({
      title: 'Lotta om resten?',
      body: `De ${upcomingCount} drinkar som inte har serverats än får en ny slumpad ordning. Storskärmen visar lottningen.`,
      confirmLabel: '🎲 Lotta om',
    });
    if (!ok) return;
    await run('draw', () => drawOrder(gameId), { success: 'Resten av ordningen är omlottad 🎲' });
  };

  /* ------------------------------ huvudknapp ------------------------------ */

  let cta;
  if (!cur) {
    cta = order.length ? (
      <Cta kicker="Ingen aktuell drink" label="▶ Fortsätt med nästa drink" onClick={() => void recover()} disabled={busy} busy={pending === 'recover'} />
    ) : (
      <Cta kicker="Inga deltagare kvar" label="Lägg till deltagare först" disabled />
    );
  } else if (phase === 'preparing') {
    cta = <Cta kicker="🍸 Drinken är serverad" label="Öppna röstningen" onClick={() => void open()} disabled={busy} busy={pending === 'open'} glow />;
  } else if (phase === 'voting') {
    cta = (
      <Cta
        kicker={voters.length ? `${voted.length} av ${voters.length} har röstat` : 'Ingen kan rösta på den här'}
        label="🔒 Lås röstningen"
        variant={allVoted || voters.length === 0 ? 'gold' : 'bordeaux'}
        glow={allVoted}
        onClick={() => void close()}
        disabled={busy}
        busy={pending === 'close'}
      />
    );
  } else if (nextPlayer) {
    cta = (
      <Cta
        kicker="➡️ Nästa drink"
        label={
          <>
            {nextPlayer.name} – <em>{nextPlayer.drink}</em>
          </>
        }
        onClick={() => void next()}
        disabled={busy}
        busy={pending === 'next'}
        compact={nextPlayer.name.length + nextPlayer.drink.length > 30}
        glow
      />
    );
  } else if (game.settings.awardsEnabled) {
    cta = <Cta kicker="Alla drinkar är klara" label="🏆 Till specialpriserna" onClick={() => void toAwards()} disabled={busy} busy={pending === 'awards'} glow />;
  } else {
    cta = <Cta kicker="Alla drinkar är klara" label="🎉 Starta prisutdelningen" onClick={() => void toCeremony()} disabled={busy} busy={pending === 'ceremony'} glow />;
  }

  const barHint =
    cur && phase === 'preparing'
      ? `Tryck när ${cur.player.name} har serverat alla`
      : cur && phase === 'closed' && !nextPlayer
        ? 'Det var sista drinken – bravo !'
        : undefined;

  return (
    <>
      <div className="adm-panel stack-lg">
        {cur ? (
          <section className={`card card--deco card--gold adm-current adm-current--${phase}`} aria-live="polite">
            <div className="row-between">
              <span className="eyebrow">
                Drink {cur.index + 1} av {cur.total}
              </span>
              <span className={`pill ${PHASE_PILL[phase].cls}`}>{PHASE_PILL[phase].text}</span>
            </div>
            <div className="adm-current__who">
              <Avatar emoji={cur.player.emoji} color={cur.player.color} size={64} ring={phase === 'voting'} />
              <div className="grow">
                <div className="adm-current__name">
                  <span className="truncate">{cur.player.name}</span>
                  {cur.id === uid && <span className="adm-tag adm-tag--gold">du</span>}
                  {cur.player.manual && <span className="adm-tag">utan mobil</span>}
                </div>
                <div className="adm-current__drink">{cur.player.drink}</div>
              </div>
            </div>

            {phase === 'preparing' && (
              <p className="adm-current__status">
                Storskärmen visar att drinken är på väg. När alla har fått sitt glas öppnar du röstningen.
              </p>
            )}

            {phase === 'voting' && (
              <VoterGrid game={game} drinkId={cur.id} voters={voters} votedCount={voted.length} creatorName={cur.player.name} isMyDrink={cur.id === uid} />
            )}

            {phase === 'closed' && (
              <div className="adm-current__closed">
                <p className="adm-current__status" style={{ margin: 0 }}>
                  Röstningen är låst – {voted.length} av {voters.length} röstade.
                </p>
                <button type="button" className="adm-chip" onClick={() => void open()} disabled={busy}>
                  ↺ Öppna röstningen igen
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="card card--deco stack">
            <h3 style={{ margin: 0 }}>Ingen aktuell drink</h3>
            <p className="muted" style={{ margin: 0 }}>
              {order.length
                ? 'Drinken som var på gång finns inte längre (deltagaren togs bort). Fortsätt med nästa i ordningen.'
                : 'Alla deltagare är borttagna. Lägg till deltagare för att fortsätta.'}
            </p>
          </section>
        )}

        {iMustVote && (
          <button type="button" className="adm-nudge adm-nudge--hot" onClick={onMyVote}>
            <span className="adm-nudge__icon" aria-hidden="true">
              🗳️
            </span>
            <span className="grow">
              <strong>Din röst saknas</strong>
              <span className="adm-nudge__sub">Du är också domare – betygsätt {cur?.player.name}s drink.</span>
            </span>
            <span className="adm-nudge__arrow" aria-hidden="true">
              →
            </span>
          </button>
        )}

        <section className="card stack" aria-labelledby="adm-order-title">
          <SectionHead
            eyebrow="Le programme"
            title={<span id="adm-order-title">Kvällens ordning</span>}
            aside={
              <span className="pill tabular">
                {doneCount} av {order.length} klara
              </span>
            }
          />
          {lateJoiners.length > 0 && (
            <p className="hint adm-late-note">
              ✨ {lateJoiners.map((id) => game.players[id].name).join(', ')} gick med under kvällen och lades sist i ordningen.
            </p>
          )}
          <PlayerList game={game} gameId={gameId} uid={uid} mode="running" />
          {upcomingCount >= 2 && (
            <button type="button" className="btn btn--ghost btn--block adm-btn-44" onClick={() => void redrawRest()} disabled={busy}>
              {pending === 'draw' ? 'Lottar…' : `🎲 Lotta om resten (${upcomingCount})`}
            </button>
          )}
        </section>

        <details className="card adm-more">
          <summary className="adm-more__summary">
            <span>⚙️ Inställningar & fler deltagare</span>
            <span className="adm-more__chev" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="stack adm-more__body">
            <AddManualPlayer gameId={gameId} />
            <SettingsCard game={game} gameId={gameId} flat />
          </div>
        </details>
      </div>

      <ActionBar hint={barHint}>{cta}</ActionBar>
    </>
  );
}

function VoterGrid({
  game,
  drinkId,
  voters,
  votedCount,
  creatorName,
  isMyDrink,
}: {
  game: Game;
  drinkId: string;
  voters: string[];
  votedCount: number;
  creatorName: string;
  isMyDrink: boolean;
}) {
  if (voters.length === 0) {
    return <p className="adm-current__status">Ingen kan rösta på den här drinken – alla andra saknar mobil. Lås röstningen och gå vidare.</p>;
  }
  const all = votedCount === voters.length;
  return (
    <div className="adm-voters stack">
      <div className="row-between">
        <span className="adm-voters__label">
          {all ? 'Alla har röstat ! 🎉' : isMyDrink ? `Din drink – de andra röstar nu` : `Alla utom ${creatorName} röstar nu`}
        </span>
        <span className="adm-voters__count tabular" aria-label={`${votedCount} av ${voters.length} har röstat`}>
          {votedCount}
          <span className="dim">/{voters.length}</span>
        </span>
      </div>
      <Progress value={votedCount} max={voters.length} label="Andel som har röstat" />
      <ul className="adm-voters__grid">
        {voters.map((id) => {
          const p = game.players[id];
          if (!p) return null;
          const done = hasVoted(game, drinkId, id);
          return (
            <li key={id} className={`adm-voter ${done ? 'is-done' : ''}`}>
              <Avatar emoji={p.emoji} color={p.color} size={40} ring={done} dim={!done} badge={done ? '✓' : undefined} title={`${p.name} – ${done ? 'har röstat' : 'har inte röstat än'}`} />
              <span className="adm-voter__name truncate">{p.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
