import { NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth/admin';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ admin });
}
