import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { configureTrustedProxy } from './trusted-proxy';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function observedIp(nodeEnv: string, forwardedFor: string): Promise<string | undefined> {
  const app = express();
  configureTrustedProxy(app, nodeEnv);
  app.get('/', (request, response) => response.json({ ip: request.ip }));
  const server = createServer(app).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const result = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { 'X-Forwarded-For': forwardedFor } });
  return (await result.json() as { ip?: string }).ip;
}

describe('trusted proxy client IP', () => {
  it('uses the proxy-supplied address only in production', async () => {
    expect(await observedIp('production', '198.51.100.24')).toBe('198.51.100.24');
    expect(await observedIp('development', '198.51.100.24')).toBe('127.0.0.1');
  });
  it('selects the closest untrusted hop instead of trusting every forwarded address', async () => {
    expect(await observedIp('production', '203.0.113.7, 198.51.100.24')).toBe('198.51.100.24');
  });
});
