import { QRCode } from '../../components/QRCode';
import { appUrl, formatDateTime } from '../../lib/format';
import { drawOrder, startGame } from '../../lib/game';
import { effectiveOrder } from '../../lib/selectors';
import { useFeedback } from './feedback';
import type { PanelProps } from './panelTypes';
import { ActionBar, canShare, copyText, Cta, formatPin, SectionHead } from './parts';
import { PlayerList } from './PlayerList';
import { AddManualPlayer, SettingsCard } from './SettingsCard';

/** Lobbyn: gästerna går med, admin lottar ordningen och startar tävlingen. */
export function LobbyPanel({ game, gameId, uid, onMyVote }: PanelProps) {
  const { run, pending, confirm } = useFeedback();
  const count = effectiveOrder(game).length;
  const busy = pending !== null;
  const isPlayer = !!game.players[uid];

  const draw = () =>
    run('draw', () => drawOrder(gameId), {
      success: game.lottery ? 'Ordningen är omlottad 🎲' : 'Ordningen är lottad 🎲 – titta på storskärmen',
    });

  const start = async () => {
    if (!game.lottery) {
      const ok = await confirm({
        title: 'Ordningen är inte lottad',
        body: 'Starta ändå? Drinkarna presenteras då i den ordning som visas i listan.',
        confirmLabel: 'Starta ändå',
      });
      if (!ok) return;
    }
    await run('start', () => startGame(gameId), { success: "C'est parti ! Första drinken är på väg 🍸" });
  };

  return (
    <>
      <div className="adm-panel stack-lg">
        <JoinInfo pin={game.meta.pin} />

        {!isPlayer && (
          <button type="button" className="adm-nudge" onClick={onMyVote}>
            <span className="adm-nudge__icon" aria-hidden="true">
              🍸
            </span>
            <span className="grow">
              <strong>Gör du också en drink?</strong>
              <span className="adm-nudge__sub">Gå med som deltagare så kommer din drink med i ordningen.</span>
            </span>
            <span className="adm-nudge__arrow" aria-hidden="true">
              →
            </span>
          </button>
        )}

        <section className="card card--deco stack" aria-labelledby="adm-players-title">
          <SectionHead
            eyebrow="Les invités"
            title={
              <span id="adm-players-title">
                Deltagare <span className="adm-count">{count}</span>
              </span>
            }
          />
          <p className="hint" style={{ margin: 0 }}>
            {game.lottery ? (
              <>🎲 Lottad {formatDateTime(game.lottery.at)}. Finjustera med ▲▼ – tryck på en rad.</>
            ) : count > 0 ? (
              <>Inte lottad än – listan visar i vilken ordning de gick med. Tryck på en rad för att ändra.</>
            ) : null}
          </p>

          {count === 0 ? (
            <div className="adm-empty center">
              <div className="adm-empty__icon float" aria-hidden="true">
                🥂
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Väntar på gästerna… Be dem skanna QR-koden på storskärmen.
              </p>
            </div>
          ) : (
            <PlayerList game={game} gameId={gameId} uid={uid} mode="lobby" />
          )}

          <div className="adm-card-actions">
            <button type="button" className="btn btn--bordeaux btn--block adm-btn-44" onClick={() => void draw()} disabled={busy || count < 2}>
              {pending === 'draw' ? 'Lottar…' : game.lottery ? '🎲 Lotta om ordningen' : '🎲 Lotta ordningen'}
            </button>
            <AddManualPlayer gameId={gameId} />
          </div>
        </section>

        <SettingsCard game={game} gameId={gameId} />
      </div>

      <ActionBar hint={count < 2 ? 'Minst två deltagare behövs för att starta' : `${count} drinkar · storskärmen visar första drinken direkt`}>
        <Cta kicker="C'est parti !" label="Starta tävlingen" onClick={() => void start()} disabled={busy || count < 2} busy={pending === 'start'} glow={count >= 2} />
      </ActionBar>
    </>
  );
}

function JoinInfo({ pin }: { pin: string }) {
  const { toast } = useFeedback();
  const url = appUrl(`/join/${pin}`);

  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? 'Länken är kopierad' : 'Kunde inte kopiera – PIN-koden funkar också', ok ? 'success' : 'error');
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Bonjour Babes', text: `Gå med i kvällens drinktävling – PIN ${pin}`, url });
    } catch {
      /* avbrutet av användaren */
    }
  };

  return (
    <section className="card card--deco card--gold adm-join" aria-label="Så går gästerna med">
      <QRCode value={url} size={104} className="adm-join__qr" />
      <div className="adm-join__text">
        <div className="eyebrow">Bjud in gästerna</div>
        <p className="adm-join__lead">
          Skanna koden – eller gå till startsidan och skriv PIN <strong className="tabular adm-nowrap">{formatPin(pin)}</strong>.
        </p>
        <div className="adm-join__actions">
          <button type="button" className="adm-chip" onClick={() => void copy()}>
            🔗 Kopiera länk
          </button>
          {canShare() && (
            <button type="button" className="adm-chip" onClick={() => void share()}>
              ↗ Dela
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
