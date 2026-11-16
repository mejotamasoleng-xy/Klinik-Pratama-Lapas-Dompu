import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

export function hashPasswordServer(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPasswordServer(password: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hashHex] = parts;
    const hash = Buffer.from(hashHex, 'hex');
    const derived = scryptSync(password, salt, KEYLEN);
    if (hash.length !== derived.length) return false;
    return timingSafeEqual(hash, derived);
  }
  // legacy SHA-256 hex (64 chars) - accept for migration only
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    // cannot verify synchronously with webcrypto here; handled specially in auth flow
    return false;
  }
  return false;
}

export function isLegacySha256Hash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(stored || '');
}
