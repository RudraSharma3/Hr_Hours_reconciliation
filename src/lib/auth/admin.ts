import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '../prisma';
import { signSession, verifySession, SESSION_TTL, type AdminSessionPayload } from './jwt';

const SESSION_COOKIE = 'admin_session';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export { signSession, verifySession };
export type { AdminSessionPayload };

/** Reads and verifies the admin session from the request cookies (server components/route handlers). */
export async function getCurrentAdmin(): Promise<AdminSessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL,
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export async function authenticateAdmin(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) return null;
  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) return null;
  return admin;
}
