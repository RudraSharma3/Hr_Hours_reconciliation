import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { generateReconciliationRequests } from '@/lib/reconciliationService';

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const month = body.month && /^\d{4}-\d{2}$/.test(body.month) ? body.month : undefined;

    const result = await generateReconciliationRequests(month);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate requests' },
      { status: 500 }
    );
  }
}
