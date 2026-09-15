import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { sendReminders } from '@/lib/reconciliationService';

/** Step 9: run this daily (see README "Scheduling jobs"). */
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendReminders();
  return NextResponse.json(result);
}
