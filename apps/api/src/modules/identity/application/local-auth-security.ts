import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt profile: N=2^17, r=8, p=1 (128 MiB). Fixed parameters prevent hash-string cost injection.
const scryptOptions = { N: 131_072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const dummySalt = Buffer.alloc(32, 0x5a);
const dummyDigest = Buffer.alloc(64, 0xa5);
let activePasswordOperations = 0;
export class PasswordCapacityError extends Error {}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  // Bound memory use; the login transport must also apply per-account/IP throttling before hashing.
  if (activePasswordOperations >= 2) throw new PasswordCapacityError('Password verification is busy. Retry later.');
  activePasswordOperations++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key)));
  } finally { activePasswordOperations--; }
}

export function validateNewLocalPassword(password: string): boolean {
  // Do not trim/normalize secrets. Spaces and Unicode remain part of the password.
  return typeof password === 'string' && Array.from(password).length >= 8 && Buffer.byteLength(password, 'utf8') <= 1024;
}
export async function hashLocalPassword(password: string): Promise<string> {
  if (!validateNewLocalPassword(password)) throw new Error('Password must contain at least 8 characters and at most 1024 UTF-8 bytes.');
  const salt = randomBytes(32);
  const digest = await derive(password, salt);
  return `scrypt$v1$131072$8$1$${salt.toString('hex')}$${digest.toString('hex')}`;
}
export function localDemoCredentialsEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  if (environment.LOCAL_DEMO_CREDENTIALS !== 'true' || environment.AUTH_MODE !== 'LOCAL_SESSION' || environment.NODE_ENV === 'production') return false;
  try { const origin = new URL(environment.WEB_ORIGIN ?? ''); return ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname); }
  catch { return false; }
}
export function isDemoCredentialHash(hash: string): boolean { return hash.startsWith('scrypt$demo-v1$'); }
/** Explicit local demo provisioning only. A distinct hash version cannot authenticate when the demo flag is disabled. */
export async function hashLocalDemoPassword(password: string): Promise<string> {
  if (!localDemoCredentialsEnabled() || Array.from(password).length < 8 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Local demo credential policy is not enabled or password is outside its limit.');
  const salt = randomBytes(32); const digest = await derive(password, salt);
  return `scrypt$demo-v1$131072$8$1$${salt.toString('hex')}$${digest.toString('hex')}`;
}
export async function verifyLocalPassword(password: string, storedHash: string | null, allowDemoCredential = false): Promise<boolean> {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) return false;
  const recognizedHash = storedHash && isDemoCredentialHash(storedHash) && allowDemoCredential ? storedHash.replace('scrypt$demo-v1$', 'scrypt$v1$') : storedHash;
  const matched = recognizedHash?.match(/^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{64})\$([a-f0-9]{128})$/);
  const salt = matched ? Buffer.from(matched[1]!, 'hex') : dummySalt;
  const expected = matched ? Buffer.from(matched[2]!, 'hex') : dummyDigest;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(matched);
}

export function generateLocalCredential(): string { return randomBytes(24).toString('base64url'); }
export function newOpaqueSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashOpaqueSecret(token) };
}
export function hashOpaqueSecret(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
export function verifyOpaqueSecret(token: string | undefined, expectedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(hashOpaqueSecret(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}

export interface SessionValidityFacts {
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  effectiveActive: boolean;
  originalActive: boolean;
}
export function isSessionCurrent(session: SessionValidityFacts, now: number, idleTimeoutMs: number): boolean {
  return [session.createdAt, session.lastSeenAt, session.expiresAt, now, idleTimeoutMs].every(Number.isFinite) &&
    idleTimeoutMs > 0 && session.effectiveActive && session.originalActive && session.revokedAt === null &&
    session.createdAt <= session.lastSeenAt && session.lastSeenAt <= now &&
    now < session.expiresAt && now - session.lastSeenAt < idleTimeoutMs;
}

/** Login needs exact trusted Origin too; authenticated mutations additionally need a server-session CSRF secret. */
export function isCookieMutationTrusted(input: {
  method: string; origin: string | undefined; configuredOrigin: string;
} & ({ kind: 'LOGIN' } | { kind: 'SESSION'; csrfToken: string | undefined; sessionCsrfHash: string })): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) return true;
  if (!input.origin || input.origin !== input.configuredOrigin) return false;
  if (input.kind === 'LOGIN') return true;
  return verifyOpaqueSecret(input.csrfToken, input.sessionCsrfHash);
}

export function localSessionCookieOptions(configuredOrigin: string, maxAge: number) {
  const origin = new URL(configuredOrigin);
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error('Cookie lifetime must be positive.');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('HTTP session cookies are allowed only on local loopback.');
  }
  // Top-level OAuth GET callbacks need the existing session. Mutations still require exact Origin + CSRF.
  return { httpOnly: true, sameSite: 'lax' as const, secure: origin.protocol === 'https:', path: '/api', maxAge };
}
