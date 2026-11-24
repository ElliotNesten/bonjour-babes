import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { isPermissionDenied } from '../../lib/backend';
import { submitAwardVote } from '../../lib/game';
import { AWARDS, AWARD_IDS, type AwardDef } from '../../lib/scoring';
import { effectiveOrder } from '../../lib/selectors';
import type { AwardId, Game, Player } from '../../lib/types';
import { scrollToId, vibrate } from './util';

/** Specialpriserna: en fråga i taget (dragspel), varje val sparas direkt. */
export function AwardsScreen({ gameId, game, uid }: { gameId: string; game: Game; uid: string }) {
  const options: [string, Player][] = effectiveOrder(game)
    .filter((id) => id !== uid)
    .map((id) => [id, game.players[id]]);

  const saved = (a: AwardId): string | null => {
    const t = game.awardVotes[a]?.[uid];
    return t && t !== uid && game.players[t] ? t : null;
  };

  const [pending, setPending] = useState<Partial<Record<AwardId, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<AwardId, string>>>({});
  const choice = (a: AwardId) => pending[a] ?? saved(a);
  const [open, setOpen] = useState<AwardId | null>(() => AWARD_IDS.find((a) => !saved(a)) ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const done = AWARD_IDS.filter((a) => choice(a)).length;
  const allDone = done === AWARD_IDS.length;

  const openAward = (a: AwardId | null) => {
    setOpen(a);
    if (a) setTimeout(() => scrollToId(`pl-award-${a}`, 'start'), 40);
  };

  const select = async (a: AwardId, target: string) => {
    setPending((p) => ({ ...p, [a]: target }));
    setErrors((e) => ({ ...e, [a]: undefined }));
    vibrate(10);
    // Glid vidare till nästa obesvarade fråga.
    const nextOpen = AWARD_IDS.find((x) => x !== a && !choice(x)) ?? null;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => openAward(nextOpen), 420);
    try {
      await submitAwardVote(gameId, a, target);
    } catch (err) {
      clearTimeout(timer.current);
      setErrors((e) => ({
        ...e,
        [a]: isPermissionDenied(err) ? 'Röstningen på specialpriser är stängd 🔒' : 'Kunde inte spara – försök igen',
      }));
      setOpen(a);
    } finally {
      setPending((p) => {
        if (p[a] !== target) return p;
        const rest = { ...p };
        delete rest[a];
        return rest;
      });
    }
  };

  if (!options.length) {
    return (
      <div className="pl-center">
        <div className="pl-bigemoji" aria-hidden="true">
          🏆
        </div>
        <h1 className="pl-title">Specialpriser</h1>
        <p className="muted pl-sub">Det finns inga andra drinkar att rösta på. Nu väntar vi på prisutdelningen 🎉</p>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="center">
        <div className="eyebrow">Les prix spéciaux</div>
        <h1 className="pl-title" style={{ marginTop: 6 }}>
          Specialpriser
        </h1>
        <p className="muted pl-sub" style={{ margin: '8px auto 0' }}>
          Bara ära, inga poäng. Du kan inte rösta på din egen drink.
        </p>
      </div>

      <div className="pl-awprog" aria-live="polite">
        <div className="pl-awprog__dots" aria-hidden="true">
          {AWARDS.map((a) => (
            <span key={a.id} className={choice(a.id) ? 'is-on' : ''}>
              {a.emoji}
            </span>
          ))}
        </div>
        <span className="tabular">
          <strong>{done}</strong>/{AWARD_IDS.length} klara
        </span>
      </div>

      {allDone && (
        <div className="card card--gold pl-awdone pop" role="status">
          <span className="pl-awdone__emoji" aria-hidden="true">
            🎉
          </span>
          <div>
            <strong>Merci ! Nu väntar vi på prisutdelningen 🎉</strong>
            <div className="hint" style={{ margin: 0 }}>
              Du kan ändra dina val ända tills värden startar den.
            </div>
          </div>
        </div>
      )}

      <div className="stack">
        {AWARDS.map((a) => (
          <AwardCard
            key={a.id}
            award={a}
            options={options}
            selected={choice(a.id)}
            saving={pending[a.id] !== undefined}
            error={errors[a.id]}
            open={open === a.id}
            onToggle={() => openAward(open === a.id ? null : a.id)}
            onSelect={(target) => void select(a.id, target)}
          />
        ))}
      </div>
    </div>
  );
}

function AwardCard({
  award: a,
  options,
  selected,
  saving,
  error,
  open,
  onToggle,
  onSelect,
}: {
  award: AwardDef;
  options: [string, Player][];
  selected: string | null;
  saving: boolean;
  error?: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (target: string) => void;
}) {
  const chosen = options.find(([id]) => id === selected)?.[1];
  const bodyId = `pl-award-body-${a.id}`;
  return (
    <div id={`pl-award-${a.id}`} className={`pl-award ${open ? 'is-open' : ''} ${selected ? 'is-done' : ''}`}>
      <button type="button" className="pl-award__head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="pl-award__emoji" aria-hidden="true">
          {a.emoji}
        </span>
        <span className="grow pl-award__titles">
          <span className="pl-award__title">{a.title}</span>
          {chosen && !open ? (
            <span className="pl-award__chosen">
              “{chosen.drink}” <span className="dim">· {chosen.name}</span>
            </span>
          ) : (
            <span className="pl-award__fr">{a.fr}</span>
          )}
        </span>
        {chosen ? (
          <span className="pl-award__state" aria-label={saving ? 'Sparar' : 'Klar'}>
            <Avatar emoji={chosen.emoji} color={chosen.color} size={34} badge={saving ? '…' : '✓'} />
          </span>
        ) : (
          <span className="pill pl-award__pill">Välj</span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="pl-award__body">
          <p className="pl-award__q">{a.question}</p>
          <div className="pl-award__list" role="radiogroup" aria-label={a.title}>
            {options.map(([id, p]) => {
              const isSel = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  className={`pl-option ${isSel ? 'is-selected' : ''}`}
                  onClick={() => onSelect(id)}
                >
                  <Avatar emoji={p.emoji} color={p.color} size={40} />
                  <span className="grow pl-option__text">
                    <span className="pl-option__drink">{p.drink}</span>
                    <span className="pl-option__by">{p.name}</span>
                  </span>
                  <span className="pl-option__radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          {error && (
            <div className="error center" role="alert" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
      )}
      {!open && error && (
        <div className="error" role="alert" style={{ padding: '0 16px 12px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
