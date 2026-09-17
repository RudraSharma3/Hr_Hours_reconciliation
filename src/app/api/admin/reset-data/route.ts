import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = Boolean(cronSecret && (authHeader === `Bearer ${cronSecret}` || req.headers.get('x-cron-secret') === cronSecret));

  if (!admin && !isCronAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('mode');

  try {
    if (mode === 'reopen' || mode === 'revert') {
      // Reset all reconciliation records back to clean AWAITING_RESPONSE state
      const count = await prisma.reconciliationRecord.updateMany({
        data: {
          status: 'AWAITING_RESPONSE',
          employeeConfirmedHours: null,
          difference: null,
          result: null,
          finalisedAt: null,
          employeeExplanation: null,
        },
      });

      return NextResponse.json({
        ok: true,
        message: `Successfully reset ${count.count} reconciliation records back to AWAITING_RESPONSE (clean state).`,
      });
    }

    // Default: Clean all transaction/timesheet data in foreign key order
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
