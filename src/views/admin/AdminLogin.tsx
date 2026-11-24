import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { Ornament } from '../../components/Ornament';
import { adminLogin, isAdminConfigured, PASSWORD_MIN, RESET_PASSWORD_SQL, setupAdminPassword } from '../../lib/admin';
import { isDemoMode } from '../../lib/backend';
import { href } from '../../lib/router';
import { errorMessage } from './feedback';
import { PasswordField } from './parts';

/**
 * Inloggning för admin. Första gången väljer admin ett lösenord; därefter loggar man in med det.
 * När inloggningen lyckas växlar useIsAdmin() i AdminView automatiskt över till panelen.
 * Fel lösenord ger "Fel lösenord"; andra fel (t.ex. "För många försök …" när servern begränsar
 * inloggningsförsöken, eller ingen anslutning) visas med sitt eget meddelande under fältet.
 */
export function AdminLogin() {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    isAdminConfigured()
      .then((c) => !cancelled && setConfigured(c))
      .catch((err: unknown) => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <main className="page adm-login">
      <a className="adm-backlink" href={href('/')}>
        ← Startsidan
      </a>
      <div className="adm-login__hero fade-up">
        <Logo size="md" />
        <Ornament width={220} />
        <div className="eyebrow">Adminpanel</div>
      </div>

      {loadError ? (
        <div className="card card--deco stack fade-up">
          <h3>Kunde inte nå databasen</h3>
          <p className="muted" style={{ margin: 0 }}>
            {loadError}
          </p>
          <button type="button" className="btn btn--gold" onClick={() => setAttempt((a) => a + 1)}>
            Försök igen
          </button>
        </div>
      ) : configured === undefined ? (
        <Loading text="Ett ögonblick…" />
      ) : configured ? (
        <LoginForm />
      ) : (
        <SetupForm onAlreadyConfigured={() => setConfigured(true)} />
      )}
    </main>
  );
}

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await adminLogin(password);
      if (!ok) {
        setError('Fel lösenord');
        setPassword('');
        formRef.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
        setBusy(false);
        return;
      }
      // Vid lyckad inloggning byter AdminView vy av sig själv (useIsAdmin). Släpp knappen ifall det dröjer.
      setTimeout(() => setBusy(false), 4000);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} className="card card--deco card--gold stack-lg fade-up" onSubmit={submit} style={{ animationDelay: '0.08s' }}>
      <div className="center">
        <div className="script adm-login__script">Bonsoir</div>
        <h2 className="adm-login__title">Logga in som värd</h2>
        <p className="muted adm-login__lead">Härifrån styr du kvällen – drinkarna, röstningen och prisutdelningen.</p>
      </div>
      <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
      <div className="stack">
        <PasswordField
          label="Adminlösenord"
          name="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'adm-login-error' : undefined}
        />
        {error && (
          <div id="adm-login-error" className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      <button className="btn btn--gold btn--lg btn--block" disabled={busy || !password}>
        {busy ? 'Loggar in…' : 'Logga in'}
      </button>
      <p className="hint center" style={{ margin: 0 }}>
        Glömt lösenordet? <ResetHelp />
      </p>
    </form>
  );
}

function SetupForm({ onAlreadyConfigured }: { onAlreadyConfigured: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const mismatch = repeat.length > 0 && repeat !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) {
      setError(`Lösenordet måste vara minst ${PASSWORD_MIN} tecken`);
      return;
    }
    if (password !== repeat) {
      setError('Lösenorden matchar inte');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setupAdminPassword(password);
      // Inloggad – AdminView byter vy när adminsessionen syns. Släpp knappen ifall det dröjer.
      setTimeout(() => setBusy(false), 4000);
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      setBusy(false);
      if (/redan valt/i.test(msg)) onAlreadyConfigured();
    }
  };

  return (
    <form className="card card--deco card--gold stack-lg fade-up" onSubmit={submit} style={{ animationDelay: '0.08s' }}>
      <div className="center">
        <div className="script adm-login__script">Bienvenue</div>
        <h2 className="adm-login__title">Välj adminlösenord</h2>
        <p className="muted adm-login__lead">
          Du väljer lösenordet en gång. Det sparas bara som en hash (aldrig i klartext), och servern lämnar aldrig
          ut den.
        </p>
      </div>
      <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
      <div className="stack">
        <PasswordField
          label="Nytt lösenord"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          value={password}
          minLength={PASSWORD_MIN}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          aria-describedby="adm-setup-hint"
        />
        <div id="adm-setup-hint" className={tooShort ? 'error' : 'hint'}>
          Minst {PASSWORD_MIN} tecken.
        </div>
        <PasswordField
          label="Upprepa lösenordet"
          name="repeat-password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => {
            setRepeat(e.target.value);
            setError(null);
          }}
          aria-invalid={mismatch || undefined}
        />
        {mismatch && !error && <div className="error">Lösenorden matchar inte än</div>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      <button className="btn btn--gold btn--lg btn--block" disabled={busy || password.length < PASSWORD_MIN || repeat !== password}>
        {busy ? 'Sparar…' : 'Spara & logga in'}
      </button>
      <p className="hint center" style={{ margin: 0 }}>
        Behöver du byta lösenord senare? <ResetHelp />
      </p>
    </form>
  );
}

/** Hur man återställer adminlösenordet (så att man får välja ett nytt här). */
function ResetHelp() {
  if (isDemoMode) return <>I demoläget: rensa webbplatsdata för sidan i webbläsaren och välj ett nytt.</>;
  return (
    <>
      I Vercel: <strong>Storage</strong> → din Neon-databas → <strong>Open in Neon</strong> → <strong>SQL Editor</strong>. Kör{' '}
      <code className="adm-code">{RESET_PASSWORD_SQL}</code> och välj sedan ett nytt lösenord här.
    </>
  );
}
