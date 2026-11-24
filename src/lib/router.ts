import { useEffect, useState } from 'react';

/**
 * Enkel hash-router (fungerar på GitHub Pages utan serverkonfiguration).
 *
 * Routes:
 *   #/                      Startsida – ange PIN
 *   #/join/:pin             Gå med i ett spel (namn + drink)
 *   #/play/:gameId          Spelarvyn i mobilen
 *   #/tv                    Storskärm – ange PIN
 *   #/tv/:gameId            Storskärm för ett spel
 *   #/admin                 Admin – logga in / lista spel
 *   #/admin/:gameId         Admin – styr ett spel
 *   #/results/:gameId       Publik resultatsida
 *   #/hall-of-fame          Hall of Fame
 */

function parse(hash: string): string[] {
  const clean = hash.replace(/^#/, '').split('?')[0];
  return clean
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

export function useRoute(): string[] {
  const [segments, setSegments] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setSegments(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return segments;
}

export function navigate(to: string, replace = false) {
  const hash = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export function href(to: string): string {
  return `#${to.startsWith('/') ? to : `/${to}`}`;
}
