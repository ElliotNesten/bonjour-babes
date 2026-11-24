import type { WriteRequest } from './protocol.js';
import { joinPath, splitPath, stripUndefined } from './types.js';

/**
 * Rena hjälpfunktioner för databasträdet, med samma semantik som Firebase Realtime Database.
 * Används både av demoläget (local.ts) och av servern (server/), så här får inte finnas några
 * webbläsar- eller Node-specifika API:er.
 *
 * OBS: relativa importer härifrån måste ha ".js"-ändelse – filen körs som ESM i Vercel Functions.
 */

export type Tree = Record<string, unknown>;

/** set/update/remove – samma form som skrivningar i HTTP-protokollet. */
export type WriteOp = WriteRequest;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Ersätter servertids-platshållare, tar bort null och tomma objekt (som RTDB). */
export function normalize(value: unknown, now: number): unknown {
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) {
    if (value['.sv'] === 'timestamp') return now;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalize(v, now);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    value.forEach((v, i) => {
      const n = normalize(v, now);
      if (n !== null) out[String(i)] = n;
    });
    if (!Object.keys(out).length) return null;
    // Läs tillbaka som array om nycklarna är 0..n-1 (som RTDB gör i de flesta fall).
    const keys = Object.keys(out);
    if (keys.every((k, i) => k === String(i))) return keys.map((k) => out[k]);
    return out;
  }
  return value;
}

/** Värdet på en sökväg i trädet, eller null. */
export function getAt(tree: unknown, path: string | readonly string[]): unknown {
  let node: unknown = tree;
  for (const seg of typeof path === 'string' ? splitPath(path) : path) {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) node = node[Number(seg)];
    else if (isPlainObject(node)) node = node[seg];
    else return null;
  }
  return node ?? null;
}

/**
 * Sätter (eller tar bort, om value är null) värdet på en sökväg. Muterar inte trädet: noderna längs
 * vägen kopieras och arrayer längs vägen blir objekt. Roten kan bara ersättas med ett objekt.
 */
export function setAt(tree: Tree, path: string | readonly string[], value: unknown): Tree {
  const segs = typeof path === 'string' ? splitPath(path) : path;
  if (!segs.length) return (isPlainObject(value) ? value : {}) as Tree;
  const root: Tree = { ...tree };
  let node: Record<string, unknown> = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = node[seg];
    let copy: Record<string, unknown>;
    if (Array.isArray(next)) copy = Object.fromEntries(next.map((v, idx) => [String(idx), v]));
    else if (isPlainObject(next)) copy = { ...next };
    else copy = {};
    node[seg] = copy;
    node = copy;
  }
  const last = segs[segs.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

/**
 * De enskilda skrivningarna (sökväg → värde, null = ta bort) som en set/update/remove består av.
 * update() är en fler-sökvägsuppdatering: nycklarna i values är sökvägar relativa till path.
 */
export function writesOf(op: WriteOp): { path: string; value: unknown }[] {
  switch (op.op) {
    case 'set':
      return [{ path: op.path, value: stripUndefined(op.value) ?? null }];
    case 'update':
      return Object.entries(stripUndefined(op.values)).map(([k, v]) => ({ path: joinPath(op.path, k), value: v ?? null }));
    case 'remove':
      return [{ path: op.path, value: null }];
  }
}

/**
 * Tillämpar en set/update/remove på trädet (utan att mutera det). Resultatet är inte normaliserat –
 * kör normalize(tree, now) efteråt för servertid, borttagning av tomma objekt och arrayer.
 */
export function applyWrite(tree: Tree, op: WriteOp): Tree {
  return writesOf(op).reduce((t, w) => setAt(t, w.path, w.value), tree);
}
