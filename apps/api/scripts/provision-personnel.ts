import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PersonnelBootstrapApplicationService, type PrivateBootstrapConfiguration } from '../src/modules/identity/application/personnel-bootstrap.application-service';
import { PersonnelProvisioningModule } from '../src/modules/identity/personnel-provisioning.module';

let stage = 'path validation';
async function main() {
  const [mode, sourceArgument, configurationArgument] = process.argv.slice(2);
  if (!['preview', 'apply'].includes(mode ?? '') || !sourceArgument || !configurationArgument || process.argv.slice(2).length !== 3) throw new Error('Expected preview/apply, source XLSX and reviewed private configuration.');
  const root = await realpath(path.resolve(__dirname, '../../..'));
  const sourceRoot = await realpath(path.join(root, 'local-source'));
  const privateRoot = await realpath(path.join(root, 'private-local/access-demo'));
  if (privateRoot.toLowerCase() !== path.join(root, 'private-local/access-demo').toLowerCase()) throw new Error('Private directory must not be redirected.');
  const source = await realpath(path.resolve(sourceArgument));
  const configurationPath = await realpath(path.resolve(configurationArgument));
  const inside = (parent: string, target: string) => { const relative = path.relative(parent, target); return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative); };
  if (!inside(sourceRoot, source) || !inside(privateRoot, configurationPath)) throw new Error('Source/configuration boundaries are invalid.');
  const privateTracked = execFileSync('git', ['ls-files', '--', 'local-source', 'private-local', 'backups'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter((file) => file && file !== 'backups/.gitkeep');
  if (privateTracked.length) throw new Error('Private data paths must not be tracked.');
  execFileSync('git', ['check-ignore', '--quiet', '--', privateRoot], { cwd: root });
  const configuration = JSON.parse((await readFile(configurationPath, 'utf8')).replace(/^\uFEFF/, '')) as PrivateBootstrapConfiguration;
  stage = 'source read';
  const input = { fileName: path.basename(source), content: await readFile(source) };
  stage = 'application context';
  const app = await NestFactory.createApplicationContext(PersonnelProvisioningModule, { logger: false });
  try {
    const service = app.get(PersonnelBootstrapApplicationService);
    const previewPath = path.join(privateRoot, 'bootstrap-database-preview.json');
    if (mode === 'preview') {
      stage = 'source and database preview';
      const preview = await service.preview(input, configuration);
      await writeFile(previewPath, JSON.stringify(preview, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ mode, counts: preview.preview.counts, version: preview.version, alreadyBootstrapped: preview.alreadyBootstrapped, previewPath }));
      return;
    }
    stage = 'backup and preservation validation';
    const backup = JSON.parse((await readFile(path.join(privateRoot, 'backup-before-identity.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const backupPath = await realpath(backup.file);
    if (!inside(path.join(root, 'backups'), backupPath) || !backup.archiveCatalogueReadable ||
        createHash('sha256').update(await readFile(backupPath)).digest('hex').toLowerCase() !== String(backup.sha256).toLowerCase()) throw new Error('Verified backup is required.');
    const preservation = JSON.parse(await readFile(path.join(privateRoot, 'database-after-identity-migration.json'), 'utf8'));
    if (!Array.isArray(preservation.differences) || preservation.differences.length) throw new Error('Post-migration preservation check must pass.');
    const preview = JSON.parse(await readFile(previewPath, 'utf8'));
    if (preview.sourceHash !== configuration.sourceHash) throw new Error('Source preview changed.');
    const credentialPath = path.join(privateRoot, 'bootstrap-credential.json');
    stage = 'atomic bootstrap';
    const result = await service.apply(input, configuration, preview.version, async (credential) => {
      const file = await open(credentialPath, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ ...credential, mustChangePassword: true, createdAt: new Date().toISOString(), purpose: 'One-time local CPMS bootstrap; never commit or transmit.' }, null, 2)); await file.sync(); }
      finally { await file.close(); }
    });
    const summary = result.alreadyBootstrapped ? { alreadyBootstrapped: true } : { alreadyBootstrapped: false, people: result.people, pending: result.pending,
      administratorId: result.administratorId, credentialPath, mustChangePassword: true };
    await writeFile(path.join(privateRoot, result.alreadyBootstrapped ? 'bootstrap-repeat-result.json' : 'bootstrap-apply-result.json'), JSON.stringify({ ...summary, completedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ mode, alreadyBootstrapped: result.alreadyBootstrapped, ...(!result.alreadyBootstrapped ? { people: result.people, pending: result.pending, credentialPath } : {}) }));
  } finally { await app.close(); }
}
void main().catch((error: unknown) => {
  const frames = error instanceof Error ? error.stack?.split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 2) : [];
  console.error(`Personnel provisioning stopped during ${stage}. No automatic reset or retry was performed.`);
  console.error(frames?.join('\n')); process.exitCode = 1;
});
