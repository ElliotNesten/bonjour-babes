import { toArray } from '../../lib/selectors';
import type { HallOfFameEntry, HallOfFameRankingEntry } from '../../lib/types';

/** En avslutad kväll i Hall of Fame, tvättad från databasen. */
export interface HofNight {
  gameId: string;
  name: string;
  createdAt: number;
  finishedAt: number;
  participants: number;
  ranking: HallOfFameRankingEntry[];
}

export interface HofDrink extends HallOfFameRankingEntry {
  gameId: string;
  gameName: string;
  date: number;
}

export interface HofChampion {
  key: string;
  name: string;
  emoji: string;
  color: string;
  wins: number;
  lastWin: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeEntry(raw: unknown): HallOfFameRankingEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof HallOfFameRankingEntry, unknown>>;
  const score = r.score === null || r.score === undefined || r.score === '' ? null : Number(r.score);
  return {
    rank: Math.max(1, Math.round(num(r.rank)) || 1),
    name: String(r.name ?? '').trim() || 'Okänd',
    drink: String(r.drink ?? '').trim() || 'Hemlig drink',
    score: score !== null && Number.isFinite(score) ? score : null,
    emoji: typeof r.emoji === 'string' && r.emoji ? r.emoji : '🍸',
    color: typeof r.color === 'string' && r.color ? r.color : '#6e1430',
  };
}

/** Gör om rådata från hallOfFame/ till en lista, nyast först. */
export function normalizeHallOfFame(raw: Record<string, HallOfFameEntry> | null | undefined): HofNight[] {
  if (!raw || typeof raw !== 'object') return [];
  const nights: HofNight[] = [];
  for (const [gameId, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Partial<Record<keyof HallOfFameEntry, unknown>>;
    const ranking = toArray<unknown>(e.ranking)
      .map(normalizeEntry)
      .filter((x): x is HallOfFameRankingEntry => !!x)
      .sort((a, b) => a.rank - b.rank);
    const createdAt = num(e.createdAt);
    nights.push({
      gameId,
      name: String(e.name ?? '').trim() || 'Bonjour Babes',
      createdAt,
      finishedAt: num(e.finishedAt) || createdAt,
      participants: num(e.participants) || ranking.length,
      ranking,
    });
  }
  return nights.sort((a, b) => b.finishedAt - a.finishedAt || b.createdAt - a.createdAt);
}

/** Kvällens vinnare (flera vid delad förstaplats). */
export function winnersOf(night: HofNight): HallOfFameRankingEntry[] {
  return night.ranking.filter((r) => r.rank === 1);
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase('sv');

/** "Flest segrar" – grupperat på namn (skiftlägesokänsligt). nights ska vara nyast först. */
export function champions(nights: HofNight[]): HofChampion[] {
  const map = new Map<string, HofChampion>();
  for (const night of nights) {
    for (const w of winnersOf(night)) {
      const key = nameKey(w.name);
      const existing = map.get(key);
      if (existing) {
        existing.wins += 1;
      } else {
        // Första träffen är den senaste segern – använd dess stavning och avatar.
        map.set(key, { key, name: w.name.trim(), emoji: w.emoji, color: w.color, wins: 1, lastWin: night.finishedAt });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.wins - a.wins || b.lastWin - a.lastWin || a.name.localeCompare(b.name, 'sv'));
}

function drinksOf(night: HofNight): HofDrink[] {
  return night.ranking.map((r) => ({ ...r, gameId: night.gameId, gameName: night.name, date: night.finishedAt }));
}

const byScore = (a: HofDrink, b: HofDrink) => (b.score ?? 0) - (a.score ?? 0) || a.date - b.date;

/** "Högsta vinnarpoäng genom tiderna" */
export function topWinningScores(nights: HofNight[], limit = 5): HofDrink[] {
  return nights
    .flatMap((n) => drinksOf(n).filter((d) => d.rank === 1 && d.score !== null))
    .sort(byScore)
    .slice(0, limit);
}

/** "Topp 10 drinkar genom tiderna" */
export function topDrinks(nights: HofNight[], limit = 10): HofDrink[] {
  return nights
    .flatMap((n) => drinksOf(n).filter((d) => d.score !== null))
    .sort(byScore)
    .slice(0, limit);
}

export function totals(nights: HofNight[]): { nights: number; drinks: number; guests: number } {
  const names = new Set<string>();
  let drinks = 0;
  for (const n of nights) {
    for (const r of n.ranking) {
      names.add(nameKey(r.name));
      if (r.score !== null) drinks++;
    }
  }
  return { nights: nights.length, drinks, guests: names.size };
}
