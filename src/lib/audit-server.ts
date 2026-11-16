import { addAuditLog } from '../db/queries.ts';
import type { AuthRequest } from '../middleware/auth.ts';
import { getTrustedClientIp } from './security.ts';

export async function auditServer(req: AuthRequest, aksi: string, rincian: string, target?: string, metadata?: any) {
  try {
    const user = req.authUser;
    await addAuditLog({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      waktu: new Date().toISOString(),
      aksi,
      rincian,
      perangkat: (req.headers['user-agent'] as string) || '',
      userId: user ? String(user.id) : null,
      username: user?.username || null,
      role: user?.role || null,
      ipAddress: req.clientIp || getTrustedClientIp(req),
      target: target || null,
      metadata: metadata || null,
    } as any);
  } catch {
    // never block main flow
  }
}
