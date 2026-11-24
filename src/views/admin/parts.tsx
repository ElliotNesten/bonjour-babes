import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import type { GameStatus } from '../../lib/types';

/* ------------------------------------------------------------------ */
/*  Små byggstenar för adminpanelen                                     */
/* ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<GameStatus, string> = {
  lobby: 'Lobby',
  running: 'Pågår',
  awards: 'Specialpriser',
  ceremony: 'Prisutdelning',
  finished: 'Avslutat',
};

export function StatusPill({ status, className = '' }: { status: GameStatus; className?: string }) {
  const variant = status === 'running' || status === 'ceremony' ? 'pill--live' : status === 'finished' ? '' : 'pill--gold';
  return <span className={`pill ${variant} adm-status adm-status--${status} ${className}`}>{STATUS_LABEL[status]}</span>;
}

/** "482913" → "482 913" */
export function formatPin(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
}

/** Klistrar in text i urklipp – med reserv för osäkra kontexter (http på LAN). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* prova reserven nedan */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Fast åtgärdsfält längst ner – en tydlig huvudåtgärd i taget. */
export function ActionBar({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="adm-bar">
      <div className="adm-bar__inner">
        {hint && <div className="adm-bar__hint">{hint}</div>}
        <div className="adm-bar__row">{children}</div>
      </div>
    </div>
  );
}

interface CtaProps {
  /** Liten rad ovanför (t.ex. "Nästa drink"). */
  kicker?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'gold' | 'bordeaux';
  /** Pulserande glöd – "nu är det dags". */
  glow?: boolean;
  /** Mindre text för långa etiketter (t.ex. långa drinknamn). */
  compact?: boolean;
}

/** Huvudknappen i åtgärdsfältet (två rader: kicker + etikett). */
export function Cta({ kicker, label, onClick, href, disabled, busy, variant = 'gold', glow, compact }: CtaProps) {
  const cls = `btn btn--${variant} btn--block adm-cta ${glow && !disabled ? 'adm-cta--glow' : ''} ${compact ? 'adm-cta--compact' : ''}`;
  const content = (
    <>
      {kicker && <span className="adm-cta__kicker">{kicker}</span>}
      <span className="adm-cta__label">{busy ? 'Ett ögonblick…' : label}</span>
    </>
  );
  if (href) {
    return (
      <a className={cls} href={href}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {content}
    </button>
  );
}

/** Förloppsindikator (t.ex. "5 av 8 har röstat"). */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="adm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="adm-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Rubrik för en sektion i panelen. */
export function SectionHead({ eyebrow, title, aside }: { eyebrow?: string; title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="adm-section-head">
      <div className="grow">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h3 className="adm-section-head__title">{title}</h3>
      </div>
      {aside}
    </div>
  );
}

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string };

/** Lösenordsfält med visa/dölj-knapp. */
export function PasswordField({ label, id, ...rest }: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <div className="adm-password">
        <input id={inputId} className="input" type={show ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} {...rest} />
        <button
          type="button"
          className="adm-password__toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Dölj lösenordet' : 'Visa lösenordet'}
          aria-pressed={show}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
