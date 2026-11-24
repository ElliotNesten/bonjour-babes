import { isDemoMode } from '../lib/backend';
import { useConnected } from '../lib/hooks';

/** Visar en banner när servern inte går att nå (se onConnection i backenden), och en liten bricka i demoläget. */
export function ConnectionBanner() {
  const connected = useConnected();
  return (
    <>
      {!connected && (
        <div className="banner" role="alert">
          Ingen anslutning – försöker igen…
        </div>
      )}
      {isDemoMode && <div className="demo-badge">Demoläge · sparas bara i den här webbläsaren</div>}
    </>
  );
}
