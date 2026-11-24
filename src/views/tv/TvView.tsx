import { useEffect, useRef, useState } from 'react';
import { Logo } from '../../components/Logo';
import { backend } from '../../lib/backend';
import { useGame, useWakeLock } from '../../lib/hooks';
import { href } from '../../lib/router';
import { effectiveOrder } from '../../lib/selectors';
import * as sound from '../../lib/sound';
import type { Game, GameStatus, Lottery } from '../../lib/types';
import { PinChip } from './parts';
import { TvAwards } from './TvAwards';
import { TvCeremony } from './TvCeremony';
import { MuteButton, StartOverlay, TvStage, useTvShortcuts } from './TvChrome';
import { TvLobby } from './TvLobby';
import { TvLottery } from './TvLottery';
import { TvPinEntry } from './TvPinEntry';
import { TvRunning } from './TvRunning';
import './tv.css';

/** Hur gammal en lottning får vara för att storskärmen ska spela upp animationen. */
const LOTTERY_FRESH_MS = 20_000;

/** Storskärmen (TV/projektor). Utan gameId: ange PIN. */
export function TvView({ gameId }: { gameId?: string }) {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Storskärm · Bonjour Babes';
    return () => {
      document.title = prev;
    };
  }, []);
  return <TvStage>{gameId ? <TvGame key={gameId} gameId={gameId} /> : <TvPinEntry />}</TvStage>;
}

function TvGame({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  useWakeLock();
  useTvShortcuts();
  const [started, setStarted] = useState(false);

  // Har skärmen sett spelet före prisutdelningen? Då spelas prisutdelningen upp "live" när den
  // startar. Laddas skärmen mitt i prisutdelningen visas steget direkt (inga trumvirvlar i repris).
  // (Idempotent skrivning – sätts bara till true.)
  const sawPreCeremony = useRef(false);
  if (game && !isCeremonyStatus(game.meta.status)) sawPreCeremony.current = true;

  useStatusSounds(game);
  const lottery = useLotteryShow(game);

  if (game === undefined) {
    return (
      <div className="tv-screen tv-center">
        <div className="loading__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="tv-muted-text">Bonsoir…</div>
      </div>
    );
  }

  if (game === null) {
    return (
      <div className="tv-screen tv-center">
        <Logo size="xl" className="tv-missing__logo" />
        <h1 className="tv-missing__title">Spelet finns inte längre</h1>
        <a className="btn btn--gold tv-missing__btn" href={href('/tv')}>
          Ange en ny PIN
        </a>
      </div>
    );
  }

  const status = game.meta.status;
  const initialLive = sawPreCeremony.current;

  let content;
  switch (status) {
    case 'lobby':
      content = <TvLobby game={game} hideOrder={!!lottery.show} />;
      break;
    case 'running':
      content = <TvRunning game={game} />;
      break;
    case 'awards':
      content = <TvAwards game={game} />;
      break;
    case 'ceremony':
    case 'finished':
      content = <TvCeremony game={game} gameId={gameId} initialLive={initialLive} />;
      break;
  }

  return (
    <>
      {content}
      {lottery.show && (
        <TvLottery
          key={lottery.show.at}
          ids={lottery.show.ids}
          startNumber={lottery.show.startNumber}
          players={game.players}
          onDone={lottery.done}
        />
      )}
      {(status === 'running' || status === 'awards') && <PinChip pin={game.meta.pin} />}
      <MuteButton />
      {!started && <StartOverlay pin={game.meta.pin} onStart={() => setStarted(true)} />}
    </>
  );
}

function isCeremonyStatus(status: GameStatus): boolean {
  return status === 'ceremony' || status === 'finished';
}

/** Ljud när admin byter fas (inte vid första laddningen). */
function useStatusSounds(game: Game | null | undefined) {
  const sig = game
    ? `${game.meta.status}|${game.current?.drinkId ?? ''}|${game.current?.phase ?? ''}`
    : null;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!sig) return;
    const before = prev.current;
    prev.current = sig;
    if (!before || before === sig) return;
    const [status, drinkId, phase] = sig.split('|');
    const [bStatus, bDrinkId, bPhase] = before.split('|');
    if (status === 'running') {
      if (drinkId !== bDrinkId || bStatus !== 'running') {
        // Nästa drink är på väg
        sound.whoosh();
        window.setTimeout(() => sound.ding(4), 350);
      } else if (phase !== bPhase) {
        if (phase === 'voting') sound.chime();
        else if (phase === 'closed') {
          sound.tick();
          window.setTimeout(() => sound.ding(-3), 120);
        } else if (phase === 'preparing') sound.whoosh();
      }
    } else if (status === 'awards' && bStatus !== 'awards') {
      sound.whoosh();
      window.setTimeout(() => sound.chime(), 300);
    }
  }, [sig]);
}

interface LotteryShow {
  at: number;
  ids: string[];
  startNumber: number;
}

/**
 * Spelar lottningsanimationen när admin lottar (game.lottery.at ändras och är färsk).
 * En gammal lottning (t.ex. efter omladdning) visas aldrig igen – då syns bara ordningen.
 */
function useLotteryShow(game: Game | null | undefined): { show: LotteryShow | null; done: () => void } {
  const [show, setShow] = useState<LotteryShow | null>(null);
  const handled = useRef<number | null>(null);
  const lottery: Lottery | undefined = game?.lottery;
  const status = game?.meta.status;
  useEffect(() => {
    if (!game || !lottery || handled.current === lottery.at) return;
    handled.current = lottery.at;
    if (status !== 'lobby' && status !== 'running') return;
    if (Math.abs(backend.now() - lottery.at) > LOTTERY_FRESH_MS) return;
    let ids = lottery.order.filter((id) => game.players[id]);
    let startNumber = 1;
    if (status === 'running' && game.current) {
      // Under tävlingen lottas bara drinkarna som inte har presenterats än.
      const idx = Math.max(ids.indexOf(game.current.drinkId), effectiveOrder(game).indexOf(game.current.drinkId));
      ids = ids.slice(idx + 1);
      startNumber = idx + 2;
    }
    if (ids.length === 0) return;
    setShow({ at: lottery.at, ids, startNumber });
    // game läses bara när lottningen ändras
  }, [lottery?.at, status]); // eslint-disable-line react-hooks/exhaustive-deps
  return { show, done: () => setShow(null) };
}
