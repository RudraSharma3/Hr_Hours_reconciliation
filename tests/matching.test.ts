import { describe, it, expect } from 'vitest';
import { computeMatch } from '../src/lib/matching';

describe('computeMatch (no-tolerance reconciliation rule)', () => {
  it('76 vs 76 -> exact match, result 1', () => {
    const result = computeMatch(76, 76);
    expect(result).toEqual({ difference: 0, result: 1, status: 'Matched' });
  });

  it('76 vs 75 -> one hour off, result 0 (no tolerance)', () => {
    const result = computeMatch(76, 75);
    expect(result.result).toBe(0);
    expect(result.status).toBe('Flagged');
    expect(result.difference).toBe(1);
  });

  it('60 vs 76 -> large mismatch, result 0', () => {
    const result = computeMatch(60, 76);
    expect(result.result).toBe(0);
    expect(result.status).toBe('Flagged');
    expect(result.difference).toBe(16);
  });

  it('is symmetric in which value is larger', () => {
    const a = computeMatch(76, 60);
    const b = computeMatch(60, 76);
    expect(a.difference).toBe(b.difference);
    expect(a.result).toBe(b.result);
  });

  it('treats a fractional difference as a mismatch too (no rounding)', () => {
    const result = computeMatch(76.5, 76);
    expect(result.result).toBe(0);
    expect(result.difference).toBe(0.5);
  });

  it('does not apply any tolerance band, however small the difference', () => {
    const result = computeMatch(76.01, 76);
    expect(result.result).toBe(0);
  });

  it('zero and zero is an exact match', () => {
    const result = computeMatch(0, 0);
    expect(result).toEqual({ difference: 0, result: 1, status: 'Matched' });
  });

  it('throws on non-finite input rather than silently coercing', () => {
    expect(() => computeMatch(NaN, 10)).toThrow();
    expect(() => computeMatch(10, Infinity)).toThrow();
  });
});
