import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppModule } from '../src/app.module';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { IdentityRepository } from '../src/modules/identity/application/identity.repository';

async function main() {
  if (process.argv.slice(2).length) throw new Error('This command accepts no password arguments.');
  const privateRoot = path.resolve(__dirname, '../../../private-local/access-demo');
  const current = JSON.parse(await readFile(path.join(privateRoot, 'current-credential.json'), 'utf8')) as { email: string; password: string };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const service = app.get(IdentityApplicationService);
    const repository = app.get(IdentityRepository);
    const session = await service.login(current.email, current.password, 'local-authorized-credential-command');
    const password = await repository.readLocalDemoDefaultPassword();
    console.log('Authenticated local administrator; preparing separately salted demo credential hashes.');
    const result = await service.configureDemoPasswords(session.session, password, 'Explicit user request: default credentials for all local demo personnel; no mandatory first-login change.');
    await writeFile(path.join(privateRoot, 'demo-credential-apply-result.json'), JSON.stringify({ ...result, completedAt: new Date().toISOString(), forcedChange: false,
      originalCredentialPathNowObsolete: 'current-credential.json', credentialFile: process.env.LOCAL_DEMO_CREDENTIAL_FILE, sessionsRevoked: true }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...result, forcePasswordChange: false, rolesAndAccountStatusPreserved: true, priorSessionsRevoked: true }));
  } finally { await app.close(); }
}
void main().catch(() => { console.error('Demo credential configuration failed. No automatic retry, reset or fallback.'); process.exitCode = 1; });
