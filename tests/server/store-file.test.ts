/**
 * Fillagret (server/store-file.ts) – används lokalt utan Postgres (.data/dev-db.json) och i testerna.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFileStore } from '../../server/store-file';
import { memoryBackend } from './helpers';
import { getDoc, put, storeContract } from './storeContract';

storeContract(memoryBackend());

describe('fillagret på disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-store-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sparar till filen och läser in den igen, med revs och gravstenar', async () => {
    const file = join(dir, 'sub', 'dev-db.json');
    const a = createFileStore({ file });
    const r1 = await put(a, { 'games/a': { n: 1 }, 'games/b': { n: 2 } });
    const r2 = await put(a, { 'games/b': null });
    await a.close();
    expect(existsSync(file)).toBe(true);

    const b = createFileStore({ file });
    expect(await getDoc(b, 'games/a')).toEqual({ data: { n: 1 }, rev: r1 });
    expect(await getDoc(b, 'games/b')).toEqual({ data: null, rev: r2 });
    // Räknaren fortsätter efter den sparade
    expect(await put(b, { 'games/c': 1 })).toBe(r2! + 1);
  });

  it('en trasig fil sparas undan och lagret börjar om tomt', async () => {
    const file = join(dir, 'trasig.json');
    writeFileSync(file, '{ inte json');
    const store = createFileStore({ file });
    expect(await getDoc(store, 'games/a')).toEqual({ data: null, rev: 0 });
    expect(readdirSync(dir).some((f) => f.startsWith('trasig.json.trasig-'))).toBe(true);
  });
});
