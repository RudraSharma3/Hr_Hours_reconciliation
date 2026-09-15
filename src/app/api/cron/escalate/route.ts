import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cronAuth';
import { escalateUnresolved } from '@/lib/reconciliationService';

/** Step 10: run this daily, after send-reminders (see README "Scheduling jobs"). */
export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await escalateUnresolved();
  return NextResponse.json(result);
}
