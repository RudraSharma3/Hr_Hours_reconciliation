import { SignJWT, jwtVerify } from 'jose';

// Uses `jose` (not `jsonwebtoken`) because this module is imported both from
// Node server code and from `src/middleware.ts`, which runs on the Next.js
// Edge Runtime — `jsonwebtoken` depends on Node's `crypto` module and does
// not work there.

export type AdminSessionPayload = {
  adminId: string;
  email: string;
};

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.adminId === 'string' && typeof payload.email === 'string') {
      return { adminId: payload.adminId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}

export const SESSION_TTL = SESSION_TTL_SECONDS;
