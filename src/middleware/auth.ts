import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { findUserByUid, findUserByUsername, ensureBootstrapAdmin } from '../lib/user-store.ts';
import { getTrustedClientIp } from '../lib/security.ts';
import { verifySessionToken } from '../lib/server-auth.ts';

export type AppRole = 'admin' | 'dokter_perawat' | 'petugas_administrasi';

export interface AuthUser {
  id: string;
  uid?: string;
  username: string;
  email?: string;
  displayName?: string;
  role: AppRole;
  mustChangePassword: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
  clientIp?: string;
}

function unauthorized(res: Response, message = 'Autentikasi diperlukan.') {
  return res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}

function forbidden(res: Response, message = 'Akses ditolak.') {
  return res.status(403).json({ error: message, code: 'FORBIDDEN' });
}

async function resolveFromBearer(token: string): Promise<AuthUser | null> {
  // 1) Server-issued session token (HMAC)
  const session = verifySessionToken(token);
  if (session && session.username) {
    const byUsername = await findUserByUsername(session.username);
    if (byUsername && byUsername.isActive) {
      return {
        id: String(byUsername.id ?? byUsername.uid),
        uid: byUsername.uid,
        username: byUsername.username || session.username,
        email: byUsername.email,
        displayName: byUsername.displayName || undefined,
        role: (byUsername.role as AppRole) || 'petugas_administrasi',
        mustChangePassword: Boolean(byUsername.mustChangePassword),
      };
    }
  }
  // 2) Firebase ID token
  if (adminAuth) {
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      const byUid = await findUserByUid(decoded.uid);
      if (byUid && byUid.isActive) {
        return {
          id: String(byUid.id ?? byUid.uid),
          uid: byUid.uid,
          username: byUid.username || byUid.email || decoded.email || decoded.uid,
          email: byUid.email || decoded.email || undefined,
          displayName: byUid.displayName || decoded.name || undefined,
          role: (byUid.role as AppRole) || 'petugas_administrasi',
          mustChangePassword: Boolean(byUid.mustChangePassword),
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try { await ensureBootstrapAdmin(); } catch {}
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  } else if (req.path === '/api/events' && typeof (req.query as any).token === 'string') {
    // EventSource cannot set headers; allow token query only for SSE endpoint
    token = String((req.query as any).token).trim();
  }
  if (!token) return unauthorized(res);

  const user = await resolveFromBearer(token);
  if (!user) return unauthorized(res, 'Token tidak valid atau sesi berakhir.');

  req.authUser = user;
  req.clientIp = getTrustedClientIp(req);
  next();
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const user = await resolveFromBearer(token);
    if (user) req.authUser = user;
  }
  req.clientIp = getTrustedClientIp(req);
  next();
}

export function requireRoles(...roles: AppRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user) return unauthorized(res);
    if (!roles.includes(user.role)) return forbidden(res, 'Peran Anda tidak memiliki izin untuk aksi ini.');
    next();
  };
}

export function rejectIfMustChangePassword(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.authUser?.mustChangePassword) {
    return res.status(403).json({
      error: 'Anda wajib mengganti kata sandi sebelum melanjutkan.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
}

export function ensureDestructiveAllowed(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.authUser;
  if (!user || user.role !== 'admin') {
    return forbidden(res, 'Hanya admin yang dapat melakukan operasi destruktif.');
  }
  next();
}
