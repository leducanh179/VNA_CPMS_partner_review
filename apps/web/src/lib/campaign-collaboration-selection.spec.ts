import type { CampaignSummary } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import {
  campaignCollaborationSelectionMessage,
  createLatestRequestGuard,
  resolveCampaignCollaborationSelection,
} from './campaign-collaboration-selection';

const campaign = (id: string, code: string, isDeleted = false) => ({
  id,
  code,
  name: `Chiến dịch ${code}`,
  isDeleted,
} as CampaignSummary);

const campaignA = campaign('10000000-0000-4000-8000-000000000001', 'CPG-A');
const campaignB = campaign('10000000-0000-4000-8000-000000000002', 'CPG-B');

describe('Campaign collaboration selection', () => {
  it('returns an empty, non-mutable context when no Campaign is selected', () => {
    const selection = resolveCampaignCollaborationSelection([campaignA, campaignB], []);
    expect(selection).toEqual({ kind: 'empty', campaign: null, count: 0 });
    expect(campaignCollaborationSelectionMessage(selection)).toBe('Chọn một Chiến dịch trong bảng để xem Bình luận và Nhật ký.');
  });

  it('resolves exactly one selected Campaign by ID and never by row position or name', () => {
    expect(resolveCampaignCollaborationSelection([campaignA, campaignB], [campaignB.id])).toMatchObject({
      kind: 'single',
      campaign: { id: campaignB.id, code: 'CPG-B' },
    });
  });

  it('blocks a multi-selection, then resolves the one remaining Campaign and finally clears it', () => {
    const multiple = resolveCampaignCollaborationSelection([campaignA, campaignB], [campaignA.id, campaignB.id]);
    expect(multiple).toMatchObject({ kind: 'multiple', count: 2, campaign: null });
    expect(campaignCollaborationSelectionMessage(multiple)).toBe('Đã chọn 2 Chiến dịch. Vui lòng chỉ giữ lại một Chiến dịch để trao đổi.');
    expect(resolveCampaignCollaborationSelection([campaignA, campaignB], [campaignB.id])).toMatchObject({ kind: 'single', campaign: { id: campaignB.id } });
    expect(resolveCampaignCollaborationSelection([campaignA, campaignB], [])).toMatchObject({ kind: 'empty', campaign: null });
  });

  it('treats a missing or trashed selected ID as invalid and safe to clear', () => {
    expect(resolveCampaignCollaborationSelection([campaignA], [campaignB.id])).toMatchObject({ kind: 'invalid', campaign: null });
    expect(resolveCampaignCollaborationSelection([campaign('trash', 'CPG-T', true)], ['trash'])).toMatchObject({ kind: 'invalid', campaign: null });
  });

  it('accepts only the latest request when selection changes from A to B', () => {
    const guard = createLatestRequestGuard();
    const requestA = guard.next();
    const requestB = guard.next();
    expect(guard.isCurrent(requestA)).toBe(false);
    expect(guard.isCurrent(requestB)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(requestB)).toBe(false);
  });
});
