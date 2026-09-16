import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lookupConfirmationToken, markTokenUsed } from '@/lib/tokens';
import { submitEmployeeConfirmation } from '@/lib/reconciliationService';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET: resolve a token to the (limited) reconciliation details needed to
// render the confirmation form. Never exposes other employees' data — the
// token is bound 1:1 to a single reconciliation record.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const lookup = await lookupConfirmationToken(params.token);

  if (!lookup.valid) {
    return NextResponse.json({ error: lookup.reason }, { status: 410 });
  }

  const record = await prisma.reconciliationRecord.findUnique({
    where: { id: lookup.recordId },
    include: { employee: true, project: true },
  });

  if (!record) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({
    record: {
      id: record.id,
      employeeName: record.employee.name,
      projectName: record.project.name,
      month: record.month,
      erpHours: record.erpHours,
      status: record.status,
      previousConfirmedHours: record.employeeConfirmedHours,
      previousDifference: record.difference,
      isCorrection: record.status === 'CORRECTION_REQUESTED' || record.status === 'FLAGGED',
    },
  });
}

const schema = z.object({
  confirmedHours: z.number().min(0).max(1000),
  explanation: z.string().max(2000).optional(),
});

// POST: employee submits their confirmed hours. Token is single-use — it's
// marked used immediately so it cannot be replayed to alter the same record
// twice, and a fresh token/link is issued automatically if a follow-up
// (mismatch correction) round is needed.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const lookup = await lookupConfirmationToken(params.token);
  if (!lookup.valid) {
    return NextResponse.json({ error: lookup.reason }, { status: 410 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid number of hours (0-1000).' }, { status: 400 });
  }

  const record = await prisma.reconciliationRecord.findUnique({ where: { id: lookup.recordId } });
  if (!record) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await markTokenUsed(lookup.tokenId);

  await submitEmployeeConfirmation({
    recordId: lookup.recordId,
    confirmedHours: parsed.data.confirmedHours,
    explanation: parsed.data.explanation,
    isCorrection: record.status === 'CORRECTION_REQUESTED' || record.status === 'FLAGGED',
  });

  const updated = await prisma.reconciliationRecord.findUnique({ where: { id: lookup.recordId } });

  return NextResponse.json({
    ok: true,
    status: updated?.status,
    result: updated?.result,
    difference: updated?.difference,
  });
}
