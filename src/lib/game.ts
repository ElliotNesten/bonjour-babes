import { backend } from './backend';
import { computeResults } from './scoring';
import { DEFAULT_SETTINGS, effectiveOrder, nextDrinkIndex, normalizeGame, playerEntries } from './selectors';
import type { AwardId, Game, GameSettings, HallOfFameEntry, Player, Vote } from './types';

/* ------------------------------------------------------------------ */
/*  Avatarer                                                            */
/* ------------------------------------------------------------------ */

export const PLAYER_EMOJIS = ['🍸', '🍹', '🍷', '🥂', '🍾', '🍋', '🍒', '🫒', '🍊', '🥃', '🍓', '🥥', '🍍', '🧊', '🍑', '🌶️', '🍉', '🫐', '🥭', '🌿'];
export const PLAYER_COLORS = ['#6e1430', '#8a5a1c', '#2f4f4f', '#4b2a5e', '#1f3a5f', '#7a2e1f', '#3d5a2a', '#5e2a4b', '#6b4e16', '#244b4f', '#5a1f1f', '#36305e'];

export function randomFrom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomAvatar(taken: { emoji: string }[] = []): { emoji: string; color: string } {
  const used = new Set(taken.map((t) => t.emoji));
  const free = PLAYER_EMOJIS.filter((e) => !used.has(e));
  return { emoji: randomFrom(free.length ? free : PLAYER_EMOJIS), color: randomFrom(PLAYER_COLORS) };
}

export const NAME_MAX = 24;
export const DRINK_MAX = 40;
export const COMMENT_MAX = 280;

/* ------------------------------------------------------------------ */
/*  Hjälpfunktioner                                                     */
/* ------------------------------------------------------------------ */

const gamePath = (gameId: string, ...rest: string[]) => ['games', gameId, ...rest].join('/');

function requireUid(): string {
  const uid = backend.uid();
  if (!uid) throw new Error('Inte inloggad ännu');
  return uid;
}

export async function loadGame(gameId: string): Promise<Game | null> {
  return normalizeGame(await backend.get(gamePath(gameId)));
}

const LAST_GAME_KEY = 'bonjour-babes:last-game';

/** Kommer ihåg senaste spelet man gick med i (för "Fortsätt"-knappen på startsidan). */
export function rememberGame(gameId: string, pin: string) {
  try {
    localStorage.setItem(LAST_GAME_KEY, JSON.stringify({ gameId, pin }));
  } catch {
    /* ignore */
  }
}

export function lastGame(): { gameId: string; pin: string } | null {
  try {
    const raw = localStorage.getItem(LAST_GAME_KEY);
    return raw ? (JSON.parse(raw) as { gameId: string; pin: string }) : null;
  } catch {
    return null;
  }
}

export function forgetGame() {
  try {
    localStorage.removeItem(LAST_GAME_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  PIN & anslutning (alla)                                             */
/* ------------------------------------------------------------------ */

export function normalizePin(pin: string): string {
  return pin.replace(/\D/g, '').slice(0, 6);
}

/** Slår upp ett spel via PIN. Returnerar null om PIN:en inte finns. */
export async function findGameByPin(pin: string): Promise<{ gameId: string; game: Game } | null> {
  const clean = normalizePin(pin);
  if (clean.length !== 6) return null;
  const gameId = await backend.get<string>(`pins/${clean}`);
  if (!gameId) return null;
  const game = await loadGame(gameId);
  return game ? { gameId, game } : null;
}

export class JoinError extends Error {}

/**
 * Går med i ett spel (eller uppdaterar namn/drink om man redan är med).
 * Tillåtet i lobbyn och medan tävlingen pågår (sena anslutningar hamnar sist i ordningen).
 */
export async function joinGame(gameId: string, input: { name: string; drink: string; emoji?: string; color?: string }): Promise<void> {
  const uid = requireUid();
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  const drink = input.drink.trim().replace(/\s+/g, ' ').slice(0, DRINK_MAX);
  if (!name) throw new JoinError('Skriv ditt namn');
  if (!drink) throw new JoinError('Skriv namnet på din drink');
  const game = await loadGame(gameId);
  if (!game) throw new JoinError('Spelet finns inte');
  const existing = game.players[uid];
  if (!existing && game.meta.status !== 'lobby' && game.meta.status !== 'running') {
    throw new JoinError('Det här spelet tar inte emot nya deltagare längre');
  }
  const nameTaken = Object.entries(game.players).some(
    ([id, p]) => id !== uid && p.name.toLocaleLowerCase('sv') === name.toLocaleLowerCase('sv'),
  );
  if (nameTaken) throw new JoinError(`Namnet "${name}" är redan taget – lägg till en initial eller ett smeknamn`);
  const avatar = randomAvatar(Object.values(game.players));
  const player: Player = {
    name,
    drink,
    emoji: input.emoji ?? existing?.emoji ?? avatar.emoji,
    color: input.color ?? existing?.color ?? avatar.color,
    joinedAt: existing?.joinedAt ?? (backend.serverTime() as number),
  };
  await backend.set(gamePath(gameId, 'players', uid), player);
  rememberGame(gameId, game.meta.pin);
}

/** Ändra sin egen (eller som admin någons) avatar. */
export async function setAvatar(gameId: string, playerId: string, avatar: { emoji: string; color: string }) {
  await backend.update(gamePath(gameId, 'players', playerId), avatar);
}

/** Lämna spelet (tar bort sig själv). */
export async function leaveGame(gameId: string) {
  const uid = requireUid();
  await backend.remove(gamePath(gameId, 'players', uid));
  forgetGame();
}

/* ------------------------------------------------------------------ */
/*  Röstning (spelare)                                                  */
/* ------------------------------------------------------------------ */

export async function submitVote(gameId: string, drinkId: string, vote: Omit<Vote, 'at'>): Promise<void> {
  const uid = requireUid();
  if (uid === drinkId) throw new Error('Du kan inte rösta på din egen drink');
  const comment = (vote.comment ?? '').trim().slice(0, COMMENT_MAX);
  const payload: Vote = {
    taste: vote.taste,
    look: vote.look,
    creativity: vote.creativity,
    again: vote.again,
    ...(comment ? { comment } : {}),
    at: backend.serverTime() as number,
  };
  await backend.set(gamePath(gameId, 'votes', drinkId, uid), payload);
}

export async function submitAwardVote(gameId: string, awardId: AwardId, targetPlayerId: string): Promise<void> {
  const uid = requireUid();
  if (uid === targetPlayerId) throw new Error('Du kan inte rösta på dig själv');
  await backend.set(gamePath(gameId, 'awardVotes', awardId, uid), targetPlayerId);
}

/* ------------------------------------------------------------------ */
/*  Admin                                                               */
/* ------------------------------------------------------------------ */

async function generateUniquePin(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!(await backend.get(`pins/${pin}`))) return pin;
  }
  throw new Error('Kunde inte skapa en unik PIN, försök igen');
}

export async function createGame(name = 'Bonjour Babes', settings: Partial<GameSettings> = {}): Promise<{ gameId: string; pin: string }> {
  const gameId = backend.pushKey();
  const pin = await generateUniquePin();
  await backend.update('', {
    [`games/${gameId}/meta`]: {
      name: name.trim() || 'Bonjour Babes',
      pin,
      createdAt: backend.serverTime(),
      status: 'lobby',
    },
    [`games/${gameId}/settings`]: { ...DEFAULT_SETTINGS, ...settings },
    [`pins/${pin}`]: gameId,
  });
  return { gameId, pin };
}

export async function updateSettings(gameId: string, patch: Partial<GameSettings>) {
  await backend.update(gamePath(gameId, 'settings'), patch);
}

export async function renameGame(gameId: string, name: string) {
  await backend.set(gamePath(gameId, 'meta', 'name'), name.trim() || 'Bonjour Babes');
}

/** Admin: lägg till en deltagare utan egen mobil (kan inte rösta, men drinken betygsätts). */
export async function addManualPlayer(gameId: string, input: { name: string; drink: string }): Promise<string> {
  const game = await loadGame(gameId);
  if (!game) throw new Error('Spelet finns inte');
  const name = input.name.trim().slice(0, NAME_MAX);
  const drink = input.drink.trim().slice(0, DRINK_MAX);
  if (!name || !drink) throw new JoinError('Fyll i namn och drink');
  if (Object.values(game.players).some((p) => p.name.toLocaleLowerCase('sv') === name.toLocaleLowerCase('sv'))) {
    throw new JoinError(`Namnet "${name}" är redan taget`);
  }
  const id = backend.pushKey();
  const avatar = randomAvatar(Object.values(game.players));
  const player: Player = { name, drink, ...avatar, joinedAt: backend.serverTime() as number, manual: true };
  await backend.set(gamePath(gameId, 'players', id), player);
  return id;
}

/** Admin: ändra namn/drink för en deltagare. */
export async function editPlayer(gameId: string, playerId: string, patch: Partial<Pick<Player, 'name' | 'drink' | 'emoji' | 'color'>>) {
  const clean: Record<string, string> = {};
  if (patch.name !== undefined) clean.name = patch.name.trim().slice(0, NAME_MAX);
  if (patch.drink !== undefined) clean.drink = patch.drink.trim().slice(0, DRINK_MAX);
  if (patch.emoji !== undefined) clean.emoji = patch.emoji;
  if (patch.color !== undefined) clean.color = patch.color;
  if (clean.name === '' || clean.drink === '') throw new Error('Namn och drink får inte vara tomma');
  await backend.update(gamePath(gameId, 'players', playerId), clean);
}

/** Admin: ta bort en deltagare inklusive alla röster till och från hen. */
export async function removePlayer(gameId: string, playerId: string) {
  const game = await loadGame(gameId);
  if (!game) return;
  const updates: Record<string, unknown> = {
    [`players/${playerId}`]: null,
    [`votes/${playerId}`]: null,
    order: effectiveOrder(game).filter((id) => id !== playerId),
  };
  for (const drinkId of Object.keys(game.votes)) {
    if (game.votes[drinkId]?.[playerId]) updates[`votes/${drinkId}/${playerId}`] = null;
  }
  for (const [awardId, byVoter] of Object.entries(game.awardVotes)) {
    for (const [voterId, target] of Object.entries(byVoter ?? {})) {
      if (voterId === playerId || target === playerId) updates[`awardVotes/${awardId}/${voterId}`] = null;
    }
  }
  if (game.current?.drinkId === playerId) {
    // Den aktuella drinken försvann – backa till "förbereder" för samma position.
    const order = (updates.order as string[]) ?? [];
    const idx = Math.min(game.current.index, Math.max(0, order.length - 1));
    if (order.length) {
      updates.current = { index: idx, drinkId: order[idx], phase: 'preparing', since: backend.serverTime() };
    } else {
      updates.current = null;
    }
  }
  await backend.update(gamePath(gameId), updates);
}

/** Fisher–Yates. */
export function shuffle<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Admin: lotta ordningen. Storskärmen spelar en lottningsanimation när game.lottery.at ändras.
 * Om tävlingen redan pågår lottas bara drinkarna som inte har presenterats än.
 */
export async function drawOrder(gameId: string): Promise<string[]> {
  const game = await loadGame(gameId);
  if (!game) throw new Error('Spelet finns inte');
  const order = effectiveOrder(game);
  let next: string[];
  if (game.meta.status === 'running' && game.current) {
    const idx = order.indexOf(game.current.drinkId);
    const fixed = order.slice(0, idx + 1);
    next = [...fixed, ...shuffle(order.slice(idx + 1))];
  } else {
    next = shuffle(order);
  }
  await backend.update(gamePath(gameId), {
    order: next,
    lottery: { at: backend.serverTime(), order: next },
  });
  return next;
}

/** Admin: sätt ordningen manuellt (t.ex. efter dra-och-släpp eller upp/ner-knappar). */
export async function setOrder(gameId: string, order: string[]) {
  await backend.set(gamePath(gameId, 'order'), order);
}

/** Admin: flytta en spelare ett steg upp (-1) eller ner (+1) i ordningen. */
export async function moveInOrder(gameId: string, playerId: string, delta: -1 | 1) {
  const game = await loadGame(gameId);
  if (!game) return;
  const order = effectiveOrder(game);
  const i = order.indexOf(playerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await setOrder(gameId, order);
}

/** Admin: starta tävlingen – första drinken blir "på väg". */
export async function startGame(gameId: string) {
  const game = await loadGame(gameId);
  if (!game) throw new Error('Spelet finns inte');
  const order = effectiveOrder(game);
  if (order.length < 2) throw new Error('Det behövs minst två deltagare');
  await backend.update(gamePath(gameId), {
    order,
    'meta/status': 'running',
    'meta/startedAt': backend.serverTime(),
    current: { index: 0, drinkId: order[0], phase: 'preparing', since: backend.serverTime() },
  });
}

/** Admin: gå till en viss drink (index i effectiveOrder) i fasen "preparing". */
export async function goToDrink(gameId: string, index: number) {
  const game = await loadGame(gameId);
  if (!game) return;
  const order = effectiveOrder(game);
  if (index < 0 || index >= order.length) return;
  await backend.update(gamePath(gameId), {
    order,
    'meta/status': 'running',
    current: { index, drinkId: order[index], phase: 'preparing', since: backend.serverTime() },
  });
}

/** Admin: drinken är serverad – öppna röstningen. */
export async function openVoting(gameId: string) {
  await backend.update(gamePath(gameId, 'current'), { phase: 'voting', since: backend.serverTime() });
}

/** Admin: lås röstningen för den aktuella drinken. */
export async function closeVoting(gameId: string) {
  await backend.update(gamePath(gameId, 'current'), { phase: 'closed', since: backend.serverTime() });
}

/** Admin: nästa drink är på väg. Returnerar false om det inte finns fler drinkar. */
export async function nextDrink(gameId: string): Promise<boolean> {
  const game = await loadGame(gameId);
  if (!game) return false;
  const next = nextDrinkIndex(game);
  if (next === null) return false;
  await goToDrink(gameId, next);
  return true;
}

/** Admin: alla drinkar klara – öppna specialpris-röstningen. */
export async function startAwards(gameId: string) {
  await backend.update(gamePath(gameId), {
    'meta/status': 'awards',
    'current/phase': 'closed',
  });
}

/** Admin: starta prisutdelningen på storskärmen. */
export async function startCeremony(gameId: string) {
  await backend.update(gamePath(gameId), {
    'meta/status': 'ceremony',
    'current/phase': 'closed',
    ceremony: { step: 0, at: backend.serverTime() },
  });
}

/** Admin: gå till ett visst steg i prisutdelningen. */
export async function setCeremonyStep(gameId: string, step: number) {
  await backend.set(gamePath(gameId, 'ceremony'), { step: Math.max(0, step), at: backend.serverTime() });
}

/** Admin: avsluta spelet och spara det i Hall of Fame. */
export async function finishGame(gameId: string) {
  const game = await loadGame(gameId);
  if (!game) throw new Error('Spelet finns inte');
  const results = computeResults(game);
  const entry: HallOfFameEntry = {
    name: game.meta.name,
    pin: game.meta.pin,
    createdAt: game.meta.createdAt,
    finishedAt: backend.serverTime() as number,
    participants: Object.keys(game.players).length,
    ranking: results.ranking.map((d) => ({
      rank: d.rank,
      name: d.name,
      drink: d.drink,
      score: d.score,
      emoji: d.emoji,
      color: d.color,
    })),
  };
  await backend.update('', {
    [`games/${gameId}/meta/status`]: 'finished',
    [`games/${gameId}/meta/finishedAt`]: backend.serverTime(),
    [`hallOfFame/${gameId}`]: entry,
  });
}

/** Admin: öppna ett avslutat spel igen (tar bort det ur Hall of Fame tills det avslutas på nytt). */
export async function reopenGame(gameId: string, status: 'running' | 'awards' | 'ceremony' = 'ceremony') {
  await backend.update('', {
    [`games/${gameId}/meta/status`]: status,
    [`games/${gameId}/meta/finishedAt`]: null,
    [`hallOfFame/${gameId}`]: null,
  });
}

/** Admin: radera ett spel helt (inklusive PIN och Hall of Fame-post). */
export async function deleteGame(gameId: string) {
  const game = await loadGame(gameId);
  const updates: Record<string, unknown> = {
    [`games/${gameId}`]: null,
    [`hallOfFame/${gameId}`]: null,
  };
  if (game?.meta.pin) updates[`pins/${game.meta.pin}`] = null;
  await backend.update('', updates);
}

/** Admin: lista alla spel (nyast först). */
export async function listGames(): Promise<{ gameId: string; game: Game }[]> {
  const raw = (await backend.get<Record<string, unknown>>('games')) ?? {};
  return Object.entries(raw)
    .map(([gameId, g]) => ({ gameId, game: normalizeGame(g) }))
    .filter((x): x is { gameId: string; game: Game } => !!x.game)
    .sort((a, b) => b.game.meta.createdAt - a.game.meta.createdAt);
}

export { playerEntries };
