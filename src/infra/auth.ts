import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type AuthClaims = { sub: string; tenantId: string; role: string; permissions: string[] };
export type MembershipClaims = { role: string; permissions: string[] };

const secret = process.env.JWT_SECRET;

export function signToken(claims: AuthClaims) {
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign(claims, secret, { expiresIn: '1h', issuer: 'horus' });
}

export function claimsFromMembership(input: {
  sub: string;
  tenantId: string;
  membership: MembershipClaims;
}): AuthClaims {
  return {
    sub: input.sub,
    tenantId: input.tenantId,
    role: input.membership.role,
    permissions: [...new Set(input.membership.permissions.map(String))],
  };
}

export function verifyBootstrapToken(supplied: string | undefined, expected = process.env.HORUS_BOOTSTRAP_TOKEN): boolean {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!secret) return res.status(503).json({ error: 'authentication not configured' });
    const raw = req.header('authorization');
    if (!raw?.startsWith('Bearer ')) return res.status(401).json({ error: 'authentication required' });
    const claims = jwt.verify(raw.slice(7), secret, { issuer: 'horus' }) as AuthClaims;
    if (!claims?.sub || !claims?.tenantId || !claims?.role || !Array.isArray(claims.permissions)) {
      return res.status(401).json({ error: 'invalid token claims' });
    }
    (req as Request & { auth?: AuthClaims }).auth = claims;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as Request & { auth?: AuthClaims }).auth;
    if (!auth?.permissions?.includes(permission) && auth?.role !== 'owner' && auth?.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
