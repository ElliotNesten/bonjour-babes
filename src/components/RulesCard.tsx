import { AWARDS, CATEGORIES, TRIM_MIN_VOTES, WEIGHT_SUM } from '../lib/scoring';

/** "Så funkar poängen" – förklarar poängsystemet för gästerna. */
export function RulesCard({ trimExtremes = true, awardsEnabled = true, compact = false }: { trimExtremes?: boolean; awardsEnabled?: boolean; compact?: boolean }) {
  return (
    <div className="card card--deco rules-card">
      <div className="eyebrow center">Les règles</div>
      <h3 className="center" style={{ marginTop: 6 }}>
        Så funkar poängen
      </h3>
      <p className="muted center" style={{ fontSize: '0.92rem' }}>
        Efter varje drink sätter du 1–10 i fyra kategorier. Du röstar aldrig på din egen drink.
      </p>
      <ul className="rules-card__list">
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <span className="rules-card__emoji" aria-hidden="true">
              {c.emoji}
            </span>
            <span className="grow">
              <strong>{c.label}</strong>
              {!compact && <span className="dim"> – {c.hint}</span>}
            </span>
            <span className="pill pill--gold">×{c.weight}</span>
          </li>
        ))}
      </ul>
      <p className="hint" style={{ marginBottom: compact ? 0 : undefined }}>
        Betygen viktas (summa {WEIGHT_SUM}) och blir en totalpoäng på max <strong>100</strong>. Drinkens slutpoäng är
        snittet av alla domare.
      </p>
      {!compact && (
        <>
          {trimExtremes && (
            <p className="hint">
              <strong>🏅 OS-regeln:</strong> har en drink minst {TRIM_MIN_VOTES} röster stryks det högsta och lägsta
              betyget – precis som i konståkning. Taktikröstning lönar sig inte.
            </p>
          )}
          <p className="hint">
            <strong>Lika poäng?</strong> Högst snitt på smak vinner, sedan flest 10:or.
          </p>
          {awardsEnabled && (
            <p className="hint" style={{ marginBottom: 0 }}>
              <strong>Specialpriser</strong> (bara ära): {AWARDS.map((a) => `${a.emoji} ${a.title}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
