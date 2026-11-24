/** 87.4 → "87,4". null → "–". */
export function formatScore(score: number | null | undefined, decimals = 1): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '–';
  return score.toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Svenska ordningstal: 1 → "1:a", 2 → "2:a", 3 → "3:e", 11 → "11:e", 21 → "21:a". */
export function placeLabel(rank: number): string {
  const mod100 = rank % 100;
  const mod10 = rank % 10;
  const suffix = (mod10 === 1 || mod10 === 2) && mod100 !== 11 && mod100 !== 12 ? 'a' : 'e';
  return `${rank}:${suffix}`;
}

/** "24 november 2026" */
export function formatDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "lör 24 nov, 21:05" */
export function formatDateTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Medalj-emoji för placering 1–3. */
export function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
}

/** Bygger en absolut länk till en route i appen (hash-routing), t.ex. för QR-koder. */
export function appUrl(route: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#${route.startsWith('/') ? route : `/${route}`}`;
}
