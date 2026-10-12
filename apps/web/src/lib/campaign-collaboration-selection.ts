import type { CampaignSummary } from '@cpms/domain';

export type CampaignCollaborationSelection =
  | { kind: 'empty'; campaign: null; count: 0 }
  | { kind: 'single'; campaign: CampaignSummary; count: 1 }
  | { kind: 'multiple'; campaign: null; count: number }
  | { kind: 'invalid'; campaign: null; count: 1 };

export function resolveCampaignCollaborationSelection(
  campaigns: readonly CampaignSummary[],
  selectedCampaignIds: readonly string[],
): CampaignCollaborationSelection {
  const uniqueIds = [...new Set(selectedCampaignIds)];
  if (!uniqueIds.length) return { kind: 'empty', campaign: null, count: 0 };
  if (uniqueIds.length > 1) return { kind: 'multiple', campaign: null, count: uniqueIds.length };
  const campaign = campaigns.find((item) => item.id === uniqueIds[0]);
  return campaign && !campaign.isDeleted
    ? { kind: 'single', campaign, count: 1 }
    : { kind: 'invalid', campaign: null, count: 1 };
}

export function campaignCollaborationSelectionMessage(selection: CampaignCollaborationSelection) {
  if (selection.kind === 'multiple') {
    return `Đã chọn ${selection.count} Chiến dịch. Vui lòng chỉ giữ lại một Chiến dịch để trao đổi.`;
  }
  return 'Chọn một Chiến dịch trong bảng để xem Bình luận và Nhật ký.';
}

export interface LatestRequestGuard {
  next(): number;
  isCurrent(requestId: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let current = 0;
  return {
    next: () => { current += 1; return current; },
    isCurrent: (requestId) => requestId === current,
    invalidate: () => { current += 1; },
  };
}
