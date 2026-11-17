/** HTTP backstop for endpoints which do not use the scoped permission kernel. */
export function partnerDemoRequestAllowed(method: string, route: string): boolean {
  if (route.startsWith('/api/directory/')) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (method === 'POST' && ['/api/auth/logout', '/api/auth/change-password'].includes(route)) return true;
  // These commands affect only the caller's practice progress/collectible. REAL start
  // still requires campaign.create inside its Application Service; no business bypass.
  if (method === 'POST' && /^\/api\/engagement\/(?:start|demo-draft|demo-submit|reconcile|acknowledge)$/.test(route)) return true;
  if (method === 'PUT' && /^\/api\/grid-drafts\/[^/]+$/.test(route)) return true;
  return ['PUT', 'DELETE'].includes(method) && /^\/api\/(campaign|contract|material)-form-drafts\/[0-9a-f-]{36}$/i.test(route);
}
