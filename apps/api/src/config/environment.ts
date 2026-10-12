import { z } from 'zod';

const optionalText = z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().trim().optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_RUNTIME: z.enum(['DOCKER', 'EXTERNAL']).default('DOCKER'),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(['LOCAL_SESSION', 'OPEN_DEMO']).default('LOCAL_SESSION'),
  ALLOW_OPEN_DEMO: z.enum(['true', 'false']).default('false'),
  LOCAL_DEMO_IMPERSONATION: z.enum(['true', 'false']).default('false'),
  LOCAL_DEMO_CREDENTIALS: z.enum(['true', 'false']).default('false'),
  LOCAL_DEMO_CREDENTIAL_FILE: optionalText,
  DEMO_ACTOR_ID: z.string().uuid().default('00000000-0000-4000-8000-000000000001'),
  AI_MODE: z.enum(['OFF', 'MOCK']).default('OFF'),
  GOOGLE_OAUTH_CLIENT_ID: optionalText,
  GOOGLE_PROVIDER_WRITES: z.enum(['BLOCKED', 'ENABLED']).default('BLOCKED'),
  GOOGLE_DRIVE_WRITES: z.enum(['BLOCKED', 'ENABLED']).default('BLOCKED'),
  GOOGLE_OAUTH_CLIENT_SECRET: optionalText,
  GOOGLE_OAUTH_ENCRYPTION_KEY: optionalText,
  GOOGLE_OAUTH_CALLBACK_URL: z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().url().optional()),
  GOOGLE_DRIVE_SHARED_DRIVE_ID: optionalText,
  GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID: optionalText,
  GOOGLE_DRIVE_INTEGRATION_EMAIL: optionalText,
  GOOGLE_DRIVE_ACCESS_MODE: z.enum(['CPMS_VISIBILITY_ONLY', 'DRIVE_ACL_SYNC']).default('CPMS_VISIBILITY_ONLY'),
  GOOGLE_DRIVE_SHARING_MODE: z.enum(['PARENT_INHERITED', 'LINK_WRITER', 'DRIVE_ACL']).default('PARENT_INHERITED'),
  GOOGLE_DRIVE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(52_428_800).default(52_428_800),
  GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES: z.coerce.number().int().positive().default(5_242_880),
}).superRefine((environment, context) => {
  const origin = new URL(environment.WEB_ORIGIN);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.origin !== environment.WEB_ORIGIN || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['WEB_ORIGIN'], message: 'WEB_ORIGIN must be an exact HTTP(S) origin without path or credentials.' });
  }
  if (environment.AUTH_MODE === 'OPEN_DEMO' && (environment.ALLOW_OPEN_DEMO !== 'true' || environment.NODE_ENV === 'production' || !loopback)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_MODE'], message: 'OPEN_DEMO requires explicit local/test opt-in and is forbidden in production.' });
  }
  if (environment.LOCAL_DEMO_IMPERSONATION === 'true' && (environment.NODE_ENV === 'production' || !loopback)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['LOCAL_DEMO_IMPERSONATION'], message: 'Demo impersonation is local-only.' });
  }
  if (environment.LOCAL_DEMO_CREDENTIALS === 'true' && (environment.NODE_ENV === 'production' || !loopback || environment.AUTH_MODE !== 'LOCAL_SESSION' || !environment.LOCAL_DEMO_CREDENTIAL_FILE)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['LOCAL_DEMO_CREDENTIALS'], message: 'Shared demo credentials require explicit non-production loopback LOCAL_SESSION mode.' });
  }
  if (environment.AUTH_MODE === 'LOCAL_SESSION' && origin.protocol !== 'https:' && !loopback) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['WEB_ORIGIN'], message: 'Session authentication requires HTTPS outside loopback.' });
  }
  if (environment.GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES > environment.GOOGLE_DRIVE_UPLOAD_MAX_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GOOGLE_DRIVE_RESUMABLE_THRESHOLD_BYTES'],
      message: 'Google Drive resumable threshold must not exceed the upload limit.',
    });
  }
  if (environment.GOOGLE_DRIVE_WRITES === 'ENABLED') {
    for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_ENCRYPTION_KEY',
      'GOOGLE_OAUTH_CALLBACK_URL', 'GOOGLE_DRIVE_SHARED_DRIVE_ID', 'GOOGLE_DRIVE_CAMPAIGN_PARENT_FOLDER_ID', 'GOOGLE_DRIVE_INTEGRATION_EMAIL'] as const) {
      if (!environment[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Required when Google Drive writes are enabled.' });
    }
    if (environment.GOOGLE_DRIVE_INTEGRATION_EMAIL && !z.email().safeParse(environment.GOOGLE_DRIVE_INTEGRATION_EMAIL).success) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['GOOGLE_DRIVE_INTEGRATION_EMAIL'], message: 'Google Drive integration email is invalid.' });
    }
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return environmentSchema.parse(input);
}
