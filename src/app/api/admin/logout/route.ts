import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
