import crypto from 'crypto';
import { prisma } from './prisma';

/**
 * Secure, single-use, expiring confirmation links.
 *
 * The raw token is only ever shown to the employee (embedded in the emailed
 * link) and is never persisted — only its SHA-256 hash is stored. This means
 * a database leak alone cannot be used to forge or replay a confirmation
 * link. Each token is bound to exactly one reconciliation record, so an
 * employee link can never be used to view or alter someone else's record.
 */

const TTL_DAYS = Number(process.env.CONFIRMATION_TOKEN_TTL_DAYS ?? 14);

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createConfirmationToken(
  reconciliationRecordId: string,
  purpose: 'INITIAL' | 'CORRECTION' = 'INITIAL'
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.confirmationToken.create({
    data: {
      reconciliationRecordId,
      tokenHash,
      purpose,
      expiresAt,
    },
  });

  return { rawToken, expiresAt };
}

export type TokenLookupResult =
  | { valid: true; recordId: string; tokenId: string }
  | { valid: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_USED' };

export async function lookupConfirmationToken(rawToken: string): Promise<TokenLookupResult> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.confirmationToken.findUnique({ where: { tokenHash } });

  if (!token) return { valid: false, reason: 'NOT_FOUND' };
  if (token.usedAt) return { valid: false, reason: 'ALREADY_USED' };
  if (token.expiresAt.getTime() < Date.now()) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, recordId: token.reconciliationRecordId, tokenId: token.id };
}

export async function markTokenUsed(tokenId: string): Promise<void> {
  await prisma.confirmationToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}

export function buildConfirmationLink(rawToken: string): string {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return `${base}/confirm/${rawToken}`;
}
