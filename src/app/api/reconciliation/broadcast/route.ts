import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/admin';
import { broadcastPendingBotMessages } from '@/lib/reconciliationService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const month = body.month && typeof body.month === 'string' ? body.month : undefined;

    const result = await broadcastPendingBotMessages(month);
    return NextResponse.json({
      ok: true,
      sentCount: result.sentCount,
      totalPending: result.totalPending,
      message: `Successfully triggered ${result.sentCount} bot message card(s) to employees.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to broadcast bot messages' },
      { status: 500 }
    );
  }
}
