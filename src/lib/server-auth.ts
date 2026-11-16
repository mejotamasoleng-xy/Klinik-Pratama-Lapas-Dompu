import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { hashPasswordServer, verifyPasswordServer, isLegacySha256Hash } from './password.ts';
import { createHash } from 'crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days max, client can choose shorter
const memorySessions = new Map<string, { uid: string; username: string; role: string; exp: number; mustChangePassword: boolean }>();

function getSecret() {
  return process.env.SESSION_SECRET || process.env.APP_SECRET || 'dev-insecure-session-secret-change-me';
}

export function signSessionToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): any | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  return createHash('sha256').update(input).digest('hex');
}

export function verifyScryptOrLegacy(password: string, stored: string): { ok: boolean; needsRehash: boolean } {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith('scrypt$')) {
    return { ok: verifyPasswordServer(password, stored), needsRehash: false };
  }
  if (isLegacySha256Hash(stored)) {
    const hex = createHash('sha256').update(password).digest('hex');
    const ok = hex === stored.toLowerCase();
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

export async function findUserByUsernameDb(username: string) {
  if (!db) {
    // memory users handled in user-store; import dynamically avoided - caller should pass
    return null;
  }
  try {
    const rows = await db.select().from(users).where(eq(users.username, username));
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function updateUserPassword(username: string, passwordHash: string, mustChange: boolean) {
  if (!db) return null;
  try {
    const rows = await db.update(users).set({ passwordHash, mustChangePassword: mustChange, updatedAt: new Date() }).where(eq(users.username, username)).returning();
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function getUserByUid(uid: string) {
  if (!db) return null;
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid));
    return rows[0] || null;
  } catch {
    return null;
  }
}
