import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Clean all transaction/timesheet data in foreign key order
    await prisma.confirmationToken.deleteMany({});
    await prisma.auditEvent.deleteMany({});
    await prisma.messageLog.deleteMany({});
    await prisma.reconciliationRecord.deleteMany({});
    await prisma.erpTimesheetRow.deleteMany({});
    await prisma.erpImportBatch.deleteMany({});

    return NextResponse.json({
      ok: true,
      message: 'All reconciliation records, ERP rows, batches, and logs have been wiped successfully. Database is clean with 0 records.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reset database data' },
      { status: 500 }
    );
  }
}
