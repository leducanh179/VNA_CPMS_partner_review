import { describe, expect, it } from 'vitest';
import { generateLocalCredential, hashLocalDemoPassword, hashLocalPassword, isCookieMutationTrusted, isSessionCurrent, localDemoCredentialsEnabled, localSessionCookieOptions, newOpaqueSecret, validateNewLocalPassword, verifyLocalPassword, verifyOpaqueSecret } from './local-auth-security';

describe('local auth cryptographic primitives (not login E2E)', () => {
  it('confines demo credentials to explicit local mode and a distinct hash version', async () => {
    const prior = { AUTH_MODE: process.env.AUTH_MODE, LOCAL_DEMO_CREDENTIALS: process.env.LOCAL_DEMO_CREDENTIALS, WEB_ORIGIN: process.env.WEB_ORIGIN, NODE_ENV: process.env.NODE_ENV };
    try {
      Object.assign(process.env, { AUTH_MODE: 'LOCAL_SESSION', LOCAL_DEMO_CREDENTIALS: 'true', WEB_ORIGIN: 'http://localhost:5173', NODE_ENV: 'test' });
      const password = generateLocalCredential().slice(0, 8);
      const hash = await hashLocalDemoPassword(password);
      expect(hash.startsWith('scrypt$demo-v1$')).toBe(true);
      expect(await verifyLocalPassword(password, hash)).toBe(false);
      expect(await verifyLocalPassword(password, hash, true)).toBe(true);
      expect(validateNewLocalPassword(password)).toBe(true);
      expect(localDemoCredentialsEnabled({ ...process.env, NODE_ENV: 'production' })).toBe(false);
      expect(localDemoCredentialsEnabled({ ...process.env, WEB_ORIGIN: 'https://remote.example.test' })).toBe(false);
      expect(localDemoCredentialsEnabled({ ...process.env, LOCAL_DEMO_CREDENTIALS: 'false' })).toBe(false);
    } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  }, 15_000);
  it('hashes random synthetic credentials using the fixed OWASP scrypt cost and verifies exact bytes', async () => {
    const password = generateLocalCredential();
    const hash = await hashLocalPassword(password);
    expect(hash.startsWith('scrypt$v1$131072$8$1$')).toBe(true);
    expect(hash.includes(password)).toBe(false);
    expect(await verifyLocalPassword(password, hash)).toBe(true);
    expect(await verifyLocalPassword(`${password} `, hash)).toBe(false);
    expect(await verifyLocalPassword(password, null)).toBe(false);
  }, 15_000);
  it('hashes and verifies an eight-character production password without character-class rules', async () => {
    const password = 'abcdefgh';
    const hash = await hashLocalPassword(password);
    expect(hash.startsWith('scrypt$v1$')).toBe(true);
    expect(await verifyLocalPassword(password, hash)).toBe(true);
    expect(await verifyLocalPassword('abcdefgi', hash)).toBe(false);
  }, 15_000);
  it('requires only eight characters for new passwords, preserving spaces and Unicode', () => {
    expect(validateNewLocalPassword('1234567')).toBe(false);
    expect(validateNewLocalPassword('12345678')).toBe(true);
    expect(validateNewLocalPassword('abcdefgh')).toBe(true);
    expect(validateNewLocalPassword('        ')).toBe(true);
    expect(validateNewLocalPassword('😀'.repeat(8))).toBe(true);
    expect(validateNewLocalPassword('x'.repeat(1025))).toBe(false);
    expect(validateNewLocalPassword('synthetic sample passphrase ')).toBe(true);
  });
  it('generates independent 256-bit secrets and keeps only their hash for verification', () => {
    const first = newOpaqueSecret(); const second = newOpaqueSecret();
    expect(first.token).toHaveLength(64);
    expect(first.token).not.toBe(first.hash);
    expect(first.hash).not.toBe(second.hash);
    expect(verifyOpaqueSecret(first.token, first.hash)).toBe(true);
    expect(verifyOpaqueSecret(second.token, first.hash)).toBe(false);
    expect(verifyOpaqueSecret(undefined, first.hash)).toBe(false);
  });
  it('requires origin and session CSRF for cookie mutations', () => {
    const csrf = newOpaqueSecret();
    const input = { kind: 'SESSION' as const, method: 'POST', origin: 'http://localhost:5173', configuredOrigin: 'http://localhost:5173', csrfToken: csrf.token, sessionCsrfHash: csrf.hash };
    expect(isCookieMutationTrusted(input)).toBe(true);
    expect(isCookieMutationTrusted({ ...input, origin: 'https://attacker.example.test' })).toBe(false);
    expect(isCookieMutationTrusted({ ...input, csrfToken: undefined })).toBe(false);
    expect(isCookieMutationTrusted({ kind: 'LOGIN', method: 'POST', configuredOrigin: input.configuredOrigin, origin: undefined })).toBe(false);
  });
  it('enforces expiry, logout, idle timeout and both account states', () => {
    const session = { createdAt: 1, lastSeenAt: 100, expiresAt: 1000, revokedAt: null, effectiveActive: true, originalActive: true };
    expect(isSessionCurrent(session, 120, 100)).toBe(true);
    expect(isSessionCurrent(session, 200, 100)).toBe(false);
    expect(isSessionCurrent(session, 1000, 2000)).toBe(false);
    expect(isSessionCurrent({ ...session, revokedAt: 110 }, 120, 100)).toBe(false);
    expect(isSessionCurrent({ ...session, originalActive: false }, 120, 100)).toBe(false);
    expect(isSessionCurrent({ ...session, effectiveActive: false }, 120, 100)).toBe(false);
  });
  it('limits insecure cookies to loopback and uses HttpOnly/SameSite/Secure correctly', () => {
    expect(localSessionCookieOptions('http://localhost:5173', 1000)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false });
    expect(localSessionCookieOptions('https://demo.example.test', 1000).secure).toBe(true);
    expect(() => localSessionCookieOptions('http://demo.example.test', 1000)).toThrow('loopback');
  });
});
