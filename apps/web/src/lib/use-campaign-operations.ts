import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from './api';
import type { CampaignOperationsView } from './campaign-operations';

export function useCampaignOperations(campaignId: string) {
  const [view, setView] = useState<CampaignOperationsView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const token = ++epoch.current;
    setLoading(true);
    try {
      const next = await requestJson<CampaignOperationsView>(`/campaign-operations/${encodeURIComponent(campaignId)}`);
      if (token === epoch.current) { setView(next); setError(''); }
    } catch (caught) {
      if (token === epoch.current) {
        setView(null);
        setError(caught instanceof Error ? caught.message : 'Không tải được yêu cầu phê duyệt.');
      }
    } finally { if (token === epoch.current) setLoading(false); }
  }, [campaignId]);
  useEffect(() => {
    setView(null); void load();
    const refresh = () => { void load(); };
    window.addEventListener('cpms:workflow-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      epoch.current++;
      window.removeEventListener('cpms:workflow-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  return { view: view?.campaignId === campaignId ? view : null, error, loading, load };
}
