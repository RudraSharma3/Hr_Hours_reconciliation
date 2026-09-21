import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from './lib/auth/jwt';

// Routes that require an authenticated admin session.
const PROTECTED_PAGE_PREFIXES = ['/dashboard', '/erp-import', '/reconciliation', '/settings'];
const PROTECTED_API_PREFIXES = [
  '/api/erp',
  '/api/reconciliation',
  '/api/settings',
  '/api/admin/me',
];

// Inbound webhooks are called by external systems (ERPNext, Google Chat), never by
// a logged-in admin browser session — they authenticate themselves via
// their own signature/token checks (see each route).
const UNPROTECTED_API_EXCEPTIONS = ['/api/erp/webhook', '/api/chat'];


const SESSION_COOKIE = 'admin_session';

function isProtected(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isProtected(pathname, UNPROTECTED_API_EXCEPTIONS)) return NextResponse.next();

  const needsAuth =
    isProtected(pathname, PROTECTED_PAGE_PREFIXES) || isProtected(pathname, PROTECTED_API_PREFIXES);

  if (!needsAuth) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (session) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/erp-import/:path*',
    '/reconciliation/:path*',
    '/settings/:path*',
    '/api/erp/:path*',
    '/api/reconciliation/:path*',
    '/api/settings/:path*',
    '/api/admin/me',
  ],
};

