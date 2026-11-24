import { Backdrop } from './Backdrop';

export function Loading({ text = 'Ett ögonblick…', full = false }: { text?: string; full?: boolean }) {
  const content = (
    <div className={`loading ${full ? 'loading--full' : ''}`} role="status" aria-live="polite">
      <div className="loading__dots">
        <span />
        <span />
        <span />
      </div>
      <div className="italic">{text}</div>
    </div>
  );
  if (!full) return content;
  return (
    <>
      <Backdrop bubbles={10} />
      {content}
    </>
  );
}
