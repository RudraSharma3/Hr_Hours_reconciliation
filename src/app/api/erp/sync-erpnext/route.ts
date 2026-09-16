import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { importFromErpNext } from '@/lib/erpImportService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const month = body.month;

    if (!month || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'Please provide a valid month in YYYY-MM format (e.g. 2026-09)' },
        { status: 400 }
      );
    }

    const result = await importFromErpNext(month);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to sync with ERPNext' },
      { status: 500 }
    );
  }
}
