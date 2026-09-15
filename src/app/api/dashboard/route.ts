import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [total, matched, flagged, awaiting, resolved, escalated, correctionRequested] = await Promise.all([
    prisma.reconciliationRecord.count(),
    prisma.reconciliationRecord.count({ where: { status: 'MATCHED' } }),
    prisma.reconciliationRecord.count({ where: { status: 'FLAGGED' } }),
    prisma.reconciliationRecord.count({ where: { status: 'AWAITING_RESPONSE' } }),
    prisma.reconciliationRecord.count({ where: { status: 'RESOLVED' } }),
    prisma.reconciliationRecord.count({ where: { status: 'ESCALATED' } }),
    prisma.reconciliationRecord.count({ where: { status: 'CORRECTION_REQUESTED' } }),
  ]);

  return NextResponse.json({
    totalRequests: total,
    matched,
    flagged: flagged + correctionRequested,
    awaitingResponse: awaiting,
    resolved,
    unresolvedEscalations: escalated,
  });
}
