/**
 * Reconciliation status values.
 *
 * These live here as a plain TypeScript union — not as a Prisma `enum` —
 * because the `status` column is a plain SQLite `String` (SQLite has no
 * native enum type, and Prisma's SQLite connector doesn't support
 * Prisma-level enums either). Keep this list in sync with the comment
 * above `status` in `prisma/schema.prisma`.
 *
 * If you migrate to Postgres/MySQL (see README "Moving to Postgres"), you
 * can reintroduce a real Prisma `enum ReconciliationStatus` there; this
 * file's values already match what a generated enum would produce, so
 * application code wouldn't need to change.
 */
export const RECONCILIATION_STATUSES = [
  'AWAITING_RESPONSE',
  'MATCHED',
  'FLAGGED',
  'CORRECTION_REQUESTED',
  'RESOLVED',
  'ESCALATED',
] as const;

export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export function isReconciliationStatus(value: string): value is ReconciliationStatus {
  return (RECONCILIATION_STATUSES as readonly string[]).includes(value);
}
