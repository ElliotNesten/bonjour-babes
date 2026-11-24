import { describe, expect, it } from 'vitest';
import { formatDate, formatScore, medal, placeLabel } from '../../src/lib/format';

describe('placeLabel', () => {
  it('ger svenska ordningstal', () => {
    const cases: [number, string][] = [
      [1, '1:a'],
      [2, '2:a'],
      [3, '3:e'],
      [4, '4:e'],
      [10, '10:e'],
      [11, '11:e'],
      [12, '12:e'],
      [13, '13:e'],
      [21, '21:a'],
      [22, '22:a'],
      [23, '23:e'],
      [101, '101:a'],
      [102, '102:a'],
      [111, '111:e'],
      [112, '112:e'],
      [121, '121:a'],
    ];
    for (const [rank, label] of cases) expect(placeLabel(rank)).toBe(label);
  });
});

describe('formatScore', () => {
  it('använder decimalkomma (sv-SE) och en decimal', () => {
    expect(formatScore(87.4)).toBe('87,4');
    expect(formatScore(100)).toBe('100,0');
    expect(formatScore(10)).toBe('10,0');
    expect(formatScore(58.8)).toBe('58,8');
    expect(formatScore(72.22222)).toBe('72,2');
    expect(formatScore(66.66666)).toBe('66,7');
  });

  it('kan visa annat antal decimaler', () => {
    expect(formatScore(87.6, 0)).toBe('88');
    expect(formatScore(7.25, 2)).toBe('7,25');
  });

  it('visar "–" för saknade värden', () => {
    expect(formatScore(null)).toBe('–');
    expect(formatScore(undefined)).toBe('–');
    expect(formatScore(Number.NaN)).toBe('–');
  });
});

describe('medal', () => {
  it('ger medalj för pallplatserna', () => {
    expect([1, 2, 3, 4].map(medal)).toEqual(['🥇', '🥈', '🥉', '']);
  });
});

describe('formatDate', () => {
  it('är tom utan tidpunkt och svensk annars', () => {
    expect(formatDate(0)).toBe('');
    expect(formatDate(Date.UTC(2026, 10, 24, 12))).toBe('24 november 2026');
  });
});
