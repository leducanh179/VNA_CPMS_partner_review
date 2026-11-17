import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DemoActorMiddleware } from './demo-actor.middleware';

function harness(method: string, originalUrl: string) {
  const authenticate = vi.fn(async () => null);
  const next = vi.fn();
  const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  const request = { method, originalUrl, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, headers: {}, get: vi.fn() };
  const middleware = new DemoActorMiddleware(
    { get: vi.fn(() => 'LOCAL_SESSION') } as never,
    { authenticate } as never,
    { withRequestActor: vi.fn() } as never,
  );
  return { authenticate, next, response, request, middleware };
}

describe('anonymous Guest HTTP boundary', () => {
  it('passes only an explicitly listed public GET to the read-only controller without an actor', async () => {
    const test = harness('GET', '/api/public/guest/campaigns?view=table');
    await test.middleware.use(test.request as never, test.response as never, test.next);
    expect(test.next).toHaveBeenCalledOnce();
    expect(test.authenticate).not.toHaveBeenCalled();
    expect(test.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(test.request).not.toHaveProperty('actor');
  });

  it.each([
    ['GET', '/api/public/guest/contracts/123'],
    ['GET', '/api/public/guest/bookings/123'],
    ['GET', '/api/directory/people'],
    ['POST', '/api/public/guest/campaigns'],
  ])('keeps %s %s behind a real session', async (method, route) => {
    const test = harness(method, route);
    await expect(test.middleware.use(test.request as never, test.response as never, test.next)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(test.authenticate).toHaveBeenCalledOnce();
    expect(test.next).not.toHaveBeenCalled();
  });
});
