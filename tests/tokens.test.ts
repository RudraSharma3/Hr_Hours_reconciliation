import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createConfirmationToken, lookupConfirmationToken, markTokenUsed, hashToken } from '../src/lib/tokens';

// These tests exercise the token layer against a real (migrated) database —
// run `npx prisma migrate dev` before `npm test` the first time. See README
// "Running tests".

async function makeRecord() {
  const employee = await prisma.employee.create({
    data: {
      employeeCode: `EMP-TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Employee',
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    },
  });
  const project = await prisma.project.create({
    data: {
      projectCode: `PRJ-TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Project',
    },
  });
  return prisma.reconciliationRecord.create({
    data: {
      month: '2026-08',
      employeeId: employee.id,
      projectId: project.id,
      erpHours: 76,
      status: 'AWAITING_RESPONSE',
    },
  });
}

describe('confirmation tokens', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a freshly created token is valid and resolves to its own record', async () => {
    const record = await makeRecord();
    const { rawToken } = await createConfirmationToken(record.id, 'INITIAL');

    const lookup = await lookupConfirmationToken(rawToken);
    expect(lookup.valid).toBe(true);
    if (lookup.valid) {
      expect(lookup.recordId).toBe(record.id);
    }
  });

  it('never stores the raw token — only its hash', async () => {
    const record = await makeRecord();
    const { rawToken } = await createConfirmationToken(record.id, 'INITIAL');

    const stored = await prisma.confirmationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    expect(stored).not.toBeNull();
    // The raw token must never appear verbatim anywhere in the stored row.
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it('a token cannot be used to access a different record', async () => {
    const recordA = await makeRecord();
    const recordB = await makeRecord();
    const { rawToken } = await createConfirmationToken(recordA.id, 'INITIAL');

    const lookup = await lookupConfirmationToken(rawToken);
    expect(lookup.valid).toBe(true);
    if (lookup.valid) {
      expect(lookup.recordId).not.toBe(recordB.id);
      expect(lookup.recordId).toBe(recordA.id);
    }
  });

  it('a used token cannot be used again (single-use)', async () => {
    const record = await makeRecord();
    const { rawToken } = await createConfirmationToken(record.id, 'INITIAL');

    const first = await lookupConfirmationToken(rawToken);
    expect(first.valid).toBe(true);
    if (first.valid) {
      await markTokenUsed(first.tokenId);
    }

    const second = await lookupConfirmationToken(rawToken);
    expect(second.valid).toBe(false);
    if (!second.valid) {
      expect(second.reason).toBe('ALREADY_USED');
    }
  });

  it('an expired token is rejected', async () => {
    const record = await makeRecord();
    const rawToken = `test-raw-token-for-expiry-check-${Date.now()}-${Math.random()}`;
    await prisma.confirmationToken.create({
      data: {
        reconciliationRecordId: record.id,
        tokenHash: hashToken(rawToken),
        purpose: 'INITIAL',
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const lookup = await lookupConfirmationToken(rawToken);
    expect(lookup.valid).toBe(false);
    if (!lookup.valid) {
      expect(lookup.reason).toBe('EXPIRED');
    }
  });

  it('an unknown token is rejected', async () => {
    const lookup = await lookupConfirmationToken('this-token-was-never-issued');
    expect(lookup.valid).toBe(false);
    if (!lookup.valid) {
      expect(lookup.reason).toBe('NOT_FOUND');
    }
  });
});
