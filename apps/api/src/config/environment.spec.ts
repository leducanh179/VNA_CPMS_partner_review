import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment';

const databaseUrl = 'postgresql://cpms:example@localhost:5432/cpms?schema=public';

describe('validateEnvironment', () => {
  it('requires local authentication by default and explicit opt-in for legacy demo', () => {
    expect(validateEnvironment({ DATABASE_URL: databaseUrl }).AUTH_MODE).toBe('LOCAL_SESSION');
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, AUTH_MODE: 'OPEN_DEMO' })).toThrow();
    expect(validateEnvironment({ DATABASE_URL: databaseUrl, AUTH_MODE: 'OPEN_DEMO', ALLOW_OPEN_DEMO: 'true' }).AUTH_MODE).toBe('OPEN_DEMO');
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, AUTH_MODE: 'OPEN_DEMO', ALLOW_OPEN_DEMO: 'true', NODE_ENV: 'production' })).toThrow();
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, LOCAL_DEMO_IMPERSONATION: 'true', WEB_ORIGIN: 'https://remote.example.test' })).toThrow();
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, WEB_ORIGIN: 'http://remote.example.test' })).toThrow();
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, WEB_ORIGIN: 'http://localhost:5173/path' })).toThrow();
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, LOCAL_DEMO_CREDENTIALS: 'true', LOCAL_DEMO_CREDENTIAL_FILE: 'private/demo.json', NODE_ENV: 'production' })).toThrow();
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, LOCAL_DEMO_CREDENTIALS: 'true', LOCAL_DEMO_CREDENTIAL_FILE: 'private/demo.json', WEB_ORIGIN: 'https://remote.example.test' })).toThrow();
  });
  it('defaults to the Docker database runtime', () => {
    const environment = validateEnvironment({ DATABASE_URL: databaseUrl });

    expect(environment.DB_RUNTIME).toBe('DOCKER');
  });

  it('accepts an external PostgreSQL runtime', () => {
    const environment = validateEnvironment({ DATABASE_URL: databaseUrl, DB_RUNTIME: 'EXTERNAL' });

    expect(environment.DB_RUNTIME).toBe('EXTERNAL');
  });

  it('rejects unsupported database runtimes', () => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, DB_RUNTIME: 'SQLITE' })).toThrow();
  });

  it('keeps Google OAuth optional and normalizes blank placeholders', () => {
    const environment = validateEnvironment({ DATABASE_URL: databaseUrl, GOOGLE_OAUTH_CLIENT_ID: '' });
    expect(environment.GOOGLE_OAUTH_CLIENT_ID).toBeUndefined();
  });

  it('validates a configured Google OAuth callback URL', () => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, GOOGLE_OAUTH_CALLBACK_URL: 'not-a-url' })).toThrow();
  });

  it('keeps the configurable Drive upload limit within the transport safety cap', () => {
    const environment = validateEnvironment({
      DATABASE_URL: databaseUrl,
      GOOGLE_DRIVE_UPLOAD_MAX_BYTES: 10_485_760,
      GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES: 5_242_880,
    });

    expect(environment.GOOGLE_DRIVE_UPLOAD_MAX_BYTES).toBe(10_485_760);
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, GOOGLE_DRIVE_UPLOAD_MAX_BYTES: 52_428_801 })).toThrow();
    expect(() => validateEnvironment({
      DATABASE_URL: databaseUrl,
      GOOGLE_DRIVE_UPLOAD_MAX_BYTES: 4_194_304,
      GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES: 5_242_880,
    })).toThrow();
  });
});
