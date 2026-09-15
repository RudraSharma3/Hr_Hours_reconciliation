import { NextRequest } from 'next/server';

/**
 * Scheduled-job endpoints (/api/cron/*) are not admin pages — they're meant
 * to be called by a scheduler (cron, GitHub Actions, Vercel Cron, etc.), not
 * a logged-in browser session. They're protected instead by a shared secret
 * passed as `Authorization: Bearer <CRON_SECRET>` (or `?secret=` for
 * schedulers that can't set headers).
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get('authorization');
  if (header === `Bearer ${expected}`) return true;

  const querySecret = req.nextUrl.searchParams.get('secret');
  return querySecret === expected;
}
