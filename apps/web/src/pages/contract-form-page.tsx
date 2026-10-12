import { isOwnedChannel, type ChannelActivity, type ChannelMapCatalog, type ContractChangeRequest, type ContractManagementWorkspace } from '@cpms/domain';
import { Button, LoadingBlock } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth-context';
import { useAccessCapabilities } from '../access-context';
import { ContractEditor } from '../components/contract-management';
import { requestJson } from '../lib/api';
import { contractEditPath, navigate } from '../lib/router';

export function ContractFormPage({ id, owned = false }: { id?: string; owned?: boolean }) {
  const { me } = useAuth();
  const capabilities = useAccessCapabilities();
  const query = new URLSearchParams(window.location.search);
  const draftId = query.get('draft') ?? undefined;
  const activityCode = query.get('activity');
  const requestId = query.get('request');
  const [workspace, setWorkspace] = useState<ContractManagementWorkspace | null>(null);
  const [activity, setActivity] = useState<ChannelActivity | null>(null);
  const [loading, setLoading] = useState(Boolean(id || activityCode));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (id) {
      void requestJson<ContractManagementWorkspace>(`/contracts/${encodeURIComponent(id)}/management`)
        .then(value => { if (active) setWorkspace(value); })
        .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Không mở được hồ sơ.'); })
        .finally(() => { if (active) setLoading(false); });
    } else if (activityCode && owned) {
      void requestJson<ChannelMapCatalog>('/contracts/channel-map')
        .then(value => {
          if (!active) return;
          const found = value.data?.activities.find(row => row.code === activityCode && row.supplyType === 'INTERNAL');
          if (found) setActivity(found);
          else setError('Hoạt động không còn trong danh mục kênh sở hữu.');
        })
        .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Không tải được danh mục hoạt động.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [id, activityCode, owned]);

  const returnPath = id ? `/contracts/${encodeURIComponent(id)}?info=1` : owned ? '/contracts?type=owned' : '/contracts';
  if (loading) return <LoadingBlock label="Đang mở form hợp đồng…" />;
  if (!id && !capabilities['contract.create']) return <div role="alert" className="mx-auto max-w-4xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Bạn không có quyền tạo hồ sơ nguồn cung.<Button className="ml-3" variant="secondary" onClick={() => navigate(owned ? '/contracts?type=owned' : '/contracts')}>Về danh sách</Button></div>;
  if (error) return <div role="alert" className="mx-auto max-w-4xl rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{error}<Button className="ml-3" variant="secondary" onClick={() => navigate(returnPath)}>Quay lại</Button></div>;
  if (id && !workspace) return null;
  if (activityCode && owned && !activity) return null;

  const request: ContractChangeRequest | undefined = requestId ? workspace?.requests.find(row => row.id === requestId) : undefined;
  if (id && (!workspace?.capabilities.edit || workspace.requests.some(row => row.state === 'PENDING') && !request || requestId && (!request || request.requesterActorId !== me.account.id || !['DRAFT', 'RETURNED', 'WITHDRAWN'].includes(request.state)))) {
    return <div role="alert" className="mx-auto max-w-4xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Hồ sơ này chưa thể sửa. Hãy xử lý đề nghị đang chờ hoặc kiểm tra quyền truy cập.<Button className="ml-3" variant="secondary" onClick={() => navigate(returnPath)}>Về hồ sơ</Button></div>;
  }
  const isOwned = owned || Boolean(workspace && isOwnedChannel(workspace.contract));
  return <ContractEditor
    {...(workspace ? { workspace } : {})}
    {...(request ? { request } : {})}
    {...(activity ? { ownedActivity: activity } : {})}
    {...(!id && owned && !activity ? { newOwned: true } : {})}
    {...(draftId ? { draftId } : {})}
    onClose={() => navigate(returnPath, false, true)}
    onSaved={(contractId, mode) => navigate(!id && mode === 'DRAFT' ? contractEditPath(contractId) : `/contracts/${encodeURIComponent(contractId)}?info=1`, false, true)}
    returnLabel={id ? 'Về hồ sơ' : isOwned ? 'Về Kênh sở hữu' : 'Về danh sách'}
  />;
}
