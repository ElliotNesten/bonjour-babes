import { effectiveOrder, votesForDrink } from './selectors';
import type { AwardId, CategoryId, Game, Vote } from './types';

/* ------------------------------------------------------------------ */
/*  Poängsystemet                                                       */
/* ------------------------------------------------------------------ */

export interface Category {
  id: CategoryId;
  label: string;
  /** Fransk undertitel för stämningen. */
  fr: string;
  emoji: string;
  weight: number;
  hint: string;
}

/**
 * Varje domare ger 1–10 i fyra kategorier. Kategorierna viktas (summa 9) och
 * räknas om till en skala 10–100: total = Σ(betyg × vikt) / 9 × 10.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'taste', label: 'Smak', fr: 'Le goût', emoji: '👅', weight: 4, hint: 'Det viktigaste – är den god?' },
  { id: 'look', label: 'Utseende', fr: 'Le look', emoji: '🎨', weight: 2, hint: 'Färg, glas & garnityr' },
  { id: 'creativity', label: 'Kreativitet', fr: "L'audace", emoji: '💡', weight: 2, hint: 'Hur originell är idén?' },
  { id: 'again', label: 'Skulle beställa igen', fr: 'Encore !', emoji: '🔁', weight: 1, hint: 'Magkänslan' },
];

export const WEIGHT_SUM = CATEGORIES.reduce((s, c) => s + c.weight, 0);

/** Minsta antal röster på en drink för att OS-regeln ska tillämpas. */
export const TRIM_MIN_VOTES = 5;

export interface AwardDef {
  id: AwardId;
  title: string;
  fr: string;
  emoji: string;
  /** Frågan som visas i mobilen. */
  question: string;
}

/** Specialpriser – röstas fram efter sista drinken. Bara ära, inga poäng. */
export const AWARDS: readonly AwardDef[] = [
  { id: 'name', title: 'Bästa namn', fr: 'Le meilleur nom', emoji: '🏷️', question: 'Vilken drink har kvällens bästa namn?' },
  { id: 'daring', title: 'Mest vågad', fr: 'Le plus audacieux', emoji: '🌶️', question: 'Vilken drink tog störst risk?' },
  { id: 'swamp', title: 'Träskmonstret', fr: 'Le monstre du marais', emoji: '💀', question: 'Kvällens mest… tveksamma skapelse?' },
  { id: 'favorite', title: 'Publikens favorit', fr: 'Le coup de cœur', emoji: '⭐', question: 'Din personliga favorit för kvällen?' },
];

export const AWARD_IDS: AwardId[] = AWARDS.map((a) => a.id);

export function getCategory(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id)!;
}

export function getAward(id: AwardId): AwardDef {
  return AWARDS.find((a) => a.id === id)!;
}

/** En domares totalpoäng för en drink, 10–100 (oavrundad). */
export function voteTotal(v: Pick<Vote, CategoryId>): number {
  const sum = CATEGORIES.reduce((s, c) => s + c.weight * v[c.id], 0);
  return (sum / WEIGHT_SUM) * 10;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/*  Resultat                                                            */
/* ------------------------------------------------------------------ */

export interface JudgeScore {
  voterId: string;
  voterName: string;
  /** 10–100, oavrundad. */
  total: number;
  vote: Vote;
  /** Struken av OS-regeln (högsta eller lägsta). */
  dropped: boolean;
}

export interface DrinkResult {
  playerId: string;
  name: string;
  drink: string;
  emoji: string;
  color: string;
  /** Plats i ordningen drinken presenterades (0-baserad). */
  orderIndex: number;
  /** Slutpoäng 10–100 avrundad till en decimal, null om inga röster. */
  score: number | null;
  /** Placering (1 = vinnare). Delad placering vid helt lika. */
  rank: number;
  voteCount: number;
  /** true om OS-regeln tillämpades på drinken. */
  trimmed: boolean;
  /** Snitt per kategori (alla röster, inga strukna), null om inga röster. */
  categoryAvg: Record<CategoryId, number | null>;
  /** Alla domarpoäng, sorterade högst först. */
  judges: JudgeScore[];
  /** Standardavvikelse för domarnas totalpoäng (null om färre än 2 röster). */
  stdDev: number | null;
  /** Antal 10:or drinken fick (alla kategorier). */
  tens: number;
  /** Anonyma kommentarer i slumpmässig men stabil ordning. */
  comments: string[];
}

export interface AwardResult {
  id: AwardId;
  /** Flera vinnare vid delad seger. Tom om ingen röstat. */
  winners: { playerId: string; name: string; drink: string; emoji: string; color: string; votes: number }[];
  totalVotes: number;
}

export interface CategoryWinner {
  categoryId: CategoryId;
  playerId: string;
  name: string;
  drink: string;
  emoji: string;
  color: string;
  avg: number;
}

export interface JudgeStat {
  playerId: string;
  name: string;
  emoji: string;
  color: string;
  votesGiven: number;
  /** Snitt av totalpoängen domaren delat ut. */
  avgGiven: number;
  tensGiven: number;
}

export interface Stats {
  /** Hårdaste domaren – lägst snitt (minst 2 röster). */
  harshest?: JudgeStat;
  /** Snällaste domaren – högst snitt (minst 2 röster). */
  kindest?: JudgeStat;
  /** Domaren som delat ut flest 10:or. */
  mostTens?: JudgeStat;
  /** Drinken där domarna var mest oense (högst standardavvikelse, minst 3 röster). */
  mostDivisive?: DrinkResult;
  /** Drinken där domarna var mest eniga (lägst standardavvikelse, minst 3 röster). */
  mostUnanimous?: DrinkResult;
  /** Kvällens högsta enskilda betyg. */
  highestSingle?: { judge: JudgeStat; drink: DrinkResult; total: number };
}

export interface Results {
  /** Alla drinkar sorterade efter placering. */
  ranking: DrinkResult[];
  awards: AwardResult[];
  categoryWinners: CategoryWinner[];
  judges: JudgeStat[];
  stats: Stats;
  totalVotes: number;
  trimApplied: boolean;
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function stdDev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

/** Liten deterministisk hash – används för att blanda kommentarer så att ordningen inte avslöjar något. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function countTens(v: Vote): number {
  return CATEGORIES.filter((c) => v[c.id] === 10).length;
}

const EPS = 1e-9;

/**
 * Räknar fram hela resultatet ur speldatan. Deterministiskt – samma data ger
 * alltid samma resultat, så storskärm, mobiler och resultatsida är alltid överens.
 *
 * Placering: högst slutpoäng (en decimal) → högst snitt på smak → flest 10:or.
 * Är allt lika delar drinkarna placering.
 */
export function computeResults(game: Game): Results {
  const order = effectiveOrder(game);
  const trimEnabled = game.settings.trimExtremes;
  let trimApplied = false;

  const drinks: DrinkResult[] = order.map((playerId, orderIndex) => {
    const p = game.players[playerId];
    const votes = votesForDrink(game, playerId);
    const judges: JudgeScore[] = Object.entries(votes).map(([voterId, vote]) => ({
      voterId,
      voterName: game.players[voterId]?.name ?? 'Okänd',
      total: voteTotal(vote),
      vote,
      dropped: false,
    }));
    // Sortera högst först, stabilt på voterId.
    judges.sort((a, b) => b.total - a.total || a.voterId.localeCompare(b.voterId));

    const trimmed = trimEnabled && judges.length >= TRIM_MIN_VOTES;
    if (trimmed) {
      trimApplied = true;
      judges[0].dropped = true;
      judges[judges.length - 1].dropped = true;
    }
    const counted = judges.filter((j) => !j.dropped).map((j) => j.total);
    const score = counted.length ? round1(mean(counted)) : null;

    const categoryAvg = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, judges.length ? mean(judges.map((j) => j.vote[c.id])) : null]),
    ) as Record<CategoryId, number | null>;

    const comments = Object.entries(votes)
      .map(([voterId, v]) => ({ key: hash(`${playerId}:${voterId}`), text: (v.comment ?? '').trim() }))
      .filter((c) => c.text.length > 0)
      .sort((a, b) => a.key - b.key)
      .map((c) => c.text);

    return {
      playerId,
      name: p.name,
      drink: p.drink,
      emoji: p.emoji,
      color: p.color,
      orderIndex,
      score,
      rank: 0,
      voteCount: judges.length,
      trimmed,
      categoryAvg,
      judges,
      stdDev: stdDev(judges.map((j) => j.total)),
      tens: judges.reduce((s, j) => s + countTens(j.vote), 0),
      comments,
    };
  });

  const cmp = (a: DrinkResult, b: DrinkResult): number => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if (Math.abs(a.score - b.score) > EPS) return b.score - a.score;
    const ta = a.categoryAvg.taste ?? 0;
    const tb = b.categoryAvg.taste ?? 0;
    if (Math.abs(ta - tb) > EPS) return tb - ta;
    return b.tens - a.tens;
  };

  const ranking = [...drinks].sort((a, b) => cmp(a, b) || a.orderIndex - b.orderIndex);
  ranking.forEach((d, i) => {
    d.rank = i > 0 && cmp(ranking[i - 1], d) === 0 ? ranking[i - 1].rank : i + 1;
  });

  /* Specialpriser */
  const awards: AwardResult[] = AWARDS.map((a) => {
    const counts = new Map<string, number>();
    let totalVotes = 0;
    for (const [voterId, target] of Object.entries(game.awardVotes[a.id] ?? {})) {
      if (!game.players[voterId] || !game.players[target] || voterId === target) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
      totalVotes++;
    }
    const max = Math.max(0, ...counts.values());
    const winners =
      max === 0
        ? []
        : [...counts.entries()]
            .filter(([, n]) => n === max)
            .map(([playerId, votes]) => {
              const p = game.players[playerId];
              return { playerId, name: p.name, drink: p.drink, emoji: p.emoji, color: p.color, votes };
            })
            .sort((x, y) => order.indexOf(x.playerId) - order.indexOf(y.playerId));
    return { id: a.id, winners, totalVotes };
  });

  /* Kategorivinnare */
  const rated = ranking.filter((d) => d.voteCount > 0);
  const categoryWinners: CategoryWinner[] = [];
  for (const c of CATEGORIES) {
    let best: DrinkResult | null = null;
    for (const d of rated) {
      const avg = d.categoryAvg[c.id] ?? 0;
      const bestAvg = best ? (best.categoryAvg[c.id] ?? 0) : -1;
      if (avg > bestAvg + EPS) best = d; // vid lika vinner den med bäst placering (ranking är redan sorterad)
    }
    if (best) {
      categoryWinners.push({
        categoryId: c.id,
        playerId: best.playerId,
        name: best.name,
        drink: best.drink,
        emoji: best.emoji,
        color: best.color,
        avg: best.categoryAvg[c.id] ?? 0,
      });
    }
  }

  /* Domarstatistik */
  const given = new Map<string, { totals: number[]; tens: number }>();
  for (const d of drinks) {
    for (const j of d.judges) {
      const g = given.get(j.voterId) ?? { totals: [], tens: 0 };
      g.totals.push(j.total);
      g.tens += countTens(j.vote);
      given.set(j.voterId, g);
    }
  }
  const judges: JudgeStat[] = [...given.entries()]
    .map(([playerId, g]) => {
      const p = game.players[playerId];
      return {
        playerId,
        name: p.name,
        emoji: p.emoji,
        color: p.color,
        votesGiven: g.totals.length,
        avgGiven: mean(g.totals),
        tensGiven: g.tens,
      };
    })
    .sort((a, b) => b.avgGiven - a.avgGiven || a.name.localeCompare(b.name, 'sv'));

  const stats: Stats = {};
  const eligibleJudges = judges.filter((j) => j.votesGiven >= 2);
  if (eligibleJudges.length >= 2) {
    stats.kindest = eligibleJudges[0];
    stats.harshest = eligibleJudges[eligibleJudges.length - 1];
  }
  const tensSorted = [...judges].sort((a, b) => b.tensGiven - a.tensGiven || a.name.localeCompare(b.name, 'sv'));
  if (tensSorted[0]?.tensGiven > 0) stats.mostTens = tensSorted[0];

  const spread = rated.filter((d) => d.voteCount >= 3 && d.stdDev !== null);
  if (spread.length >= 2) {
    const bySpread = [...spread].sort((a, b) => b.stdDev! - a.stdDev! || a.orderIndex - b.orderIndex);
    stats.mostDivisive = bySpread[0];
    stats.mostUnanimous = bySpread[bySpread.length - 1];
  }

  let highest: Stats['highestSingle'];
  for (const d of drinks) {
    for (const j of d.judges) {
      if (!highest || j.total > highest.total + EPS) {
        const judge = judges.find((x) => x.playerId === j.voterId);
        if (judge) highest = { judge, drink: d, total: j.total };
      }
    }
  }
  if (highest) stats.highestSingle = highest;

  return {
    ranking,
    awards,
    categoryWinners,
    judges,
    stats,
    totalVotes: drinks.reduce((s, d) => s + d.voteCount, 0),
    trimApplied,
  };
}
