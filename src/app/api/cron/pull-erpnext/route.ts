import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { importFromErpNext } from '@/lib/erpImportService';

export const dynamic = 'force-dynamic';

/**
 * Company-wide ERPNext pull for a given month — a full resync, useful at
 * month-end even if the per-employee webhook (src/app/api/erp/webhook/erpnext)
 * is also configured for real-time updates during the month. Requires
 * ERP_MODE=erpnext (see .env.example and README "Connecting ERPNext").
 *
 * ?month=YYYY-MM required.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get('month');
  if (!month) {
    return NextResponse.json({ error: 'month query param (YYYY-MM) is required' }, { status: 400 });
  }

  try {
    const result = await importFromErpNext(month);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 });
  }
}
