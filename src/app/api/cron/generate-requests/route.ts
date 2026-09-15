import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { generateReconciliationRequests } from '@/lib/reconciliationService';

/**
 * Step 1+2+3+4: run this at the end of every month (see README "Scheduling
 * jobs" for how to wire this to real cron). Optional ?month=YYYY-MM to
 * restrict to a single month; otherwise processes all "current" ERP rows
 * that don't yet have a reconciliation record.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get('month') ?? undefined;
  const result = await generateReconciliationRequests(month);
  return NextResponse.json(result);
}
