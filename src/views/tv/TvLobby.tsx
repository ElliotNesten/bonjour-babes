import { useRef, type CSSProperties } from 'react';
import { Avatar } from '../../components/Avatar';
import { Logo } from '../../components/Logo';
import { CoupeIcon, Ornament } from '../../components/Ornament';
import { QRCode } from '../../components/QRCode';
import { appUrl } from '../../lib/format';
import { effectiveOrder, playerEntries } from '../../lib/selectors';
import * as sound from '../../lib/sound';
import type { Game } from '../../lib/types';
import { fitSize, formatPin, siteAddress, useArrivals } from './tvHooks';

/** Tillgänglig höjd för listan till höger (logiska px). */
const LIST_H = 720;

function gridFor(n: number): { cols: number; rows: number; s: number } {
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5;
  const rows = Math.max(1, Math.ceil(n / cols));
  // Få gäster → större kort (upp till 1,25×), många → mindre.
  const rowH = Math.min(n <= 6 ? 288 : 230, (LIST_H - (rows - 1) * 22) / rows);
  return { cols, rows, s: rowH / 230 };
}

function listFor(n: number): { cols: number; rows: number; s: number } {
  const cols = n <= 6 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(n / cols));
  const rowH = Math.min(112, (LIST_H - (rows - 1) * 14) / rows);
  return { cols, rows, s: rowH / 112 };
}

export function TvLobby({ game, hideOrder }: { game: Game; hideOrder: boolean }) {
  const entries = playerEntries(game);
  const ids = entries.map(([id]) => id);
  const n = ids.length;
  const pin = game.meta.pin;

  // Spelare som fanns när storskärmen laddades animeras in mjukt – nya "poppar" med ett pling.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(ids);
  useArrivals(ids, (added) => {
    added.slice(0, 6).forEach((_, i) => window.setTimeout(() => sound.ding(n - added.length + i), i * 160));
  });

  const showOrder = !hideOrder && n > 0 && (game.order.length > 0 || !!game.lottery);
  const order = showOrder ? effectiveOrder(game) : [];

  return (
    <main className="tv-screen tv-lobby">
      <section className="tv-lobby__left">
        <div className="tv-lobby__brand fade-up">
          <Logo size="xl" className="tv-lobby__logo" />
          <div className="tv-lobby__tag">Une soirée de cocktails</div>
          <Ornament className="tv-lobby__orn" />
        </div>

        <div className="tv-join card card--deco card--gold fade-up" style={{ animationDelay: '0.15s' }}>
          <div className="tv-join__top">
            <QRCode value={appUrl(`/join/${pin}`)} size={236} className="tv-join__qr" />
            <div className="tv-join__how">
              <div className="tv-eyebrow">Gå med på mobilen</div>
              <ol className="tv-join__steps">
                <li>
                  <span>Skanna QR-koden</span>
                </li>
                <li>
                  <span>
                    eller gå till <strong>{siteAddress()}</strong>
                  </span>
                </li>
                <li>
                  <span>Skriv in PIN, ditt namn och din drink</span>
                </li>
              </ol>
            </div>
          </div>
          <div className="tv-join__pin-wrap">
            <span className="tv-join__pin-label">PIN</span>
            <span className="tv-join__pin tabular" aria-label={`PIN ${pin.split('').join(' ')}`}>
              {formatPin(pin)}
            </span>
          </div>
        </div>
      </section>

      <section className="tv-lobby__right">
        <header className="tv-lobby__head">
          <div>
            <div className="tv-eyebrow">{showOrder ? "L'ordre de passage" : 'Les invités'}</div>
            <h2 className="tv-lobby__title">{showOrder ? 'Kvällens ordning' : 'Kvällens bartenders'}</h2>
          </div>
          <div className="tv-lobby__count" aria-live="polite">
            <span className="tv-lobby__count-num tabular" key={n}>
              {n}
            </span>
            <span className="tv-lobby__count-label">deltagare</span>
          </div>
        </header>

        {n === 0 ? (
          <div className="tv-lobby__empty">
            <CoupeIcon size={150} className="float" />
            <div className="tv-lobby__empty-title">Väntar på kvällens första gäst…</div>
            <div className="tv-lobby__empty-sub">Skanna QR-koden och bli först på listan</div>
          </div>
        ) : showOrder ? (
          <OrderList game={game} order={order} initial={initial.current} />
        ) : (
          <PlayerGrid game={game} ids={ids} initial={initial.current} />
        )}

        <footer className="tv-lobby__foot">
          {showOrder ? (
            <>
              <span className="tv-lobby__foot-fr">C'est parti bientôt</span> · Först ut:{' '}
              <strong>{order[0] ? game.players[order[0]]?.name : '–'}</strong>
            </>
          ) : n < 2 ? (
            'Det behövs minst två deltagare'
          ) : (
            <>
              <span aria-hidden="true">🎲</span> Ordningen lottas när alla är på plats
            </>
          )}
        </footer>
      </section>
    </main>
  );
}

function PlayerGrid({ game, ids, initial }: { game: Game; ids: string[]; initial: Set<string> }) {
  const { cols, rows, s } = gridFor(ids.length);
  return (
    <div
      className="tv-guests"
      style={{ '--cols': cols, '--rows': rows, '--s': s } as CSSProperties}
    >
      {ids.map((id, i) => {
        const p = game.players[id];
        const isNew = !initial.has(id);
        return (
          <div
            key={id}
            className={`tv-guest ${isNew ? 'is-new' : 'fade-up'}`}
            style={isNew ? undefined : { animationDelay: `${0.2 + i * 0.06}s` }}
          >
            <Avatar emoji={p.emoji} color={p.color} size={Math.round(104 * s)} />
            <div className="tv-guest__name" style={{ fontSize: fitSize(p.name, 36 * s, 22 * s, 11) }}>
              {p.name}
            </div>
            <div className="tv-guest__drink" style={{ fontSize: fitSize(p.drink, 26 * s, 18 * s, 18) }}>
              {p.drink}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderList({ game, order, initial }: { game: Game; order: string[]; initial: Set<string> }) {
  const { cols, rows, s } = listFor(order.length);
  return (
    <ol className="tv-order" style={{ '--cols': cols, '--rows': rows, '--s': s } as CSSProperties}>
      {order.map((id, i) => {
        const p = game.players[id];
        const isNew = !initial.has(id);
        return (
          <li
            key={id}
            className={`tv-order__row ${isNew ? 'is-new' : 'fade-up'}`}
            style={isNew ? undefined : { animationDelay: `${0.1 + i * 0.05}s` }}
          >
            <span className="tv-order__num tabular">{i + 1}</span>
            <Avatar emoji={p.emoji} color={p.color} size={Math.round(72 * s)} />
            <span className="tv-order__text">
              <span className="tv-order__name">{p.name}</span>
              <span className="tv-order__drink">{p.drink}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
