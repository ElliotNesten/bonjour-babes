import { formatDate, formatScore } from './format';
import { AWARDS, CATEGORIES, type DrinkResult, type Results } from './scoring';
import type { CategoryId, Game } from './types';

/**
 * Instagram Story-bild (1080×1920 PNG) med kvällens prispall.
 *
 * Ritas helt på en canvas – inga externa bilder – i samma stil som sidan:
 * bläcksvart → bordeaux, champagneguld, art deco-ram, solfjäder och bubblor.
 *
 * Instagram täcker ungefär de översta och nedersta ~220 px med sitt eget
 * gränssnitt, så allt viktigt ligger mellan y ≈ 230 och y ≈ 1700.
 */

const W = 1080;
const H = 1920;
const CX = W / 2;

const COLOR = {
  ink: '#0a0910',
  gold: '#d9b26f',
  goldLight: '#f3dca5',
  goldDeep: '#a8823f',
  champagne: '#f6ead0',
  text: '#f4ead6',
  muted: '#c2b498',
  dim: '#8a7f6e',
};

/** [ljus, mellan, mörk] per placering. */
const MEDALS: Record<1 | 2 | 3, [string, string, string]> = {
  1: ['#fff3c8', '#e9c46a', '#9a7023'],
  2: ['#ffffff', '#cfd6de', '#7b8590'],
  3: ['#f8cfa8', '#cd8a5a', '#7a4524'],
};

const FONT = {
  script: '"Pinyon Script", "Snell Roundhand", cursive',
  display: '"Playfair Display", Georgia, "Times New Roman", serif',
  deco: '"Josefin Sans", Futura, "Century Gothic", sans-serif',
  body: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  emoji: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
};

type Ctx = CanvasRenderingContext2D;

interface Highlight {
  emoji: string;
  label: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/*  Publikt API                                                         */
/* ------------------------------------------------------------------ */

/** Ritar story-bilden och returnerar den som PNG. */
export async function createStoryImage(game: Game, results: Results): Promise<Blob> {
  const podium = results.ranking.slice(0, 3);
  const highlights = buildHighlights(game, results);
  const date = formatDate(game.meta.createdAt || game.meta.finishedAt || Date.now());
  const subtitle = customGameName(game.meta.name);

  const allText = [
    'Bonjour BABES Le Podium Santé ! POÄNG INGA RÖSTER UNE SOIRÉE DE COCKTAILS KVÄLLENS UTMÄRKELSER 0123456789,–',
    date,
    subtitle ?? '',
    ...podium.flatMap((d) => [d.name, d.drink]),
    ...highlights.flatMap((h) => [h.label.toUpperCase(), h.value]),
  ].join(' ');
  await loadFonts(allText);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Webbläsaren kan inte rita bilden');
  ctx.textBaseline = 'alphabetic';

  const rand = seededRandom(hashString(`${game.meta.pin}:${game.meta.createdAt}`));

  drawBackground(ctx, rand);
  drawFrame(ctx);
  drawHeader(ctx, date, subtitle);
  drawPodium(ctx, podium);
  if (highlights.length) drawHighlights(ctx, highlights);
  drawFooter(ctx);

  return canvasToBlob(canvas);
}

/** Filnamn för bilden: bonjour-babes-2026-11-24.png */
export function storyFileName(game: Game): string {
  const d = new Date(game.meta.createdAt || game.meta.finishedAt || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bonjour-babes-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.png`;
}

/* ------------------------------------------------------------------ */
/*  Innehåll                                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_HIGHLIGHT: Record<CategoryId, string> = {
  taste: 'Godast',
  look: 'Snyggast',
  creativity: 'Mest kreativ',
  again: 'Mest ”en till!”',
};

function buildHighlights(game: Game, results: Results): Highlight[] {
  const out: Highlight[] = [];
  if (game.settings.awardsEnabled) {
    for (const def of AWARDS) {
      const r = results.awards.find((a) => a.id === def.id);
      if (!r || r.winners.length === 0) continue;
      const value = r.winners.length === 1 ? `${r.winners[0].name} – ${r.winners[0].drink}` : joinNames(r.winners.map((w) => w.name));
      out.push({ emoji: def.emoji, label: def.title, value });
    }
  }
  if (out.length >= 2) return out.slice(0, 4);

  // Inga (eller för få) specialpriser: visa kategorivinnare – samma drink bara en gång –
  // och fyll på med kvällens statistik.
  const seen = new Set<string>();
  for (const c of CATEGORIES) {
    const w = results.categoryWinners.find((x) => x.categoryId === c.id);
    if (!w || seen.has(w.playerId)) continue;
    seen.add(w.playerId);
    out.push({ emoji: c.emoji, label: CATEGORY_HIGHLIGHT[c.id], value: `${w.name} – ${w.drink}` });
    if (out.length >= 2) break;
  }
  const s = results.stats;
  const extras: Highlight[] = [];
  if (s.kindest) extras.push({ emoji: '😇', label: 'Snällaste domaren', value: s.kindest.name });
  if (s.harshest) extras.push({ emoji: '🧐', label: 'Hårdaste domaren', value: s.harshest.name });
  if (s.mostDivisive) extras.push({ emoji: '⚡', label: 'Mest omdiskuterad', value: `${s.mostDivisive.name} – ${s.mostDivisive.drink}` });
  for (const e of extras) {
    if (out.length >= 3) break;
    out.push(e);
  }
  return out;
}

/** ["Leo", "Oscar", "Wilma"] → "Leo, Oscar & Wilma" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function customGameName(name: string): string | null {
  const clean = name.trim();
  if (!clean || /^bonjour\s*babes$/i.test(clean)) return null;
  return clean;
}

/* ------------------------------------------------------------------ */
/*  Typsnitt                                                            */
/* ------------------------------------------------------------------ */

async function loadFonts(text: string, timeoutMs = 3500): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== 'function') return;
  const specs = [
    `400 100px ${FONT.script}`,
    `600 40px ${FONT.deco}`,
    `700 40px ${FONT.deco}`,
    `700 40px ${FONT.display}`,
    `800 40px ${FONT.display}`,
    `italic 400 40px ${FONT.display}`,
    `italic 700 40px ${FONT.display}`,
    `500 40px ${FONT.body}`,
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const loads = Promise.allSettled(
    specs.map((s) => {
      try {
        return fonts.load(s, text);
      } catch {
        return Promise.resolve([]);
      }
    }),
  ).then(() => undefined);
  try {
    await Promise.race([loads, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function font(ctx: Ctx, size: number, family: string, weight: number | string = 400, style: 'normal' | 'italic' = 'normal') {
  ctx.font = `${style} ${weight} ${Math.round(size)}px ${family}`;
}

/* ------------------------------------------------------------------ */
/*  Bakgrund & ram                                                      */
/* ------------------------------------------------------------------ */

const PODIUM_BASE = 1365;

function drawBackground(ctx: Ctx, rand: () => number) {
  // Bläcksvart → bordeaux
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#09080d');
  bg.addColorStop(0.38, '#110b12');
  bg.addColorStop(0.72, '#250a17');
  bg.addColorStop(1, '#4a0f26');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Mjuka glöd
  glow(ctx, 60, 80, 900, 'rgba(155, 39, 71, 0.42)');
  glow(ctx, W + 40, 520, 700, 'rgba(110, 20, 48, 0.35)');
  glow(ctx, CX, 1060, 620, 'rgba(217, 178, 111, 0.16)');
  glow(ctx, CX, H + 120, 1000, 'rgba(155, 39, 71, 0.55)');

  // Art deco-solfjäder bakom prispallen
  const rays = 34;
  const span = Math.PI; // övre halvan
  const rayGrad = ctx.createRadialGradient(CX, PODIUM_BASE, 60, CX, PODIUM_BASE, 1150);
  rayGrad.addColorStop(0, 'rgba(243, 220, 165, 0.16)');
  rayGrad.addColorStop(0.55, 'rgba(217, 178, 111, 0.06)');
  rayGrad.addColorStop(1, 'rgba(217, 178, 111, 0)');
  ctx.fillStyle = rayGrad;
  for (let i = 0; i < rays; i++) {
    const a0 = Math.PI + (i / rays) * span;
    const a1 = a0 + (span / rays) * 0.42;
    ctx.beginPath();
    ctx.moveTo(CX, PODIUM_BASE);
    ctx.lineTo(CX + Math.cos(a0) * 1400, PODIUM_BASE + Math.sin(a0) * 1400);
    ctx.lineTo(CX + Math.cos(a1) * 1400, PODIUM_BASE + Math.sin(a1) * 1400);
    ctx.closePath();
    ctx.fill();
  }

  // Koncentriska bågar (solfjäderns kant)
  ctx.save();
  ctx.lineWidth = 1.2;
  for (const [r, a] of [
    [520, 0.12],
    [560, 0.07],
    [760, 0.06],
  ] as const) {
    ctx.strokeStyle = `rgba(217, 178, 111, ${a})`;
    ctx.beginPath();
    ctx.arc(CX, PODIUM_BASE, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Champagnebubblor: större längs kanterna (så de aldrig hamnar bakom text),
  // små ljusprickar över hela ytan.
  for (let i = 0; i < 24; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = CX + side * (365 + rand() * 105);
    const y = i < 18 ? 270 + rand() * 620 : 1700 + rand() * 130;
    const r = 4.5 + Math.pow(rand(), 1.8) * 7;
    bubble(ctx, x, y, r, 0.25 + rand() * 0.4);
  }
  for (let i = 0; i < 60; i++) {
    const x = 80 + rand() * (W - 160);
    const y = 260 + Math.pow(rand(), 0.6) * (H - 380);
    bubble(ctx, x, y, 1.5 + rand() * 2.5, 0.15 + rand() * 0.4);
  }
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function bubble(ctx: Ctx, x: number, y: number, r: number, alpha: number) {
  if (r < 4.5) {
    // Små bubblor: en mjuk ljuspunkt
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, 248, 225, ${alpha})`);
    g.addColorStop(0.55, `rgba(243, 220, 165, ${alpha * 0.45})`);
    g.addColorStop(1, 'rgba(217, 178, 111, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Större bubblor: genomskinliga med ljus kant och glans
  const body = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
  body.addColorStop(0, 'rgba(243, 220, 165, 0)');
  body.addColorStop(1, `rgba(243, 220, 165, ${alpha * 0.32})`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(250, 236, 200, ${alpha * 0.55})`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = `rgba(255, 250, 235, ${Math.min(1, alpha * 1.4)})`;
  ctx.beginPath();
  ctx.arc(x - r * 0.38, y - r * 0.38, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawFrame(ctx: Ctx) {
  const outer = 40;
  const inner = 54;
  const notch = 34;

  ctx.save();
  // Yttre linje
  ctx.strokeStyle = 'rgba(217, 178, 111, 0.62)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(outer, outer, W - outer * 2, H - outer * 2);

  // Inre linje med inåtsvängda hörn
  ctx.strokeStyle = 'rgba(217, 178, 111, 0.36)';
  ctx.lineWidth = 1.4;
  const l = inner;
  const r = W - inner;
  const t = inner;
  const b = H - inner;
  ctx.beginPath();
  ctx.moveTo(l + notch, t);
  ctx.lineTo(r - notch, t);
  ctx.arc(r, t, notch, Math.PI, Math.PI / 2, true);
  ctx.lineTo(r, b - notch);
  ctx.arc(r, b, notch, -Math.PI / 2, Math.PI, true);
  ctx.lineTo(l + notch, b);
  ctx.arc(l, b, notch, 0, -Math.PI / 2, true);
  ctx.lineTo(l, t + notch);
  ctx.arc(l, t, notch, Math.PI / 2, 0, true);
  ctx.closePath();
  ctx.stroke();

  // Hörnornament: solfjäder + romb
  const corners: [number, number, number, number][] = [
    [l, t, 1, 1],
    [r, t, -1, 1],
    [l, b, 1, -1],
    [r, b, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    const start = sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI;
    ctx.strokeStyle = 'rgba(217, 178, 111, 0.55)';
    ctx.lineWidth = 1.2;
    for (const rad of [12, 20]) {
      ctx.beginPath();
      ctx.arc(x, y, rad, start, start + Math.PI / 2);
      ctx.stroke();
    }
    // Strålar i solfjädern
    for (let k = 1; k < 4; k++) {
      const a = start + (k * Math.PI) / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20);
      ctx.lineTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30);
      ctx.stroke();
    }
    diamond(ctx, x + sx * (notch + 22), y + sy * (notch + 22), 7, COLOR.gold, 0.9);
    // Korta linjer längs kanterna
    ctx.strokeStyle = 'rgba(217, 178, 111, 0.5)';
    ctx.beginPath();
    ctx.moveTo(x + sx * (notch + 34), y + sy * (notch + 22));
    ctx.lineTo(x + sx * (notch + 110), y + sy * (notch + 22));
    ctx.moveTo(x + sx * (notch + 22), y + sy * (notch + 34));
    ctx.lineTo(x + sx * (notch + 22), y + sy * (notch + 110));
    ctx.stroke();
  }

  // Små romber mitt på långsidorna
  diamond(ctx, l, H / 2, 6, COLOR.gold, 0.7);
  diamond(ctx, r, H / 2, 6, COLOR.gold, 0.7);
  ctx.restore();
}

function diamond(ctx: Ctx, x: number, y: number, s: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Guldig avdelare: linje – romb – linje. */
function ornament(ctx: Ctx, cx: number, y: number, halfWidth: number) {
  ctx.save();
  const left = ctx.createLinearGradient(cx - halfWidth, y, cx - 26, y);
  left.addColorStop(0, 'rgba(217, 178, 111, 0)');
  left.addColorStop(1, 'rgba(217, 178, 111, 0.85)');
  const right = ctx.createLinearGradient(cx + 26, y, cx + halfWidth, y);
  right.addColorStop(0, 'rgba(217, 178, 111, 0.85)');
  right.addColorStop(1, 'rgba(217, 178, 111, 0)');
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = left;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, y);
  ctx.lineTo(cx - 26, y);
  ctx.stroke();
  ctx.strokeStyle = right;
  ctx.beginPath();
  ctx.moveTo(cx + 26, y);
  ctx.lineTo(cx + halfWidth, y);
  ctx.stroke();
  // Romb med inre romb
  ctx.strokeStyle = COLOR.gold;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx, y - 12);
  ctx.lineTo(cx + 12, y);
  ctx.lineTo(cx, y + 12);
  ctx.lineTo(cx - 12, y);
  ctx.closePath();
  ctx.stroke();
  diamond(ctx, cx, y, 5, COLOR.gold);
  diamond(ctx, cx - 20, y, 2.5, COLOR.gold);
  diamond(ctx, cx + 20, y, 2.5, COLOR.gold);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Rubrik                                                              */
/* ------------------------------------------------------------------ */

function drawHeader(ctx: Ctx, date: string, subtitle: string | null) {
  ctx.textAlign = 'center';

  // Liten överrubrik. Har kvällen ett eget namn flyttar datumet hit upp och namnet
  // tar datumets plats under logotypen.
  font(ctx, 23, FONT.deco, 600);
  ctx.fillStyle = 'rgba(217, 178, 111, 0.85)';
  drawSpaced(ctx, subtitle && date ? date.toUpperCase() : 'UNE SOIRÉE DE COCKTAILS', CX, 240, 7);

  // "Bonjour" i guldskrift
  const bonjourY = 402;
  font(ctx, 180, FONT.script, 400);
  const m = ctx.measureText('Bonjour');
  const top = bonjourY - (m.actualBoundingBoxAscent || 150);
  const bottom = bonjourY + (m.actualBoundingBoxDescent || 40);
  ctx.save();
  ctx.shadowColor = 'rgba(217, 178, 111, 0.38)';
  ctx.shadowBlur = 36;
  ctx.fillStyle = goldTextGradient(ctx, top, bottom);
  ctx.fillText('Bonjour', CX, bonjourY);
  ctx.restore();

  // "BABES"
  font(ctx, 44, FONT.deco, 600);
  ctx.fillStyle = COLOR.text;
  drawSpaced(ctx, 'BABES', CX, 520, 25);

  ornament(ctx, CX, 566, 250);

  font(ctx, 34, FONT.display, 400, 'italic');
  ctx.fillStyle = COLOR.muted;
  const line = subtitle ?? date;
  if (line) ctx.fillText(ellipsize(ctx, line, 860), CX, 616);
}

/* ------------------------------------------------------------------ */
/*  Prispallen                                                          */
/* ------------------------------------------------------------------ */

interface Column {
  drink: DrinkResult;
  rank: 1 | 2 | 3;
  cx: number;
  width: number;
}

const PEDESTAL: Record<1 | 2 | 3, number> = { 1: 228, 2: 172, 3: 132 };

function drawPodium(ctx: Ctx, podium: DrinkResult[]) {
  // Titel
  const titleY = podium.length ? 712 : 880;
  drawPodiumTitle(ctx, titleY);

  if (podium.length === 0) {
    font(ctx, 40, FONT.display, 400, 'italic');
    ctx.fillStyle = COLOR.muted;
    ctx.textAlign = 'center';
    ctx.fillText('Inga drinkar den här gången', CX, 1100);
    return;
  }

  // Ordning på scenen: 2 – 1 – 3
  const slots = [1, 0, 2].filter((i) => i < podium.length);
  const width = 292;
  const gap = 28;
  const total = slots.length * width + (slots.length - 1) * gap;
  const startX = CX - total / 2 + width / 2;
  const columns: Column[] = slots.map((pos, i) => ({
    drink: podium[pos],
    rank: Math.min(3, Math.max(1, podium[pos].rank)) as 1 | 2 | 3,
    cx: startX + i * (width + gap),
    width,
  }));

  // Scengolv
  ctx.save();
  const floor = ctx.createLinearGradient(80, 0, W - 80, 0);
  floor.addColorStop(0, 'rgba(217, 178, 111, 0)');
  floor.addColorStop(0.5, 'rgba(243, 220, 165, 0.9)');
  floor.addColorStop(1, 'rgba(217, 178, 111, 0)');
  ctx.fillStyle = floor;
  ctx.fillRect(80, PODIUM_BASE, W - 160, 2);
  ctx.restore();
  // Reflex under golvet
  ctx.save();
  ctx.translate(CX, PODIUM_BASE + 6);
  ctx.scale(1, 0.14);
  glow(ctx, 0, 0, 520, 'rgba(243, 220, 165, 0.28)');
  ctx.restore();

  for (const col of columns) drawColumn(ctx, col);
}

function drawPodiumTitle(ctx: Ctx, y: number) {
  ctx.textAlign = 'center';
  font(ctx, 80, FONT.display, 700, 'italic');
  const label = 'Le Podium';
  const w = ctx.measureText(label).width;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = COLOR.champagne;
  ctx.fillText(label, CX, y);
  ctx.restore();

  // Linjer på båda sidor
  const lineY = y - 24;
  ctx.save();
  ctx.lineWidth = 1.5;
  const l = ctx.createLinearGradient(CX - w / 2 - 170, 0, CX - w / 2 - 30, 0);
  l.addColorStop(0, 'rgba(217, 178, 111, 0)');
  l.addColorStop(1, 'rgba(217, 178, 111, 0.8)');
  ctx.strokeStyle = l;
  ctx.beginPath();
  ctx.moveTo(CX - w / 2 - 170, lineY);
  ctx.lineTo(CX - w / 2 - 30, lineY);
  ctx.stroke();
  const r = ctx.createLinearGradient(CX + w / 2 + 30, 0, CX + w / 2 + 170, 0);
  r.addColorStop(0, 'rgba(217, 178, 111, 0.8)');
  r.addColorStop(1, 'rgba(217, 178, 111, 0)');
  ctx.strokeStyle = r;
  ctx.beginPath();
  ctx.moveTo(CX + w / 2 + 30, lineY);
  ctx.lineTo(CX + w / 2 + 170, lineY);
  ctx.stroke();
  diamond(ctx, CX - w / 2 - 30, lineY, 4, COLOR.gold);
  diamond(ctx, CX + w / 2 + 30, lineY, 4, COLOR.gold);
  ctx.restore();
}

function drawColumn(ctx: Ctx, col: Column) {
  const { drink, rank, cx, width } = col;
  const medalColors = MEDALS[rank];
  const pedestalH = PEDESTAL[rank];
  const pedestalTop = PODIUM_BASE - pedestalH;
  const winner = rank === 1;
  const textWidth = width - 8;

  // Drinknamn (max två rader), underifrån och upp
  ctx.textAlign = 'center';
  font(ctx, winner ? 31 : 28, FONT.display, 400, 'italic');
  const drinkLines = wrapLines(ctx, `”${drink.drink}”`, textWidth, 2);
  const drinkLineH = winner ? 38 : 35;
  const drinkBottom = pedestalTop - 28;
  ctx.fillStyle = COLOR.muted;
  drinkLines.forEach((line, i) => {
    ctx.fillText(line, cx, drinkBottom - (drinkLines.length - 1 - i) * drinkLineH);
  });
  const drinkTop = drinkBottom - (drinkLines.length - 1) * drinkLineH - (winner ? 31 : 28);

  // Namn
  const nameSize = fitFont(ctx, drink.name, textWidth, winner ? 50 : 42, 28, FONT.display, 700);
  font(ctx, nameSize, FONT.display, 700);
  const nameY = drinkTop - 12;
  const name = ellipsize(ctx, drink.name, textWidth);
  if (winner) {
    const m = ctx.measureText(name);
    ctx.fillStyle = goldTextGradient(ctx, nameY - (m.actualBoundingBoxAscent || nameSize * 0.75), nameY + 6);
  } else {
    ctx.fillStyle = COLOR.text;
  }
  ctx.fillText(name, cx, nameY);

  // Avatar
  const r = winner ? 78 : 62;
  const cy = nameY - nameSize * 0.78 - 24 - r;
  if (winner) {
    glow(ctx, cx, cy, r * 2.6, 'rgba(243, 220, 165, 0.22)');
    sparkle(ctx, cx - r - 34, cy - r * 0.55, 15, 0.9);
    sparkle(ctx, cx + r + 30, cy - r * 0.15, 11, 0.75);
    sparkle(ctx, cx + r + 4, cy - r - 18, 8, 0.6);
    sparkle(ctx, cx - r - 6, cy + r * 0.55, 7, 0.5);
  }
  drawAvatar(ctx, cx, cy, r, drink.emoji, drink.color, medalColors, rank);
  if (winner) drawCrown(ctx, cx, cy - r - 17);

  // Piedestal
  drawPedestal(ctx, cx, pedestalTop, width, pedestalH, medalColors, rank, drink.score);
}

function drawAvatar(ctx: Ctx, cx: number, cy: number, r: number, emoji: string, color: string, medalColors: [string, string, string], rank: number) {
  // Medaljring med glöd
  ctx.save();
  ctx.shadowColor = hexToRgba(medalColors[1], 0.55);
  ctx.shadowBlur = 44;
  ctx.fillStyle = medalGradient(ctx, cx - r, cy - r, cx + r, cy + r, medalColors);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Mörk spalt mellan ring och avatar
  ctx.fillStyle = COLOR.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.fill();

  // Själva avataren (samma ljussättning som <Avatar>)
  const base = parseHex(color) ?? parseHex('#6e1430')!;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.05, cx, cy, r * 1.05);
  g.addColorStop(0, rgbToCss(mix(base, [255, 255, 255], 0.22)));
  g.addColorStop(0.62, rgbToCss(base));
  g.addColorStop(1, rgbToCss(mix(base, [0, 0, 0], 0.45)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 244, 222, 0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Emoji
  drawEmoji(ctx, emoji, cx, cy, r * 1.02);

  // Placeringsbricka
  const br = r * 0.34;
  const bx = cx + Math.cos(Math.PI / 4) * (r + 4);
  const by = cy + Math.sin(Math.PI / 4) * (r + 4);
  ctx.fillStyle = COLOR.ink;
  ctx.beginPath();
  ctx.arc(bx, by, br + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = medalGradient(ctx, bx - br, by - br, bx + br, by + br, medalColors);
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1208';
  ctx.textAlign = 'center';
  font(ctx, br * 1.25, FONT.display, 800);
  const m = ctx.measureText(String(rank));
  const asc = m.actualBoundingBoxAscent || br * 0.9;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.fillText(String(rank), bx, by + (asc - desc) / 2);
}

function drawEmoji(ctx: Ctx, emoji: string, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  font(ctx, size, FONT.emoji);
  const m = ctx.measureText(emoji);
  const asc = m.actualBoundingBoxAscent || size * 0.8;
  const desc = m.actualBoundingBoxDescent || size * 0.2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillText(emoji, cx, cy + (asc - desc) / 2);
  ctx.restore();
}

function drawCrown(ctx: Ctx, cx: number, baseY: number) {
  const w = 84;
  const h = 48;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.shadowColor = 'rgba(243, 220, 165, 0.5)';
  ctx.shadowBlur = 24;
  const g = ctx.createLinearGradient(0, -h, 0, 12);
  g.addColorStop(0, '#fff3c8');
  g.addColorStop(0.5, '#e9c46a');
  g.addColorStop(1, '#9a7023');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 6, 0);
  ctx.lineTo(-w / 2, -h + 14);
  ctx.lineTo(-w / 4, -h / 2 + 4);
  ctx.lineTo(0, -h);
  ctx.lineTo(w / 4, -h / 2 + 4);
  ctx.lineTo(w / 2, -h + 14);
  ctx.lineTo(w / 2 - 6, 0);
  ctx.closePath();
  ctx.fill();
  // Band
  ctx.fillRect(-w / 2 + 6, 3, w - 12, 8);
  ctx.shadowBlur = 0;
  // Pärlor på spetsarna
  ctx.fillStyle = '#fff6da';
  for (const [x, y, rr] of [
    [-w / 2, -h + 14, 5],
    [0, -h, 6],
    [w / 2, -h + 14, 5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ädelsten
  ctx.fillStyle = '#9b2747';
  ctx.beginPath();
  ctx.moveTo(0, -21);
  ctx.lineTo(7, -12);
  ctx.lineTo(0, -3);
  ctx.lineTo(-7, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function sparkle(ctx: Ctx, x: number, y: number, r: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLOR.goldLight;
  ctx.shadowColor = 'rgba(243, 220, 165, 0.8)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  ctx.restore();
}

function drawPedestal(
  ctx: Ctx,
  cx: number,
  top: number,
  width: number,
  height: number,
  medalColors: [string, string, string],
  rank: number,
  score: number | null,
) {
  const capH = 16;
  const capOver = 8;
  const x = cx - width / 2;
  const bodyTop = top + capH;
  const bodyH = PODIUM_BASE - bodyTop;

  // Kropp
  ctx.save();
  const body = ctx.createLinearGradient(0, bodyTop, 0, PODIUM_BASE);
  body.addColorStop(0, 'rgba(255, 244, 222, 0.13)');
  body.addColorStop(1, 'rgba(255, 244, 222, 0.03)');
  ctx.fillStyle = body;
  ctx.fillRect(x, bodyTop, width, bodyH);
  const tint = ctx.createLinearGradient(0, bodyTop, 0, PODIUM_BASE);
  tint.addColorStop(0, hexToRgba(medalColors[1], 0.2));
  tint.addColorStop(1, hexToRgba(medalColors[1], 0));
  ctx.fillStyle = tint;
  ctx.fillRect(x, bodyTop, width, bodyH);

  // Stor vattenstämpel-siffra
  ctx.beginPath();
  ctx.rect(x, bodyTop, width, bodyH);
  ctx.clip();
  ctx.textAlign = 'center';
  font(ctx, 230, FONT.display, 800);
  ctx.fillStyle = hexToRgba(medalColors[1], 0.1);
  ctx.fillText(String(rank), cx, PODIUM_BASE + 30);
  ctx.restore();

  // Kantlinjer
  ctx.save();
  const edge = ctx.createLinearGradient(0, bodyTop, 0, PODIUM_BASE);
  edge.addColorStop(0, hexToRgba(medalColors[1], 0.6));
  edge.addColorStop(1, hexToRgba(medalColors[1], 0.05));
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 0.75, bodyTop);
  ctx.lineTo(x + 0.75, PODIUM_BASE);
  ctx.moveTo(x + width - 0.75, bodyTop);
  ctx.lineTo(x + width - 0.75, PODIUM_BASE);
  ctx.stroke();
  // Art deco-linjer på fronten
  ctx.strokeStyle = hexToRgba(medalColors[1], 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 14, bodyTop + 10);
  ctx.lineTo(x + 14, PODIUM_BASE);
  ctx.moveTo(x + width - 14, bodyTop + 10);
  ctx.lineTo(x + width - 14, PODIUM_BASE);
  ctx.stroke();
  ctx.restore();

  // Lock (medaljfärgad platta)
  ctx.save();
  ctx.shadowColor = hexToRgba(medalColors[1], 0.45);
  ctx.shadowBlur = 22;
  ctx.fillStyle = medalGradient(ctx, x - capOver, top, x + width + capOver, top + capH, medalColors, true);
  ctx.fillRect(x - capOver, top, width + capOver * 2, capH);
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillRect(x - capOver, top, width + capOver * 2, 1.5);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x - capOver, top + capH - 2, width + capOver * 2, 2);

  // Poäng
  ctx.textAlign = 'center';
  const scoreSize = rank === 1 ? 66 : 52;
  const scoreY = bodyTop + (rank === 1 ? 80 : 64);
  font(ctx, scoreSize, FONT.display, 700);
  if (score === null) {
    ctx.fillStyle = COLOR.muted;
    ctx.fillText('–', cx, scoreY);
  } else {
    const m = ctx.measureText('8');
    ctx.fillStyle = medalGradient(ctx, cx, scoreY - (m.actualBoundingBoxAscent || scoreSize * 0.72), cx, scoreY + 4, medalColors, false, true);
    ctx.fillText(formatScore(score), cx, scoreY);
  }
  font(ctx, 18, FONT.deco, 600);
  ctx.fillStyle = 'rgba(244, 234, 214, 0.62)';
  drawSpaced(ctx, score === null ? 'INGA RÖSTER' : 'POÄNG', cx, scoreY + 34, 5);
}

/* ------------------------------------------------------------------ */
/*  Utmärkelser & sidfot                                                */
/* ------------------------------------------------------------------ */

function drawHighlights(ctx: Ctx, items: Highlight[]) {
  const lineH = 50;
  const padTop = 58;
  const padBottom = 24;
  const boxW = 900;
  const boxH = padTop + (items.length - 1) * lineH + padBottom + 10;
  const top = 1428;
  const left = CX - boxW / 2;

  // Panel
  ctx.save();
  roundRect(ctx, left, top, boxW, boxH, 22);
  const fill = ctx.createLinearGradient(0, top, 0, top + boxH);
  fill.addColorStop(0, 'rgba(10, 9, 16, 0.62)');
  fill.addColorStop(1, 'rgba(10, 9, 16, 0.38)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(217, 178, 111, 0.42)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Rubrik i ramen
  const legend = 'KVÄLLENS UTMÄRKELSER';
  font(ctx, 21, FONT.deco, 700);
  const legendW = measureSpaced(ctx, legend, 6);
  ctx.fillStyle = '#160c14';
  ctx.fillRect(CX - legendW / 2 - 22, top - 4, legendW + 44, 8);
  ctx.fillStyle = COLOR.gold;
  drawSpaced(ctx, legend, CX, top + 8, 6);
  diamond(ctx, CX - legendW / 2 - 14, top + 1, 3.5, COLOR.gold);
  diamond(ctx, CX + legendW / 2 + 14, top + 1, 3.5, COLOR.gold);

  // Rader: emoji · ETIKETT · värde
  const maxW = boxW - 70;
  items.forEach((item, i) => {
    const y = top + padTop + i * lineH;
    const label = item.label.toUpperCase();
    font(ctx, 30, FONT.emoji);
    const emojiW = ctx.measureText(item.emoji).width;
    font(ctx, 20, FONT.deco, 700);
    const labelW = measureSpaced(ctx, label, 3.5);
    font(ctx, 30, FONT.display, 400, 'italic');
    const gap1 = 14;
    const gap2 = 18;
    const valueMax = Math.max(120, maxW - emojiW - labelW - gap1 - gap2);
    const value = ellipsize(ctx, item.value, valueMax);
    const valueW = ctx.measureText(value).width;
    const total = emojiW + gap1 + labelW + gap2 + valueW;
    let x = CX - total / 2;

    ctx.textAlign = 'left';
    font(ctx, 30, FONT.emoji);
    ctx.fillText(item.emoji, x, y + 2);
    x += emojiW + gap1;

    font(ctx, 20, FONT.deco, 700);
    ctx.fillStyle = COLOR.gold;
    drawSpaced(ctx, label, x + labelW / 2, y - 2, 3.5);
    x += labelW + gap2;

    font(ctx, 30, FONT.display, 400, 'italic');
    ctx.fillStyle = COLOR.text;
    ctx.fillText(value, x, y);
  });
  ctx.textAlign = 'center';
}

function drawFooter(ctx: Ctx) {
  const y = 1770;
  font(ctx, 88, FONT.script, 400);
  const text = 'Santé !';
  const textW = ctx.measureText(text).width;
  font(ctx, 56, FONT.emoji);
  const emojiW = ctx.measureText('🥂').width;
  const gap = 18;
  const total = textW + gap + emojiW;
  const x = CX - total / 2;

  ctx.textAlign = 'left';
  font(ctx, 88, FONT.script, 400);
  const m = ctx.measureText(text);
  ctx.save();
  ctx.shadowColor = 'rgba(217, 178, 111, 0.35)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = goldTextGradient(ctx, y - (m.actualBoundingBoxAscent || 70), y + 12);
  ctx.fillText(text, x, y);
  ctx.restore();
  font(ctx, 56, FONT.emoji);
  ctx.fillText('🥂', x + textW + gap, y - 8);
  ctx.textAlign = 'center';
}

/* ------------------------------------------------------------------ */
/*  Texthjälpare                                                        */
/* ------------------------------------------------------------------ */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('sv', { granularity: 'grapheme' }) : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

function measureSpaced(ctx: Ctx, text: string, spacing: number): number {
  const chars = graphemes(text);
  return chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + spacing * Math.max(0, chars.length - 1);
}

/** Text med extra bokstavsavstånd, centrerad kring cx. */
function drawSpaced(ctx: Ctx, text: string, cx: number, y: number, spacing: number) {
  const chars = graphemes(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prev;
}

/** Kortar texten med "…" så att den får plats. */
function ellipsize(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = graphemes(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${chars.slice(0, mid).join('').trimEnd()}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** Största teckenstorlek (från max ned till min) där texten ryms. */
function fitFont(ctx: Ctx, text: string, maxWidth: number, max: number, min: number, family: string, weight: number) {
  for (let size = max; size > min; size -= 2) {
    font(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return min;
}

/** Radbryter text till högst maxLines rader; sista raden kortas med "…". */
function wrapLines(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    // Ord som är längre än en hel rad bryts på tecken.
    if (ctx.measureText(word).width > maxWidth) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let chunk = '';
      for (const ch of graphemes(word)) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
      return;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  };
  words.forEach(pushWord);
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(ctx, `${lines.slice(maxLines - 1).join(' ')}`, maxWidth);
  return kept;
}

/* ------------------------------------------------------------------ */
/*  Färg & form                                                         */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

function rgbToCss([r, g, b]: RGB, alpha = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgba(hex: string, alpha: number): string {
  return rgbToCss(parseHex(hex) ?? [217, 178, 111], alpha);
}

function goldTextGradient(ctx: Ctx, top: number, bottom: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#fbefcb');
  g.addColorStop(0.45, '#e8c77f');
  g.addColorStop(1, '#b88a40');
  return g;
}

function medalGradient(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  [light, mid, dark]: [string, string, string],
  horizontal = false,
  vertical = false,
): CanvasGradient {
  const g = horizontal
    ? ctx.createLinearGradient(x0, 0, x1, 0)
    : vertical
      ? ctx.createLinearGradient(0, y0, 0, y1)
      : ctx.createLinearGradient(x0, y0, x1, y1);
  if (horizontal) {
    g.addColorStop(0, dark);
    g.addColorStop(0.3, mid);
    g.addColorStop(0.5, light);
    g.addColorStop(0.7, mid);
    g.addColorStop(1, dark);
  } else {
    g.addColorStop(0, light);
    g.addColorStop(0.5, mid);
    g.addColorStop(1, dark);
  }
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/*  Övrigt                                                              */
/* ------------------------------------------------------------------ */

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Kunde inte skapa bilden'))), 'image/png');
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
