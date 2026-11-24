import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { Logo } from '../../components/Logo';
import { RulesCard } from '../../components/RulesCard';
import { useUid } from '../../lib/hooks';
import {
  currentDrink,
  effectiveOrder,
  expectedVoters,
  hasVoted,
  nextDrinkIndex,
  playerEntries,
  votesForDrink,
} from '../../lib/selectors';
import type { Game, Player } from '../../lib/types';
import { AwardsScreen } from './AwardsForm';
import { CeremonyScreen } from './CeremonyScreen';
import { FinishedScreen } from './FinishedScreen';
import { PlayerForm } from './JoinForm';
import { Shaker } from './Shaker';
import { useTimeReached, vibrate } from './util';
import { VoteScreen } from './VoteForm';
import './player.css';

/**
 * Hur länge mobilen väntar efter en lottning innan den visar ens plats i ordningen,
 * så att storskärmens lottningsanimation hinner spelas klart först.
 */
const LOTTERY_REVEAL_MS = 9000;

type Drink = NonNullable<ReturnType<typeof currentDrink>>;

/**
 * Spelarens vy av ett pågående spel (lobby, röstning, specialpriser, prisutdelning, slutresultat).
 * Används av PlayView (helsida) och av AdminView-fliken "Min röst" (embedded = true).
 * Förutsätter att den inloggade användaren redan är spelare i game.
 */
export function PlayerGame({ gameId, game, embedded = false }: { gameId: string; game: Game; embedded?: boolean }) {
  const uid = useUid();
  const me = game.players[uid];
  const [showRules, setShowRules] = useState(false);
  const status = game.meta.status;
  const cur = status === 'running' ? game.current : undefined;
  const drink = status === 'running' ? currentDrink(game) : null;

  // Haptik: vibrera när röstningen öppnar eller när det är ens egen tur.
  const phaseKey = `${status}:${cur?.drinkId ?? ''}:${cur?.phase ?? ''}`;
  const lastKey = useRef(phaseKey);
  useEffect(() => {
    if (lastKey.current === phaseKey) return;
    lastKey.current = phaseKey;
    if (!me) return;
    if (status === 'running' && cur?.phase === 'voting' && cur.drinkId !== uid) vibrate([90, 60, 90]);
    else if (status === 'running' && cur?.phase === 'preparing' && cur.drinkId === uid) vibrate([220, 100, 220]);
    else if (status === 'awards') vibrate(80);
  }, [phaseKey, status, cur, uid, me]);

  // Stäng reglerna när skärmen byts.
  useEffect(() => {
    setShowRules(false);
  }, [phaseKey]);

  if (!me) {
    return (
      <div className={`pl ${embedded ? 'pl--embedded' : ''}`}>
        <NotPlayer gameId={gameId} game={game} />
      </div>
    );
  }

  let screen: ReactNode;
  let screenKey: string = status;
  switch (status) {
    case 'lobby':
      screen = <LobbyScreen gameId={gameId} game={game} uid={uid} me={me} />;
      break;
    case 'running':
      if (!cur || !drink) {
        screen = <WaitingScreen emoji="🥂" title="Tävlingen startar strax" text="Värden förbereder nästa drink – håll mobilen redo." />;
        screenKey = 'running:none';
      } else if (cur.phase === 'preparing') {
        screen = <PreparingScreen game={game} uid={uid} drink={drink} />;
        screenKey = `prep:${drink.id}`;
      } else if (cur.phase === 'voting') {
        screen =
          drink.id === uid ? (
            <OwnVotingScreen game={game} uid={uid} drink={drink} />
          ) : (
            <VoteScreen gameId={gameId} game={game} uid={uid} drink={drink} />
          );
        screenKey = `vote:${drink.id}`;
      } else {
        screen = <ClosedScreen game={game} uid={uid} drink={drink} />;
        screenKey = `closed:${drink.id}`;
      }
      break;
    case 'awards':
      screen = game.settings.awardsEnabled ? (
        <AwardsScreen gameId={gameId} game={game} uid={uid} />
      ) : (
        <WaitingScreen
          emoji="🎉"
          title="Alla drinkar är klara !"
          text="Snart börjar prisutdelningen – håll ögonen på storskärmen."
          fr="Merci à tous"
        />
      );
      break;
    case 'ceremony':
      screen = <CeremonyScreen game={game} uid={uid} />;
      break;
    case 'finished':
      screen = <FinishedScreen gameId={gameId} game={game} uid={uid} />;
      break;
  }

  return (
    <div className={`pl ${embedded ? 'pl--embedded' : ''}`}>
      <header className="pl-header">
        {!embedded && <Logo size="sm" className="pl-header__logo" />}
        <div className="pl-header__right">
          <span className="pl-me" title={`${me.name} – ${me.drink}`}>
            <Avatar emoji={me.emoji} color={me.color} size={30} />
            <span className="pl-me__name">{me.name}</span>
          </span>
          {status !== 'lobby' && (
            <button
              type="button"
              className={`btn btn--sm pl-header__rules ${showRules ? 'btn--gold' : 'btn--ghost'}`}
              aria-expanded={showRules}
              aria-controls="pl-rules"
              onClick={() => setShowRules((s) => !s)}
            >
              {showRules ? 'Stäng' : 'Regler'}
            </button>
          )}
        </div>
      </header>

      {showRules && (
        <div id="pl-rules" className="pl-rules fade-up">
          <RulesCard trimExtremes={game.settings.trimExtremes} awardsEnabled={game.settings.awardsEnabled} />
        </div>
      )}

      <section key={screenKey} className="pl-screen fade-up">
        {screen}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lobby                                                               */
/* ------------------------------------------------------------------ */

function LobbyScreen({ gameId, game, uid, me }: { gameId: string; game: Game; uid: string; me: Player }) {
  const [editing, setEditing] = useState(false);
  const players = playerEntries(game);
  const order = effectiveOrder(game);
  const myNumber = order.indexOf(uid) + 1;
  const hasOrder = game.order.length > 0 || !!game.lottery;
  const lotteryDone = useTimeReached(game.lottery ? game.lottery.at + LOTTERY_REVEAL_MS : 0);

  if (editing) {
    return (
      <div className="card card--deco stack-lg">
        <div className="center">
          <div className="eyebrow">Modifier</div>
          <h3 style={{ margin: '6px 0 0' }}>Ändra namn eller drink</h3>
        </div>
        <PlayerForm gameId={gameId} game={game} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="pl-hero">
        <div className="pl-hero__halo">
          <Avatar emoji={me.emoji} color={me.color} size={116} ring className="pop" />
        </div>
        <h1 className="pl-title">
          Du är med, <span className="gold-text">{me.name}</span> !
        </h1>
        <p className="pl-drinkname">“{me.drink}”</p>
        <button type="button" className="btn btn--ghost btn--sm pl-tap" onClick={() => setEditing(true)}>
          ✏️ Ändra namn eller drink
        </button>
      </div>

      {hasOrder &&
        (lotteryDone ? (
          <div className="card card--gold pl-order pop">
            <div className="pl-order__num" aria-hidden="true">
              <span>N°</span>
              {myNumber}
            </div>
            <div className="grow">
              <div className="eyebrow">L’ordre de passage</div>
              <div className="pl-order__text">
                Du är nummer <strong>{myNumber}</strong> i ordningen
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {myNumber === 1 ? 'Du börjar – ha shakern redo ! 🍸' : `av ${order.length} drinkar`}
              </div>
            </div>
          </div>
        ) : (
          <div className="card pl-order">
            <div className="pl-order__num pl-order__num--dice" aria-hidden="true">
              🎲
            </div>
            <div className="grow">
              <div className="eyebrow">Lottning pågår</div>
              <div className="pl-order__text">Titta på storskärmen !</div>
            </div>
          </div>
        ))}

      <div className="pl-waiting" role="status">
        <span className="loading__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Väntar på att spelet startar…</span>
      </div>

      <div className="card pl-guests">
        <div className="row-between">
          <div className="eyebrow">Les invités</div>
          <span className="pill pill--gold tabular">
            {players.length} {players.length === 1 ? 'gäst' : 'gäster'}
          </span>
        </div>
        <ul className="pl-guests__grid">
          {players.map(([id, p]) => (
            <li key={id} className={`pl-guest ${id === uid ? 'is-me' : ''}`}>
              <Avatar emoji={p.emoji} color={p.color} size={46} ring={id === uid} />
              <span className="pl-guest__name">{id === uid ? 'Du' : p.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <RulesCard trimExtremes={game.settings.trimExtremes} awardsEnabled={game.settings.awardsEnabled} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Nästa drink är på väg                                               */
/* ------------------------------------------------------------------ */

function PreparingScreen({ game, uid, drink }: { game: Game; uid: string; drink: Drink }) {
  const mine = drink.id === uid;
  const p = drink.player;
  const counter = `Drink ${drink.index + 1} av ${drink.total}`;

  if (mine) {
    return (
      <div className="pl-center">
        <div className="pl-spot">
          <Shaker size={150} />
        </div>
        <div className="eyebrow">{counter}</div>
        <h1 className="pl-title pl-title--xl">
          <span className="shimmer">Din tur !</span> 🍸
        </h1>
        <p className="pl-lead">
          Dags att blanda <span className="pl-drinkname pl-drinkname--inline">“{p.drink}”</span>
        </p>
        <div className="card card--deco card--gold pl-turncard">
          <p style={{ margin: 0 }}>
            <strong>Visa upp din drink när den är klar.</strong>
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.92rem' }}>
            Värden öppnar röstningen när alla har fått smaka. Du röstar inte på din egen drink.
          </p>
        </div>
        <p className="script pl-fr">Bonne chance !</p>
      </div>
    );
  }

  const isNextMe = (() => {
    const order = effectiveOrder(game);
    return order[drink.index + 1] === uid;
  })();

  return (
    <div className="pl-center">
      <div className="eyebrow">{counter} · på väg</div>
      <div className="pl-mixing">
        <Avatar emoji={p.emoji} color={p.color} size={92} className="pl-mixing__avatar" />
        <div className="pl-mixing__shaker">
          <Shaker size={104} />
        </div>
      </div>
      <h2 className="pl-title">
        <span className="gold-text">{p.name}</span> blandar
      </h2>
      <p className="pl-drinkname">“{p.drink}”…</p>
      <p className="muted pl-sub">Röstningen öppnar när drinken är serverad. Håll mobilen redo !</p>
      {isNextMe && <div className="pill pill--gold">Du är näst på tur 🍸</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Röstning på min egen drink                                          */
/* ------------------------------------------------------------------ */

function OwnVotingScreen({ game, uid, drink }: { game: Game; uid: string; drink: Drink }) {
  const votes = votesForDrink(game, uid);
  const expected = expectedVoters(game, uid);
  const got = expected.filter((id) => votes[id]).length;
  const total = expected.length;
  const allIn = total > 0 && got >= total;
  const pct = total ? got / total : 0;
  const R = 52;
  const C = 2 * Math.PI * R;

  return (
    <div className="pl-center">
      <div className="eyebrow">Drink {drink.index + 1} av {drink.total}</div>
      <h1 className="pl-title">Luta dig tillbaka</h1>
      <p className="pl-lead">
        de andra betygsätter <span className="pl-drinkname pl-drinkname--inline">“{drink.player.drink}”</span>
      </p>

      <div className="pl-ring" role="img" aria-label={`${got} av ${total} har röstat`}>
        <svg viewBox="0 0 120 120" width="148" height="148" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="pl-ring__track" />
          <circle
            cx="60"
            cy="60"
            r={R}
            className="pl-ring__bar"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="pl-ring__label">
          <span className="pl-ring__num tabular">
            {got}
            <small>/{total}</small>
          </span>
          <span className="pl-ring__cap">röster</span>
        </div>
      </div>

      {total > 0 && (
        <ul className="pl-voters" aria-label="Vilka som har röstat">
          {expected.map((id) => {
            const p = game.players[id];
            const done = !!votes[id];
            return (
              <li key={id} title={`${p.name}${done ? ' har röstat' : ' har inte röstat än'}`}>
                <Avatar emoji={p.emoji} color={p.color} size={36} ring={done} dim={!done} badge={done ? '✓' : undefined} />
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted pl-sub">
        {allIn ? 'Alla har röstat ! 🎉 Värden låser rösterna strax.' : 'Poängen hålls hemliga till prisutdelningen 🤫'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rösterna är låsta                                                   */
/* ------------------------------------------------------------------ */

function ClosedScreen({ game, uid, drink }: { game: Game; uid: string; drink: Drink }) {
  const mine = drink.id === uid;
  const voted = hasVoted(game, drink.id, uid);
  const count = Object.keys(votesForDrink(game, drink.id)).length;
  const order = effectiveOrder(game);
  const nextIdx = nextDrinkIndex(game);
  const nextId = nextIdx !== null ? order[nextIdx] : null;
  const next = nextId ? game.players[nextId] : null;

  return (
    <div className="pl-center">
      <div className="pl-lock pop" aria-hidden="true">
        🔒
      </div>
      <div className="eyebrow">Drink {drink.index + 1} av {drink.total}</div>
      <h1 className="pl-title">Rösterna är låsta</h1>
      <div className="pl-status">
        {mine ? (
          <>
            Din drink fick <strong>{count}</strong> {count === 1 ? 'röst' : 'röster'} – poängen avslöjas på prisutdelningen 🤫
          </>
        ) : voted ? (
          <>
            <span className="pl-status__ok" aria-hidden="true">
              ✓
            </span>{' '}
            Din röst på <em>“{drink.player.drink}”</em> är inräknad
          </>
        ) : (
          <>Du hann inte rösta på “{drink.player.drink}” den här gången</>
        )}
      </div>

      <div className="divider" style={{ width: '60%' }} />

      {next && nextId === uid ? (
        <div className="card card--gold pl-next">
          <Avatar emoji={next.emoji} color={next.color} size={48} ring />
          <div className="grow">
            <div className="eyebrow">À toi !</div>
            <div className="pl-next__title">Du är näst på tur – gör dig redo ! 🍸</div>
          </div>
        </div>
      ) : next ? (
        <div className="card pl-next">
          <Avatar emoji={next.emoji} color={next.color} size={48} />
          <div className="grow">
            <div className="eyebrow">Härnäst</div>
            <div className="pl-next__title">
              <span className="pl-ellipsis">{next.name}</span>
              <span className="pl-next__drink">“{next.drink}”</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="pl-sub">Det var kvällens sista drink ! 🎉 Snart dags för final.</p>
      )}
      <p className="muted pl-sub">{next ? 'Nästa drink kommer snart…' : 'Värden tar oss vidare strax…'}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Övrigt                                                              */
/* ------------------------------------------------------------------ */

function WaitingScreen({ emoji, title, text, fr }: { emoji: string; title: string; text: string; fr?: string }) {
  return (
    <div className="pl-center">
      <div className="pl-bigemoji float" aria-hidden="true">
        {emoji}
      </div>
      <h1 className="pl-title">{title}</h1>
      <p className="muted pl-sub">{text}</p>
      {fr && <p className="script pl-fr">{fr}</p>}
    </div>
  );
}

/** Inbäddat (admin) när man inte är med som spelare – eller blivit borttagen. */
function NotPlayer({ gameId, game }: { gameId: string; game: Game }) {
  const status = game.meta.status;
  if (status !== 'lobby' && status !== 'running') {
    return (
      <div className="pl-note center">Du är inte med som deltagare i det här spelet, så du har inget att rösta på.</div>
    );
  }
  return (
    <div className="card card--deco stack-lg">
      <div className="center">
        <div className="eyebrow">Bienvenue</div>
        <h3 style={{ margin: '6px 0 0' }}>Gå med som deltagare</h3>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.92rem' }}>
          Skriv ditt namn och din drink för att kunna rösta.
        </p>
      </div>
      <PlayerForm gameId={gameId} game={game} onDone={() => {}} />
    </div>
  );
}
