import type { AccessPermission } from '@cpms/domain';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { requestJson } from './lib/api';

const AccessContext = createContext<Partial<Record<AccessPermission, boolean>>>({});
export function AccessCapabilitiesProvider({ children }: PropsWithChildren) {
  const [permissions, setPermissions] = useState<Partial<Record<AccessPermission, boolean>>>({});
  useEffect(() => {
    let active = true; let request = 0; let policyVersion: number | null = null;
    const load = async () => { const current = ++request; try { const data = await requestJson<{ policyVersion: number; permissions: Partial<Record<AccessPermission, boolean>> }>('/access/capabilities'); if (active && request === current) {
      setPermissions(data.permissions);
      if (policyVersion !== null && policyVersion !== data.policyVersion) window.dispatchEvent(new Event('cpms:policy-version-changed'));
      policyVersion = data.policyVersion;
    } } catch { if (active && request === current) setPermissions({}); } };
    const refresh = () => { void load(); }; refresh();
    window.addEventListener('focus', refresh); window.addEventListener('cpms:access-updated', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener('cpms:access-updated', refresh); };
  }, []);
  return <AccessContext.Provider value={permissions}>{children}</AccessContext.Provider>;
}
export function useAccessCapabilities() { return useContext(AccessContext); }
