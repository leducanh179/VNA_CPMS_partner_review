import 'reflect-metadata';
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { LookupApplicationService } from '../application/lookup.application-service';
import { loadLookupKey } from '../infrastructure/openai-lookup.adapter';

async function main() {
  const [email, keyFile] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !keyFile || /[\r\n"]/.test(keyFile))
    throw new Error('Usage: configure-pilot.cli.ts EXACT_EMAIL ABSOLUTE_KEY_FILE');
  const keyPath = resolve(keyFile);
  await loadLookupKey(keyPath); // Validate without printing or copying the secret.
  process.env.AI_MODE = 'OFF'; // Setup cannot trigger a model call.
  const { AppModule } = await import('../../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const id = await app.get(LookupApplicationService).resolvePilotId(email);
    let prior = 0, period = '';
    try {
      const smoke = JSON.parse(await readFile('private-local/ai-pilot/live-smoke.json', 'utf8')) as { period: string; result: { chargedVnd: number } };
      if (!/^\d{4}-\d{2}$/.test(smoke.period) || !Number.isSafeInteger(smoke.result.chargedVnd) || smoke.result.chargedVnd < 0) throw new Error('Invalid smoke-test receipt');
      prior = smoke.result.chargedVnd; period = smoke.period;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir('private-local/ai-pilot', { recursive: true });
    await writeFile('private-local/ai-pilot/pilot.env', [
      '# Server-only overlay. Prepared, NOT activated. Keep outside release and version control.',
      'AI_MODE=OPENAI', `AI_PILOT_ACTOR_ID=${id}`, `OPENAI_API_KEY_FILE="${keyPath.replace(/\\/g, '/')}"`,
      `AI_PRIOR_SPEND_VND=${prior}`, `AI_PRIOR_SPEND_PERIOD=${period}`, '',
    ].join('\n'));
    console.log('Prepared private-local/ai-pilot/pilot.env for the exact active account. No server restarted; no business data changed.');
  } finally { await app.close(); }
}
if (require.main === module) void main().catch(() => { console.error('Pilot setup failed. Check the exact active email, private key file and local database connection. No secret was printed.'); process.exitCode = 1; });
