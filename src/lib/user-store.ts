import { db } from '../db/index.ts';
import { users, auditLogs } from '../db/schema.ts';
import { eq, desc } from 'drizzle-orm';
import { hashPasswordServer, isLegacySha256Hash } from './password.ts';
import { randomUUID } from 'crypto';

export interface AppUserRecord {
  id?: number;
  uid: string;
  email: string;
  username?: string | null;
  displayName?: string | null;
  role: string;
  passwordHash?: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

const memoryUsers: AppUserRecord[] = [];

function getMemoryUserByUsername(username: string) {
  return memoryUsers.find((u) => (u.username || '').toLowerCase() === username.toLowerCase());
}

export async function findUserByUsername(username: string): Promise<AppUserRecord | null> {
  if (!db) return getMemoryUserByUsername(username) || null;
  try {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return (rows[0] as any) || null;
  } catch {
    return null;
  }
}

export async function findUserByUid(uid: string): Promise<AppUserRecord | null> {
  if (!db) return memoryUsers.find((u) => u.uid === uid) || null;
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid));
    return (rows[0] as any) || null;
  } catch {
    return null;
  }
}

export async function listUsers(): Promise<AppUserRecord[]> {
  if (!db) return [...memoryUsers];
  try {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return rows as any;
  } catch {
    return [];
  }
}

export async function createOrUpdateUser(u: Partial<AppUserRecord> & { username: string; role: string }) {
  const uid = u.uid || `local-${randomUUID()}`;
  const email = u.email || `${u.username}@local.invalid`;
  const record: any = {
    uid,
    email,
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role,
    passwordHash: u.passwordHash || null,
    mustChangePassword: Boolean(u.mustChangePassword),
    isActive: u.isActive !== false,
    updatedAt: new Date(),
  };
  if (!db) {
    const idx = memoryUsers.findIndex((x) => x.username === u.username || x.uid === uid);
    if (idx >= 0) {
      memoryUsers[idx] = { ...memoryUsers[idx], ...record };
      return memoryUsers[idx];
    }
    memoryUsers.push({ ...record, id: memoryUsers.length + 1, createdAt: new Date() } as any);
    return memoryUsers[memoryUsers.length - 1];
  }
  const existing = await findUserByUsername(u.username);
  if (existing) {
    const rows = await db.update(users).set(record).where(eq(users.username, u.username)).returning();
    return rows[0];
  }
  const rows = await db.insert(users).values({ ...record, createdAt: new Date() }).returning();
  return rows[0];
}

let bootstrapPromise: Promise<void> | null = null;

export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      const existing = await listUsers();
      const hasAdmin = existing.some((u) => u.role === 'admin' && u.isActive);
      if (hasAdmin) return;
      const envUser = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
      const envPass = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'changeme-now';
      const envEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@klinik-dompu.local';
      await createOrUpdateUser({
        username: envUser,
        email: envEmail,
        displayName: 'Administrator',
        role: 'admin',
        passwordHash: hashPasswordServer(envPass),
        mustChangePassword: true,
        isActive: true,
      });
    } catch {
      // ignore
    }
  })();
  return bootstrapPromise;
}

export async function recordAudit(entry: {
  id: string;
  waktu: string;
  aksi: string;
  rincian: string;
  perangkat?: string | null;
  userId?: string | null;
  username?: string | null;
  role?: string | null;
  ipAddress?: string | null;
  target?: string | null;
  metadata?: any;
}) {
  if (!db) return;
  try {
    await db.insert(auditLogs).values(entry as any).onConflictDoNothing();
  } catch {
    // ignore
  }
}
