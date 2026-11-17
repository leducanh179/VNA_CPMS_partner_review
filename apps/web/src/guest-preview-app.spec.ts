import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignTimeline } from './components/campaign-table';

describe('Campaign timeline approval palette', () => {
  it('uses Campaign status for Timeline even when approval status differs', () => {
    const campaigns = [
      { id: '113ad11f-9c8d-4780-b045-91050e621f51', code: 'CPG-01', name: 'Synthetic approved campaign', startDate: '2026-10-01', endDate: '2026-10-31', lifecycleState: 'PLANNING' as const, qcttStatus: 'Đã lên kế hoạch', approvalStatus: 'Đã duyệt' },
      { id: '223ad11f-9c8d-4780-b045-91050e621f51', code: 'CPG-02', name: 'Synthetic pending campaign', startDate: '2026-11-01', endDate: '2026-11-30', lifecycleState: 'RUNNING' as const, qcttStatus: 'Đang triển khai', approvalStatus: 'Chờ duyệt' },
    ];
    const markup = renderToStaticMarkup(createElement(CampaignTimeline, { campaigns }));
    expect(markup).toContain('border-cyan-400 bg-cyan-100');
    expect(markup).toContain('border-blue-400 bg-blue-100');
    expect(markup).not.toContain('bg-emerald-500');
    expect(markup).toContain('/campaigns/113ad11f-9c8d-4780-b045-91050e621f51');
  });
});
