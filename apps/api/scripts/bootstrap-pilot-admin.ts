import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { chmod, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { PilotAdminBootstrapApplicationService } from '../src/modules/identity/application/pilot-admin-bootstrap.application-service';
import { PilotAdminProvisioningModule } from '../src/modules/identity/pilot-admin-provisioning.module';

let stage = 'private runtime validation';
async function main() {
  const [mode, credentialArgument] = process.argv.slice(2);
  if (!['preview', 'apply'].includes(mode ?? '') || (mode === 'apply' && !credentialArgument) ||
      (mode === 'preview' && credentialArgument) || process.argv.slice(2).length > (mode === 'apply' ? 2 : 1)) {
    throw new Error('Expected preview or apply with one private credential output path.');
  }
  if (process.env.NODE_ENV !== 'production' || process.env.AUTH_MODE !== 'LOCAL_SESSION' ||
      process.env.ALLOW_OPEN_DEMO !== 'false' || process.env.LOCAL_DEMO_CREDENTIALS !== 'false' ||
      process.env.WEB_ORIGIN !== 'https://cpmsvna.com') throw new Error('Pilot production identity configuration is required.');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1' || database.port !== '5432' ||
      database.pathname !== '/cpms_pilot') throw new Error('Only the isolated pilot database is allowed.');
  if (mode === 'apply' && process.platform !== 'linux') throw new Error('Apply is Linux-only.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const profile = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  stage = 'application preview';
  const app = await NestFactory.createApplicationContext(PilotAdminProvisioningModule, { logger: false });
  try {
    const service = app.get(PilotAdminBootstrapApplicationService);
    const preview = await service.preview(profile);
    if (mode === 'preview') {
      console.log(JSON.stringify({ mode, canBootstrap: preview.canBootstrap,
        employeeCode: preview.profile.employeeCode, email: preview.profile.email }));
      return;
    }
    if (!preview.canBootstrap) throw new Error('Pilot identity database is not empty.');
    const credentialPath = path.resolve(credentialArgument!);
    const parent = await lstat(path.dirname(credentialPath));
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() ||
        (parent.mode & 0o077) !== 0) throw new Error('Credential output directory is not private.');
    stage = 'atomic first-admin creation';
    const result = await service.apply(profile, async (credential) => {
      const handle = await open(credentialPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ ...credential, mustChangePassword: true, createdAt: new Date().toISOString() }, null, 2));
        await handle.sync();
      } finally { await handle.close(); }
      await chmod(credentialPath, 0o600);
    });
    console.log(JSON.stringify({ mode, actorId: result.actorId, mustChangePassword: true, credentialPath }));
  } finally { await app.close(); }
}

void main().catch(() => {
  console.error(`Pilot admin bootstrap stopped during ${stage}; no automatic reset or retry was performed.`);
  process.exitCode = 1;
});
