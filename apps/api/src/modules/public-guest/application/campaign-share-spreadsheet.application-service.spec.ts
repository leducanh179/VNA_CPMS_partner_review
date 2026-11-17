import { defaultCampaignShare, type ActorContext, type SharedCampaign } from '@cpms/domain';
import type { CloudManagedSpreadsheetPort } from '@cpms/integrations';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import type { GoogleIntegrationApplicationService } from '../../google-integration/application/google-integration.application-service';
import type { ProviderOperationAccessService } from '../../google-integration/application/provider-operation-access.service';
import { CampaignShareSpreadsheetApplicationService } from './campaign-share-spreadsheet.application-service';
import type { CampaignSharingApplicationService } from './campaign-sharing.application-service';
import type { CampaignShareSpreadsheetRecord, CampaignSharingRepository } from './campaign-sharing.repository';

const id = '113ad11f-9c8d-4780-b045-91050e621f51';
const actor = { id: 'admin' } as ActorContext;

function fixture() {
  const settings = { ...defaultCampaignShare(), version: 2 };
  settings.mode = 'PUBLIC';
  const publicView = vi.fn(async (): Promise<SharedCampaign> => ({
    id, code: 'CPG-QA', name: 'Chiến dịch kiểm thử', audience: 'PUBLIC', tabs: ['documents'],
    documents: { driveUrl: null, materials: [{ id: 'MTR-QA', title: 'Tài liệu QA', type: 'PDF', url: 'https://example.test/document' }] },
  }));
  const sharing = { settings: async () => settings, publicView } as unknown as CampaignSharingApplicationService;
  let stored: CampaignShareSpreadsheetRecord | null = null;
  const saveSpreadsheet = vi.fn(async (_id: string, value: CampaignShareSpreadsheetRecord) => { stored = value; });
  const repository = { spreadsheet: async () => stored, saveSpreadsheet } as unknown as CampaignSharingRepository;
  const access = { run: (_actor: unknown, operation: () => unknown) => operation(), campaign: async () => ({}), check: () => ({ allowed: true }) } as unknown as AccessApplicationService;
  const provider = { driveWritesEnabled: () => true, execute: (_permission: string, _resource: unknown, operation: () => unknown) => operation() } as unknown as ProviderOperationAccessService;
  const google = { driveStatus: async () => ({ connected: true }),
    withDriveAccessToken: (_actor: unknown, operation: (token: string) => unknown) => operation('fixture') } as unknown as GoogleIntegrationApplicationService;
  const port = {
    replaceManagedSpreadsheet: vi.fn<CloudManagedSpreadsheetPort['replaceManagedSpreadsheet']>(async () => 'sheet-id'),
    grantSpreadsheetViewer: vi.fn<CloudManagedSpreadsheetPort['grantSpreadsheetViewer']>(async () => undefined),
  };
  const config = { get: () => 'https://example.test' } as never;
  const service = new CampaignShareSpreadsheetApplicationService(sharing, repository, access, provider, google, port, config);
  return { service, settings, publicView, port, saveSpreadsheet };
}

describe('Campaign Public spreadsheet export', () => {
  it('writes only the public projection, reuses the link and grants only the supplied viewer', async () => {
    const { service, port, saveSpreadsheet } = fixture();
    const first = await service.publish(id, 2, actor);
    const second = await service.publish(id, 2, actor, 'viewer@example.test');
    expect(second.url).toBe(first.url);
    expect(port.replaceManagedSpreadsheet.mock.calls[0]?.[0]).toMatchObject({ spreadsheetId: null,
      sheets: [{ name: 'Tư liệu', rows: [['Mã tư liệu', 'Tiêu đề', 'Loại', 'Liên kết'], ['MTR-QA', 'Tài liệu QA', 'PDF', 'https://example.test/document']] }] });
    expect(port.replaceManagedSpreadsheet.mock.calls[1]?.[0].spreadsheetId).toBe('sheet-id');
    expect(port.grantSpreadsheetViewer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ spreadsheetId: 'sheet-id', email: 'viewer@example.test' }));
    expect(saveSpreadsheet).toHaveBeenCalledTimes(2);
  });

  it('blocks stale or restricted settings before loading content or making provider calls', async () => {
    const { service, settings, publicView, port } = fixture();
    await expect(service.publish(id, 1, actor)).rejects.toMatchObject({ status: 409 });
    settings.mode = 'RESTRICTED';
    await expect(service.publish(id, 2, actor)).rejects.toMatchObject({ status: 400 });
    expect(publicView).not.toHaveBeenCalled();
    expect(port.replaceManagedSpreadsheet).not.toHaveBeenCalled();
  });
});
