/**
 * Core reconciliation matching rule.
 *
 * This is intentionally the smallest, purest piece of the whole system
 * because it is the piece that must never drift: there is NO tolerance
 * band. Any non-zero difference — even a single hour — is a Flagged (0)
 * result. Only an exact match produces Matched (1).
 *
 * Do not add rounding, epsilon comparisons, or a ±N tolerance here. If a
 * future business requirement introduces tolerance, it must be an explicit,
 * separately-reviewed change to this function (and its tests), not a
 * silent adjustment.
 */

export type MatchResult = {
  difference: number;
  result: 0 | 1;
  status: 'Matched' | 'Flagged';
};

export function computeMatch(employeeConfirmedHours: number, erpHours: number): MatchResult {
  if (!Number.isFinite(employeeConfirmedHours) || !Number.isFinite(erpHours)) {
    throw new Error('computeMatch requires finite numeric hours');
  }

  const difference = Math.abs(employeeConfirmedHours - erpHours);

  if (difference === 0) {
    return { difference: 0, result: 1, status: 'Matched' };
  }

  return { difference, result: 0, status: 'Flagged' };
}
