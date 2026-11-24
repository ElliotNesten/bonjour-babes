import { useEffect, useState, type FormEvent } from 'react';
import { addManualPlayer, DRINK_MAX, NAME_MAX, renameGame, updateSettings } from '../../lib/game';
import { AWARDS, TRIM_MIN_VOTES } from '../../lib/scoring';
import type { Game, GameSettings } from '../../lib/types';
import { useFeedback } from './feedback';

type SettingKey = keyof GameSettings;
type Field = 'name' | SettingKey;

const SETTING_COPY: Record<SettingKey, { title: string; hint: string; on: string; off: string }> = {
  trimExtremes: {
    title: '🏅 OS-regeln',
    hint: `Har en drink minst ${TRIM_MIN_VOTES} röster stryks det högsta och lägsta betyget – som i konståkning. Då lönar det sig inte att taktikrösta.`,
    on: 'OS-regeln är på',
    off: 'OS-regeln är av',
  },
  awardsEnabled: {
    title: '🏆 Specialpriser',
    hint: `Efter sista drinken röstar alla fram ${AWARDS.map((a) => `${a.title} ${a.emoji}`).join(', ')}. Bara ära – inga poäng.`,
    on: 'Specialpriserna är på',
    off: 'Specialpriserna är av',
  },
  showJudgeNames: {
    title: '👀 Visa vem som gav vilket betyg',
    hint: 'Gäller resultatsidan efter prisutdelningen. Av = alla betyg visas anonymt.',
    on: 'Domarnamnen visas på resultatsidan',
    off: 'Betygen är anonyma på resultatsidan',
  },
};

/** Spelinställningar: kvällens namn och reglerna. */
export function SettingsCard({
  game,
  gameId,
  fields = ['name', 'trimExtremes', 'awardsEnabled', 'showJudgeNames'],
  flat = false,
}: {
  game: Game;
  gameId: string;
  fields?: Field[];
  flat?: boolean;
}) {
  const { run, pending } = useFeedback();
  const busy = pending !== null;

  const toggle = (key: SettingKey, value: boolean) =>
    run(`setting:${key}`, () => updateSettings(gameId, { [key]: value }), {
      success: value ? SETTING_COPY[key].on : SETTING_COPY[key].off,
    });

  return (
    <div className={flat ? 'adm-settings stack' : 'card adm-settings stack'}>
      {!flat && (
        <div>
          <div className="eyebrow">Les réglages</div>
          <h3 className="adm-section-head__title">Inställningar</h3>
        </div>
      )}
      {fields.includes('name') && <RenameField game={game} gameId={gameId} />}
      <div className="adm-toggles">
        {fields
          .filter((f): f is SettingKey => f !== 'name')
          .map((key) => (
            <label key={key} className="toggle adm-toggle">
              <span className="grow">
                <span className="adm-toggle__title">{SETTING_COPY[key].title}</span>
                <span className="adm-toggle__hint">{SETTING_COPY[key].hint}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={game.settings[key]}
                disabled={busy}
                onChange={(e) => void toggle(key, e.target.checked)}
              />
            </label>
          ))}
      </div>
    </div>
  );
}

function RenameField({ game, gameId }: { game: Game; gameId: string }) {
  const { run, pending } = useFeedback();
  const current = game.meta.name;
  const [value, setValue] = useState(current);
  const [dirty, setDirty] = useState(false);

  // Följ med om namnet ändras någon annanstans – så länge man inte skriver själv.
  useEffect(() => {
    if (!dirty) setValue(current);
  }, [current, dirty]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run('rename', () => renameGame(gameId, value), { success: 'Namnet är sparat' });
    if (ok) setDirty(false);
  };

  const changed = value.trim() !== current && value.trim().length > 0;
  return (
    <form className="field" onSubmit={submit}>
      <label className="label" htmlFor="adm-rename">
        Kvällens namn
      </label>
      <div className="adm-inline-form">
        <input
          id="adm-rename"
          className="input"
          value={value}
          maxLength={60}
          placeholder="Bonjour Babes"
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
        />
        <button className="btn btn--gold btn--sm adm-btn-44" disabled={!changed || pending !== null}>
          {pending === 'rename' ? '…' : 'Spara'}
        </button>
      </div>
    </form>
  );
}

/** "Lägg till deltagare utan mobil" – hopfällbart formulär. */
export function AddManualPlayer({ gameId }: { gameId: string }) {
  const { run, pending } = useFeedback();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [drink, setDrink] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="adm-add-row" onClick={() => setOpen(true)} disabled={pending !== null}>
        <span className="adm-add-row__plus" aria-hidden="true">＋</span> Lägg till deltagare utan mobil
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !drink.trim()) {
      setError('Fyll i namn och drink');
      return;
    }
    const cleanName = name.trim();
    const ok = await run('manual', () => addManualPlayer(gameId, { name, drink }), {
      success: `${cleanName} är tillagd`,
      onError: setError,
    });
    if (ok) {
      setName('');
      setDrink('');
      setOpen(false);
    }
  };

  return (
    <form className="adm-manual stack" onSubmit={submit}>
      <div>
        <h4 className="adm-manual__title">Deltagare utan mobil</h4>
        <p className="hint" style={{ margin: 0 }}>
          Drinken kommer med i ordningen och betygsätts av de andra – men personen kan inte rösta själv.
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor="adm-manual-name">
          Namn
        </label>
        <input
          id="adm-manual-name"
          className="input"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="adm-manual-drink">
          Drinkens namn
        </label>
        <input
          id="adm-manual-drink"
          className="input"
          value={drink}
          maxLength={DRINK_MAX}
          autoComplete="off"
          onChange={(e) => {
            setDrink(e.target.value);
            setError(null);
          }}
        />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn--ghost btn--sm grow adm-btn-44"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Avbryt
        </button>
        <button className="btn btn--gold btn--sm grow adm-btn-44" disabled={pending !== null}>
          {pending === 'manual' ? 'Lägger till…' : 'Lägg till'}
        </button>
      </div>
    </form>
  );
}
