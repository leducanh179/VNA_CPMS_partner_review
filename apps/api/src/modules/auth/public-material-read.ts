/** Exact GET allowlist. Nested paths, encoded separators and mutations remain session-protected. */
export function isPublicMaterialRead(method: string, route: string) {
  return method === 'GET' && /^\/api\/public\/materials(?:\/[A-Za-z0-9_-]{1,120})?$/.test(route);
}
/** Process-local, bounded limiter: no shared-cache infrastructure required for the single pilot API. */
export class PublicMaterialRateLimit {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  allow(key: string, now = Date.now()) {
    const previous = this.buckets.get(key);
    if (!previous || now - previous.start >= 60_000) {
      for (const [id, bucket] of this.buckets) if (now - bucket.start >= 60_000) this.buckets.delete(id);
      if (this.buckets.size >= 10000) return false;
      this.buckets.set(key, { start: now, count: 1 }); return true;
    }
    return ++previous.count <= 120;
  }
}
