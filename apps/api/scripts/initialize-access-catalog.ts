import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppModule } from '../src/app.module';
import { AccessApplicationService } from '../src/modules/access/application/access.application-service';
import { IdentityApplicationService } from '../src/modules/identity/application/identity.application-service';
import { IdentityRepository } from '../src/modules/identity/application/identity.repository';

/** Explicit local bootstrap; no default identities, reset, global seed or provider calls. */
async function main() {
  if (process.argv.slice(2).length) throw new Error('Credentials must not be supplied on the command line.');
  const privateRoot = path.resolve(__dirname, '../../../private-local/access-demo');
  const configuration = JSON.parse(await readFile(path.join(privateRoot, 'bootstrap-configuration.json'), 'utf8')) as { administrator: { email: string } };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const identity = app.get(IdentityApplicationService);
  let sessionId: Awaited<ReturnType<IdentityApplicationService['login']>>['session'] | undefined;
  try {
    const password = await app.get(IdentityRepository).readLocalDemoDefaultPassword();
    const login = await identity.login(configuration.administrator.email, password, 'local-authorized-access-catalog'); sessionId = login.session;
    const result = await app.get(AccessApplicationService).initializeCatalog(identity.actor(login.session));
    const repeated = await app.get(AccessApplicationService).initializeCatalog(identity.actor(login.session));
    if (repeated.definitions || repeated.initializedRoles) throw new Error('Catalog repeat was not idempotent.');
    await writeFile(path.join(privateRoot, 'access-catalog-activation-result.json'), JSON.stringify({ recordedAt: new Date().toISOString(), result, repeated, providerCalls: 0 }, null, 2));
    console.log(JSON.stringify({ catalogInitialized: true, ...result, repeatUnchanged: true }));
  } finally { if (sessionId) await identity.logout(sessionId); await app.close(); }
}
void main().catch(() => { console.error('Access catalog initialization failed; no fallback, reset or retry performed.'); process.exitCode = 1; });
