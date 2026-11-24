import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { isPermissionDenied } from '../../lib/backend';
import { COMMENT_MAX, submitVote } from '../../lib/game';
import { CATEGORIES, voteTotal, type Category } from '../../lib/scoring';
import { currentDrink, expectedVoters, votesForDrink } from '../../lib/selectors';
import type { CategoryId, Game, Vote } from '../../lib/types';
import { clearDraft, loadDraft, reactionFor, saveDraft, scrollToId, vibrate, type Scores } from './util';

type Drink = NonNullable<ReturnType<typeof currentDrink>>;

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Röstningen på den aktuella drinken: formuläret, eller "Merci !" när man har röstat. */
export function VoteScreen({ gameId, game, uid, drink }: { gameId: string; game: Game; uid: string; drink: Drink }) {
  const votes = votesForDrink(game, drink.id);
  const mine = votes[uid];
  const [editing, setEditing] = useState(false);
  // Databasen visar en skickad röst lokalt direkt, innan servern har godkänt den. Formuläret ligger
  // därför kvar tills skrivningen är bekräftad – annars kunde "Merci !" visas för en röst som
  // sedan nekas (t.ex. om röstningen hann låsas medan mobilen var offline).
  const [sending, setSending] = useState(false);
  const expected = expectedVoters(game, drink.id);
  const got = expected.filter((id) => votes[id]).length;

  const rootRef = useRef<HTMLDivElement>(null);

  // Byt mellan formulär och "Merci !" och se till att början av vyn syns (även inbäddat i adminpanelen).
  const switchTo = (edit: boolean) => {
    setEditing(edit);
    const el = rootRef.current?.closest('.pl') ?? rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 72;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
  };

  return (
    <div ref={rootRef}>
      {mine && !editing && !sending ? (
        <VotedCard drink={drink} vote={mine} got={got} total={expected.length} onEdit={() => switchTo(true)} />
      ) : (
        <VoteForm
          key={editing ? 'edit' : 'new'}
          gameId={gameId}
          game={game}
          drink={drink}
          initial={editing ? mine : undefined}
          onSending={setSending}
          onSubmitted={() => switchTo(false)}
          onCancel={editing && mine ? () => switchTo(false) : undefined}
        />
      )}
    </div>
  );
}

function VoteHeader({ drink, live = true }: { drink: Drink; live?: boolean }) {
  const p = drink.player;
  return (
    <div className="pl-votehead">
      <div className="row-between">
        <span className="eyebrow">
          Drink {drink.index + 1} av {drink.total}
        </span>
        {live && <span className="pill pill--live">Röstning öppen</span>}
      </div>
      <div className="pl-votehead__main">
        <Avatar emoji={p.emoji} color={p.color} size={58} />
        <div className="grow">
          <div className="pl-votehead__drink">“{p.drink}”</div>
          <div className="pl-votehead__by">
            av <strong>{p.name}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function VoteForm({
  gameId,
  game,
  drink,
  initial,
  onSending,
  onSubmitted,
  onCancel,
}: {
  gameId: string;
  game: Game;
  drink: Drink;
  initial?: Vote;
  onSending: (sending: boolean) => void;
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const uid = useId().replace(/:/g, '');
  const [scores, setScores] = useState<Scores>(() => {
    if (initial) return { taste: initial.taste, look: initial.look, creativity: initial.creativity, again: initial.again };
    return loadDraft(gameId, drink.id)?.scores ?? {};
  });
  const [comment, setComment] = useState(() => (initial ? (initial.comment ?? '') : (loadDraft(gameId, drink.id)?.comment ?? '')));
  const [showComment, setShowComment] = useState(() => comment.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  // Spara ett utkast (inte vid ändring av en redan skickad röst).
  useEffect(() => {
    if (!initial) saveDraft(gameId, drink.id, { scores, comment });
  }, [gameId, drink.id, scores, comment, initial]);

  const picked = CATEGORIES.filter((c) => scores[c.id] !== undefined).length;
  const complete = picked === CATEGORIES.length;
  const total = complete ? Math.round(voteTotal(scores as Record<CategoryId, number>)) : null;
  const catId = (c: CategoryId) => `pl-cat-${uid}-${c}`;

  const pick = (c: Category, n: number) => {
    const wasUnset = scores[c.id] === undefined;
    const next = { ...scores, [c.id]: n };
    setScores(next);
    setError(null);
    vibrate(8);
    // Första valet i en kategori → glid vidare till nästa tomma kategori.
    if (wasUnset) {
      const i = CATEGORIES.findIndex((x) => x.id === c.id);
      const following = [...CATEGORIES.slice(i + 1), ...CATEGORIES.slice(0, i)].find((x) => next[x.id] === undefined);
      clearTimeout(scrollTimer.current);
      if (following) scrollTimer.current = setTimeout(() => scrollToId(catId(following.id)), 260);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!complete) {
      const missing = CATEGORIES.find((c) => scores[c.id] === undefined);
      if (missing) {
        scrollToId(catId(missing.id), 'center');
        setError(`Sätt betyg på ${missing.label.toLowerCase()} också`);
      }
      return;
    }
    const cur = game.current;
    if (game.meta.status !== 'running' || !cur || cur.drinkId !== drink.id || cur.phase !== 'voting') {
      setError('Röstningen hann stänga 🔒');
      return;
    }
    setBusy(true);
    onSending(true);
    setError(null);
    try {
      await submitVote(gameId, drink.id, {
        taste: scores.taste!,
        look: scores.look!,
        creativity: scores.creativity!,
        again: scores.again!,
        comment: comment.trim() || undefined,
      });
      clearDraft(gameId, drink.id);
      vibrate([30, 40, 60]);
      onSubmitted();
      onSending(false);
      setBusy(false);
    } catch (err) {
      setError(isPermissionDenied(err) ? 'Röstningen hann stänga 🔒' : 'Kunde inte skicka – kontrollera anslutningen och försök igen');
      onSending(false);
      setBusy(false);
    }
  };

  return (
    <form
      className="pl-vote"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <VoteHeader drink={drink} />

      {initial && (
        <div className="pl-note pl-editnote">
          <span className="grow">Du ändrar din röst – den gamla ersätts när du sparar.</span>
          {onCancel && (
            <button type="button" className="btn btn--ghost btn--sm pl-tap" onClick={onCancel} disabled={busy}>
              Ångra
            </button>
          )}
        </div>
      )}

      <div className="pl-cats">
        {CATEGORIES.map((c) => (
          <ScorePicker key={c.id} id={catId(c.id)} category={c} value={scores[c.id]} onPick={(n) => pick(c, n)} />
        ))}
      </div>

      <div className="pl-comment">
        {showComment ? (
          <div className="field">
            <div className="row-between">
              <label className="label" htmlFor={`pl-comment-${uid}`}>
                Anonym kommentar
              </label>
              <span className={`pl-count tabular ${comment.length > COMMENT_MAX - 20 ? 'is-near' : ''}`} aria-hidden="true">
                {comment.length}/{COMMENT_MAX}
              </span>
            </div>
            <textarea
              id={`pl-comment-${uid}`}
              className="textarea"
              rows={3}
              maxLength={COMMENT_MAX}
              placeholder="Anonym kommentar – ooh là là…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-describedby={`pl-comment-hint-${uid}`}
            />
            <div id={`pl-comment-hint-${uid}`} className="hint">
              🤫 Visas anonymt på storskärmen i slutet av kvällen.
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="pl-comment__open"
            onClick={() => {
              setShowComment(true);
              setTimeout(() => document.getElementById(`pl-comment-${uid}`)?.focus(), 30);
            }}
          >
            <span aria-hidden="true">💬</span> Lägg till en anonym kommentar <span className="dim">(valfritt)</span>
          </button>
        )}
      </div>

      <div className="pl-submitbar">
        {error && (
          <div className="pl-submitbar__error" role="alert">
            {error}
          </div>
        )}
        <div className="pl-submitbar__row">
          <div className="pl-submitbar__score" aria-live="polite">
            <span className="pl-submitbar__cap">Din poäng</span>
            {total !== null ? (
              <span key={total} className="pl-submitbar__num tabular pop">
                {total}
                <small>/100</small>
              </span>
            ) : (
              <span className="pl-submitbar__dots" aria-label={`${picked} av 4 kategorier klara`}>
                {CATEGORIES.map((c) => (
                  <span key={c.id} className={scores[c.id] !== undefined ? 'is-on' : ''} />
                ))}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn--gold btn--lg grow pl-submitbar__btn" aria-disabled={!complete || busy}>
            {busy ? 'Skickar…' : complete ? (initial ? 'Spara röst' : 'Skicka röst') : `Välj betyg · ${picked}/4`}
          </button>
        </div>
      </div>
    </form>
  );
}

function ScorePicker({
  id,
  category: c,
  value,
  onPick,
}: {
  id: string;
  category: Category;
  value: number | undefined;
  onPick: (n: number) => void;
}) {
  const reaction = reactionFor(value);
  return (
    <div id={id} className={`pl-cat ${value !== undefined ? 'is-set' : ''}`} role="group" aria-labelledby={`${id}-label`}>
      <div className="pl-cat__head">
        <span className="pl-cat__emoji" aria-hidden="true">
          {c.emoji}
          <span className="pl-cat__weight">×{c.weight}</span>
        </span>
        <div className="grow">
          <div id={`${id}-label`} className="pl-cat__label">
            {c.label}
            <span className="pl-sr"> (väger ×{c.weight})</span>
          </div>
          <div className="pl-cat__sub">
            <span className="pl-cat__fr">{c.fr}</span> · {c.hint}
          </div>
        </div>
        <div className="pl-cat__reaction" aria-live="polite">
          {reaction ? (
            <span key={value} className="pl-cat__react pop">
              <span className="pl-cat__react-emoji" aria-hidden="true">
                {reaction.emoji}
              </span>
              <span className="pl-cat__react-word">{reaction.word}</span>
            </span>
          ) : (
            <span className="pl-cat__react pl-cat__react--empty" aria-hidden="true">
              <span className="pl-cat__react-emoji">·</span>
            </span>
          )}
        </div>
      </div>
      <div className="pl-scale">
        {SCALE.map((n) => {
          const selected = value === n;
          const filled = value !== undefined && n < value;
          return (
            <button
              key={n}
              type="button"
              className={`pl-scale__btn ${selected ? 'is-selected' : ''} ${filled ? 'is-filled' : ''}`}
              aria-pressed={selected}
              aria-label={`${c.label}: ${n} av 10`}
              onClick={() => onPick(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VotedCard({
  drink,
  vote,
  got,
  total,
  onEdit,
}: {
  drink: Drink;
  vote: Vote;
  got: number;
  total: number;
  onEdit: () => void;
}) {
  const score = Math.round(voteTotal(vote));
  return (
    <div className="stack-lg">
      <VoteHeader drink={drink} />
      <div className="card card--deco card--gold pl-voted">
        <div className="pl-check pop" aria-hidden="true">
          <svg viewBox="0 0 52 52" width="64" height="64">
            <circle cx="26" cy="26" r="24" className="pl-check__circle" />
            <path d="M15 27 L23 35 L38 18" className="pl-check__tick" />
          </svg>
        </div>
        <div className="script pl-merci">Merci !</div>
        <p className="pl-voted__lead">Din röst är inräknad</p>

        <ul className="pl-myscores">
          {CATEGORIES.map((c) => {
            const n = vote[c.id];
            return (
              <li key={c.id}>
                <span aria-hidden="true">{c.emoji}</span>
                <span className="grow">{c.label}</span>
                <span className="pl-myscores__react" aria-hidden="true">
                  {reactionFor(n)?.emoji}
                </span>
                <span className="pl-myscores__val tabular">{n}</span>
              </li>
            );
          })}
        </ul>
        <div className="pl-voted__total">
          Din poäng <strong className="tabular">{score}</strong>
          <span className="dim">/100</span>
        </div>
        {vote.comment && (
          <blockquote className="pl-quote">
            “{vote.comment}”<span className="pl-quote__note">visas anonymt i slutet</span>
          </blockquote>
        )}
      </div>

      <div className="pl-progress" aria-live="polite">
        <div className="pl-progress__bar">
          <span style={{ width: `${total ? (got / total) * 100 : 0}%` }} />
        </div>
        <span className="tabular">
          {got} av {total} har röstat
        </span>
      </div>

      <button type="button" className="btn btn--ghost btn--block" onClick={onEdit}>
        ✏️ Ändra röst
      </button>
    </div>
  );
}
