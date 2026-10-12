import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { createCampaignWorkspaceStore, type CampaignWorkspaceStore } from './lib/campaign-workspace';
import { hasUnsavedChanges } from './lib/unsaved-changes';

const CampaignStoreContext = createContext<CampaignWorkspaceStore | null>(null);

export function CampaignProvider({ children }: PropsWithChildren) {
  const storeRef = useRef<CampaignWorkspaceStore | null>(null);
  if (!storeRef.current) storeRef.current = createCampaignWorkspaceStore();

  useEffect(() => {
    void storeRef.current?.load();
    // A policy/assignment change refreshes visibility as well as button capabilities. Keep an active draft until its owner saves/cancels.
    const refresh = () => { if (!hasUnsavedChanges()) void storeRef.current?.reloadAccess(); };
    window.addEventListener('cpms:policy-version-changed', refresh); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('cpms:policy-version-changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  return <CampaignStoreContext.Provider value={storeRef.current}>{children}</CampaignStoreContext.Provider>;
}

export function useCampaignWorkspace() {
  const store = useContext(CampaignStoreContext);
  if (!store) throw new Error('useCampaignWorkspace must be used inside CampaignProvider.');
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return { store, snapshot };
}
