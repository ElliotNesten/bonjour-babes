/**
 * Trädfunktionerna (src/lib/backend/tree.ts) som demoläget och servern delar: RTDB-semantik.
 */
import { describe, expect, it } from 'vitest';
import { applyWrite, getAt, normalize, setAt, writesOf } from '../../src/lib/backend/tree';

describe('normalize', () => {
  it('ersätter servertid, tar bort null och tomma objekt', () => {
    expect(normalize({ a: { '.sv': 'timestamp' }, b: null, c: {}, d: { e: { f: null } }, g: 0, h: '', i: false }, 42)).toEqual({
      a: 42,
      g: 0,
      h: '',
      i: false,
    });
    expect(normalize({ a: null }, 1)).toBeNull();
    expect(normalize(undefined, 1)).toBeNull();
    expect(normalize({ '.sv': 'timestamp' }, 7)).toBe(7);
  });

  it('arrayer: luckor tas bort, sammanhängande index blir array igen, annars objekt', () => {
    expect(normalize([1, null, 3], 0)).toEqual({ 0: 1, 2: 3 });
    expect(normalize([1, 2, null], 0)).toEqual([1, 2]);
    expect(normalize([null, null], 0)).toBeNull();
    expect(normalize([{ at: { '.sv': 'timestamp' } }], 5)).toEqual([{ at: 5 }]);
  });

  it('en nyckel "__proto__" ändrar aldrig prototypen', () => {
    const out = normalize(JSON.parse('{"__proto__": {"x": 1}, "a": 1}'), 0) as object;
    expect(out).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('getAt / setAt', () => {
  const tree = { games: { g: { order: ['a', 'b'], meta: { name: 'X' } } } };

  it('läser sökvägar, genom arrayer, och bara egna nycklar', () => {
    expect(getAt(tree, 'games/g/meta/name')).toBe('X');
    expect(getAt(tree, 'games/g/order/1')).toBe('b');
    expect(getAt(tree, ['games', 'g', 'order', '01'])).toBeNull();
    expect(getAt(tree, 'games/g/constructor')).toBeNull();
    expect(getAt(tree, 'games/g/meta/name/length')).toBeNull();
    expect(getAt(tree, '')).toBe(tree);
  });

  it('skriver utan att ändra originalet; arrayer längs vägen blir objekt', () => {
    const next = setAt(tree, 'games/g/order/1', 'c');
    expect(tree.games.g.order).toEqual(['a', 'b']);
    expect(getAt(next, 'games/g/order')).toEqual({ 0: 'a', 1: 'c' });
    // (som RTDB: en array kan komma tillbaka som objekt – klienterna normaliserar vid läsning)
    expect(normalize(next, 0)).toMatchObject({ games: { g: { order: { 0: 'a', 1: 'c' } } } });
    expect(setAt(tree, 'games/g', null)).toEqual({ games: {} });
    expect(setAt(tree, '', { x: 1 })).toEqual({ x: 1 });
    expect(setAt({ a: 'text' }, 'a/b', 1)).toEqual({ a: { b: 1 } });
  });
});

describe('applyWrite / writesOf', () => {
  it('set, update (fler sökvägar, relativa) och remove', () => {
    const t0 = { games: { g: { meta: { name: 'A', status: 'lobby' } } } };
    expect(applyWrite(t0, { op: 'set', path: 'games/g/meta/name', value: 'B' })).toEqual({ games: { g: { meta: { name: 'B', status: 'lobby' } } } });
    const t1 = applyWrite(t0, { op: 'update', path: 'games/g', values: { 'meta/status': 'running', current: { phase: 'x' }, settings: undefined } });
    expect(t1).toEqual({ games: { g: { meta: { name: 'A', status: 'running' }, current: { phase: 'x' } } } });
    expect(normalize(applyWrite(t1, { op: 'remove', path: 'games/g/meta' }), 0)).toEqual({ games: { g: { current: { phase: 'x' } } } });
    expect(writesOf({ op: 'update', path: '', values: { 'a/b': 1, c: null } })).toEqual([
      { path: 'a/b', value: 1 },
      { path: 'c', value: null },
    ]);
  });
});
