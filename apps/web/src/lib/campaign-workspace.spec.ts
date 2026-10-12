import type { CampaignSummary } from '@cpms/domain';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignTable } from '../components/campaign-table';
import { CAMPAIGN_LIST_PATH } from './api';
import {
  createCampaignWorkspaceStore,
  selectCockpitCampaigns,
  selectDashboardMetrics,
  selectRecentCampaigns,
  type CampaignGateway,
} from './campaign-workspace';
import { campaignDetailPath, matchRoute } from './router';

const firstCampaign: CampaignSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  code: 'CPG-202608-DEMO',
  name: 'Campaign demo',
  requestingUnit: 'Ban Truyền thông',
  lifecycleState: 'DRAFT',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-09-30T00:00:00.000Z',
  effectiveStartDate: null,
  effectiveEndDate: null,
  levelCode: null,
  levelLabel: null,
  levelRuleDescription: null,
  requestingEmployeeCode: null,
  requestingEmployeeName: null,
  manualRequesterEmail: null,
  primaryObjectiveCode: null,
  primaryObjectiveLabel: null,
  primaryObjectiveOther: null,
  kpiText: null,
  descriptionRichText: null,
  additionalInformation: [],
  dataSchemaVersion: 1,
  normalizationStatus: 'NEEDS_NORMALIZATION',
  normalizationWarnings: [],
  markets: [], provinces: [],
  requestingUnits: [],
  fieldValues: {},
  recordVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedByActorId: null,
  updatedAt: '2026-08-30T00:00:00.000Z',
};

function createGateway() {
  const created: CampaignSummary = {
    ...firstCampaign,
    id: '10000000-0000-4000-8000-000000000004',
    code: 'CPG-202608-NEW1',
    name: 'Campaign mới',
    updatedAt: '2026-08-31T00:00:00.000Z',
  };
  let listCalls = 0;
  const gateway: CampaignGateway = {
    async list() {
      listCalls += 1;
      return [firstCampaign];
    },
    async get() {
      return firstCampaign;
    },
    async create() {
      return created;
    },
    async update() {
      return created;
    },
    async batchSave() {
      return { ok: true, total: 1, succeeded: 1, failed: 0, items: [{ clientKey: 'row-1', ok: true, campaign: created }] };
    },
    async bulkTransition() {
      return { ok: true, total: 1, succeeded: 1, failed: 0, items: [{ clientKey: created.id, id: created.id, ok: true, campaign: created }] };
    },
    async moveToTrash() {
      return { ...created, isDeleted: true, deletedAt: '2026-09-01T00:00:00.000Z' };
    },
    async restore() {
      return { ...created, isDeleted: false, deletedAt: null };
    },
    async deletePermanently(id: string) {
      return { id, code: created.code, permanentlyDeleted: true };
    },
  };
  return { gateway, getListCalls: () => listCalls };
}

describe('Campaign workspace integration', () => {
  it('cannot resurrect a revoked Campaign from an earlier list or detail response', async () => {
    const fixture = createGateway();
    let finishList!: (rows: CampaignSummary[]) => void;
    let finishDetail!: (row: CampaignSummary) => void;
    let calls = 0;
    const store = createCampaignWorkspaceStore({ ...fixture.gateway,
      list: async () => ++calls === 1 ? new Promise<CampaignSummary[]>((resolve) => { finishList = resolve; }) : [],
      get: async () => new Promise<CampaignSummary>((resolve) => { finishDetail = resolve; }),
    });
    const oldList = store.load();
    const oldDetail = store.loadOne(firstCampaign.id);
    const rejected = expect(oldDetail).rejects.toThrow('Quyền đã thay đổi');
    await store.reloadAccess();
    finishList([firstCampaign]); finishDetail(firstCampaign);
    await oldList; await rejected;
    expect(store.snapshot()).toMatchObject({ campaigns: [], trashCampaigns: [], loading: false });
  });

  it('refreshes detail capabilities and removes cached rows when access refresh fails', async () => {
    const fixture = createGateway(); let revoked = false;
    const refreshed = { ...firstCampaign, recordVersion: firstCampaign.recordVersion + 1 };
    const store = createCampaignWorkspaceStore({ ...fixture.gateway,
      list: async () => { if (revoked) throw new Error('Session expired'); return [firstCampaign]; },
      get: async () => refreshed,
    });
    await store.load(); await store.loadTrash();
    expect(await store.loadOne(firstCampaign.id, true)).toBe(refreshed);
    expect(store.snapshot().campaigns[0]).toBe(refreshed);
    revoked = true; await store.reloadAccess();
    expect(store.snapshot()).toMatchObject({ campaigns: [], trashCampaigns: [], error: 'Session expired' });
  });

  it('uses one canonical Campaign API list for both Dashboard and Campaign Cockpit', async () => {
    const fixture = createGateway();
    const store = createCampaignWorkspaceStore(fixture.gateway);

    await Promise.all([store.load(), store.load()]);

    expect(CAMPAIGN_LIST_PATH).toBe('/campaigns');
    expect(fixture.getListCalls()).toBe(1);
    expect(selectRecentCampaigns(store.snapshot())[0]).toBe(selectCockpitCampaigns(store.snapshot())[0]);
  });

  it('renders every recent Campaign link to the matching detail route', () => {
    const markup = renderToStaticMarkup(createElement(CampaignTable, { campaigns: [firstCampaign] }));
    const target = campaignDetailPath(firstCampaign.id);

    expect(markup).toContain(`href="${target}"`);
    expect(matchRoute(target)).toEqual({ name: 'campaign-detail', id: firstCampaign.id });
  });

  it('routes the dedicated Material create form back into the existing module', () => {
    expect(matchRoute('/materials')).toEqual({ name: 'materials' });
    expect(matchRoute('/materials/new')).toEqual({ name: 'material-new' });
  });

  it('updates Dashboard metrics and Campaign Cockpit from the same store after create', async () => {
    const fixture = createGateway();
    const store = createCampaignWorkspaceStore(fixture.gateway);
    await store.load();
    expect(selectDashboardMetrics(store.snapshot()).total).toBe(1);
    expect(selectCockpitCampaigns(store.snapshot())).toHaveLength(1);

    await store.create({ name: 'Campaign mới', requestingUnit: 'Ban TT' });

    expect(selectDashboardMetrics(store.snapshot()).total).toBe(2);
    expect(selectCockpitCampaigns(store.snapshot())).toHaveLength(2);
    expect(fixture.getListCalls()).toBe(1);
  });

  it('absorbs a short API warm-up window on the initial list load', async () => {
    const fixture = createGateway();
    let attempts = 0;
    const gateway: CampaignGateway = {
      ...fixture.gateway,
      async list() {
        attempts += 1;
        if (attempts < 3) throw new Error('API is starting.');
        return [firstCampaign];
      },
    };
    const store = createCampaignWorkspaceStore(gateway);

    await store.load();

    expect(attempts).toBe(3);
    expect(store.snapshot()).toMatchObject({ initialized: true, loading: false, error: null });
    expect(store.snapshot().campaigns).toHaveLength(1);
  });
});
