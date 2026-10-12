import type { AnchorHTMLAttributes, MouseEvent, PropsWithChildren } from 'react';
import { useEffect, useRef, useState } from 'react';
import { confirmUnsavedNavigation } from './unsaved-changes';

let acceptNextPopState = false;
const pendingNavigationGuards = new Set<() => Promise<boolean>>();
const pendingNavigationGuard = async () => {
  for (const guard of pendingNavigationGuards) if (!await guard()) return false;
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  return confirmUnsavedNavigation();
};

/** A form may flush server-side autosave before SPA navigation unmounts it. */
export function registerPendingNavigationGuard(guard: () => Promise<boolean>) {
  pendingNavigationGuards.add(guard);
  return () => { pendingNavigationGuards.delete(guard); };
}

export type AppRoute =
  | { name: 'qctt-plans' }
  | { name: 'qctt-plan-detail'; id: string }
  | { name: 'qctt-catalog' }
  | { name: 'directory' }
  | { name: 'bookings' }
  | { name: 'contracts' }
  | { name: 'contract-new'; owned: boolean }
  | { name: 'contract-edit'; id: string }
  | { name: 'contract-detail'; id: string }
  | { name: 'dashboard' }
  | { name: 'campaigns' }
  | { name: 'campaign-new' }
  | { name: 'campaign-detail'; id: string }
  | { name: 'campaign-edit'; id: string }
  | { name: 'materials' }
  | { name: 'material-new' }
  | { name: 'material-edit'; id: string }
  | { name: 'admin-system' }
  | { name: 'admin-accounts' }
  | { name: 'admin-access' }
  | { name: 'admin-workflow' }
  | { name: 'my-work' }
  | { name: 'not-found' };

function normalizePath(pathname: string) {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

export function matchRoute(pathname: string): AppRoute {
  const path = normalizePath(pathname);
  if (path === '/') return { name: 'dashboard' };
  if (path === '/qctt-plans') return { name: 'qctt-plans' };
  const planMatch = path.match(/^\/qctt-plans\/([^/]+)$/);
  if (planMatch?.[1]) return { name: 'qctt-plan-detail', id: decodeURIComponent(planMatch[1]) };
  if (path === '/catalogs/qctt') return { name: 'qctt-catalog' };
  if (path === '/directory') return { name: 'directory' };
  if (path === '/bookings') return { name: 'bookings' };
  if (path === '/contracts') return { name: 'contracts' };
  if (path === '/contracts/new') return { name: 'contract-new', owned: false };
  if (path === '/contracts/owned/new') return { name: 'contract-new', owned: true };
  const contractEditMatch = path.match(/^\/contracts\/([^/]+)\/edit$/);
  if (contractEditMatch?.[1]) return { name: 'contract-edit', id: decodeURIComponent(contractEditMatch[1]) };
  const contractMatch = path.match(/^\/contracts\/([^/]+)$/);
  if (contractMatch?.[1]) return { name: 'contract-detail', id: decodeURIComponent(contractMatch[1]) };
  if (path === '/campaigns') return { name: 'campaigns' };
  if (path === '/campaigns/new') return { name: 'campaign-new' };
  if (path === '/materials') return { name: 'materials' };
  if (path === '/materials/new') return { name: 'material-new' };
  const materialEditMatch = path.match(/^\/materials\/([^/]+)\/edit$/);
  if (materialEditMatch?.[1]) return { name: 'material-edit', id: decodeURIComponent(materialEditMatch[1]) };
  if (path === '/admin/system') return { name: 'admin-system' };
  if (path === '/admin/accounts') return { name: 'admin-accounts' };
  if (path === '/admin/access') return { name: 'admin-access' };
  if (path === '/admin/workflow') return { name: 'admin-workflow' };
  if (path === '/my-work') return { name: 'my-work' };

  const editMatch = path.match(/^\/campaigns\/([^/]+)\/edit$/);
  if (editMatch?.[1]) return { name: 'campaign-edit', id: decodeURIComponent(editMatch[1]) };

  const detailMatch = path.match(/^\/campaigns\/([^/]+)$/);
  if (detailMatch?.[1]) return { name: 'campaign-detail', id: decodeURIComponent(detailMatch[1]) };

  return { name: 'not-found' };
}

export function campaignDetailPath(id: string) {
  return `/campaigns/${encodeURIComponent(id)}`;
}

export function contractNewPath({ owned = false, draftId, activityCode }: { owned?: boolean; draftId?: string; activityCode?: string } = {}) {
  const base = owned ? '/contracts/owned/new' : '/contracts/new';
  const query = new URLSearchParams();
  if (activityCode) query.set('activity', activityCode);
  if (draftId) query.set('draft', draftId);
  return query.size ? `${base}?${query}` : base;
}

export function contractEditPath(id: string, requestId?: string) {
  const path = `/contracts/${encodeURIComponent(id)}/edit`;
  return requestId ? `${path}?request=${encodeURIComponent(requestId)}` : path;
}

export function campaignEditPath(id: string) {
  return `${campaignDetailPath(id)}/edit`;
}

export function navigate(path: string, replace = false, skipGuard = false) {
  if (!skipGuard && pendingNavigationGuards.size) {
    void pendingNavigationGuard().then((saved) => { if (saved) navigate(path, replace, true); });
    return false;
  }
  if (!skipGuard && !confirmUnsavedNavigation()) return false;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  acceptNextPopState = true;
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}

export function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const previousUrl = useRef(window.location.pathname + window.location.search);

  useEffect(() => {
    const handleChange = () => {
      const next = window.location.pathname;
      if (acceptNextPopState) {
        acceptNextPopState = false;
        previousUrl.current = window.location.pathname + window.location.search;
        setPathname(next);
        return;
      }
      if (next !== pathname && pendingNavigationGuards.size) {
        const destination = window.location.pathname + window.location.search;
        window.history.pushState(null, '', previousUrl.current);
        void pendingNavigationGuard().then((saved) => { if (saved) navigate(destination, false, true); });
        return;
      }
      if (next !== pathname && !confirmUnsavedNavigation()) {
        window.history.pushState(null, '', previousUrl.current);
        return;
      }
      previousUrl.current = window.location.pathname + window.location.search;
      setPathname(next);
    };
    window.addEventListener('popstate', handleChange);
    return () => window.removeEventListener('popstate', handleChange);
  }, [pathname]);

  return pathname;
}

type AppLinkProps = PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }>;

export function AppLink({ to, onClick, children, ...props }: AppLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;
    event.preventDefault();
    navigate(to);
  };

  return <a href={to} onClick={handleClick} {...props}>{children}</a>;
}
