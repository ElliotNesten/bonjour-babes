import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isPermissionDenied } from '../../lib/backend';

/* ------------------------------------------------------------------ */
/*  Feedback för adminpanelen: toasts, bekräftelsedialog och en         */
/*  "runner" som kör en åtgärd i taget (alla knappar spärras medan      */
/*  något pågår, så att dubbeltryck aldrig hoppar över en drink).       */
/* ------------------------------------------------------------------ */

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Röd bekräftelseknapp (radera, ta bort …). */
  danger?: boolean;
}

export interface RunOptions {
  /** Visas som toast när åtgärden lyckas. */
  success?: string;
  /** Visa felet här (t.ex. under ett formulär) i stället för som toast. */
  onError?: (message: string) => void;
}

interface FeedbackApi {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Kör en åtgärd. Returnerar true om den lyckades. Ignoreras om en annan åtgärd redan pågår. */
  run: (key: string, fn: () => Promise<unknown>, opts?: RunOptions) => Promise<boolean>;
  /** Nyckeln för åtgärden som pågår just nu (eller null). */
  pending: string | null;
  /** true medan bekräftelsedialogen är öppen. */
  modalOpen: boolean;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback används utanför <AdminFeedback>');
  return ctx;
}

/** Gör om ett fel till ett begripligt meddelande på svenska. */
export function errorMessage(err: unknown): string {
  if (isPermissionDenied(err)) return 'Saknar adminbehörighet – logga in igen';
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Något gick fel – försök igen';
}

interface DialogState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let toastSeq = 0;

export function AdminFeedback({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = ++toastSeq;
      setToasts((list) => [...list.filter((t) => t.text !== text), { id, text, kind }].slice(-2));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), kind === 'error' ? 6500 : kind === 'success' ? 2600 : 4500),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog((prev) => {
          prev?.resolve(false);
          return { ...opts, resolve };
        });
      }),
    [],
  );

  const closeDialog = useCallback((ok: boolean) => {
    setDialog((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, opts: RunOptions = {}) => {
      if (pendingRef.current) return false;
      pendingRef.current = key;
      setPending(key);
      try {
        await fn();
        if (opts.success) toast(opts.success, 'success');
        return true;
      } catch (err) {
        const msg = errorMessage(err);
        if (opts.onError) opts.onError(msg);
        else toast(msg, 'error');
        return false;
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [toast],
  );

  const api = useMemo<FeedbackApi>(
    () => ({ toast, confirm, run, pending, modalOpen: !!dialog }),
    [toast, confirm, run, pending, dialog],
  );

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="adm-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`adm-toast adm-toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="adm-toast__icon" aria-hidden="true">
              {t.kind === 'error' ? '⚠️' : t.kind === 'success' ? '✓' : '🍸'}
            </span>
            <span className="grow">{t.text}</span>
            <button type="button" className="adm-toast__close" onClick={() => dismiss(t.id)} aria-label="Stäng meddelandet">
              ×
            </button>
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog dialog={dialog} onClose={closeDialog} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ dialog, onClose }: { dialog: DialogState; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="adm-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="adm-dialog__card card card--deco card--gold" role="alertdialog" aria-modal="true" aria-labelledby="adm-dialog-title" aria-describedby={dialog.body ? 'adm-dialog-body' : undefined}>
        <h3 id="adm-dialog-title" className="adm-dialog__title">
          {dialog.title}
        </h3>
        {dialog.body && (
          <div id="adm-dialog-body" className="adm-dialog__body muted">
            {dialog.body}
          </div>
        )}
        <div className="adm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onClose(false)}>
            {dialog.cancelLabel ?? 'Avbryt'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${dialog.danger ? 'btn--danger' : 'btn--gold'}`}
            onClick={() => onClose(true)}
          >
            {dialog.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
