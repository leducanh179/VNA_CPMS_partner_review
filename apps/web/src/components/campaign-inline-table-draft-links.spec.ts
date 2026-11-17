import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignInlineTable } from './campaign-inline-table';

const draft = {
  id: 'draft-1',
  title: 'Mở đường bay mới Đà Nẵng – Singapore',
  levelCode: null,
  recordVersion: 1,
  updatedAt: '2026-10-24T00:00:00.000Z',
};

function renderDraft(view: 'table' | 'timeline') {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => key === 'cpms.campaign.view-mode.v2.default' ? view : null,
    },
  });
  return renderToStaticMarkup(createElement(CampaignInlineTable, {
    campaigns: [], filterSourceCampaigns: [], columnFiltersEnabled: false, columnFilters: {},
    sortKey: 'campaign_name', sortDirection: 'asc', onSort: vi.fn(),
    onColumnFiltersEnabledChange: vi.fn(), onColumnFiltersChange: vi.fn(),
    onSave: vi.fn(async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, items: [] })),
    formDrafts: [draft],
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('unfinished Campaign form draft links', () => {
  it.each(['table', 'timeline'] as const)('resumes the same draft from its name and code position in %s view', (view) => {
    const markup = renderDraft(view);
    const links = [...markup.matchAll(/<a\b[^>]*href="\/campaigns\/new\?draft=draft-1"[^>]*>(.*?)<\/a>/g)].map(match => match[1]);
    expect(links).toContain('Chưa có mã');
    expect(links).toContain(draft.title);
    expect(links).toContain('Tiếp tục nhập');
  });
});
