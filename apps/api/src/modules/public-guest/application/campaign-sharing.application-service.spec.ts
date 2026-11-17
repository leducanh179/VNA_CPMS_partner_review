import { defaultCampaignShare, type ActorContext, type CampaignSummary } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import type { CampaignWorkflowApplicationService } from '../../campaign-workflow/application/campaign-workflow.application-service';
import type { MaterialSharingApplicationService } from '../../material/application/material-sharing.application-service';
import { CampaignSharingApplicationService } from './campaign-sharing.application-service';
import type { CampaignSharingRepository } from './campaign-sharing.repository';
import type { PublicGuestRepository } from './public-guest.repository';

const id = '113ad11f-9c8d-4780-b045-91050e621f51';
const actor = { id: 'viewer', session: { id: 'signed-in' } } as ActorContext;

function setup(mode = defaultCampaignShare()['mode'], approver = false) {
  const settings = { ...defaultCampaignShare(), mode };
  const subject = vi.fn(async () => ({ ownerId: 'owner', settings }));
  const save = vi.fn(async () => undefined);
  const repository = { subject, save, driveUrl: vi.fn(), materials: vi.fn(async () => []), planning: vi.fn(async () => [
    { id: 'plan-item', activity: 'Hoạt động kiểm thử' },
  ]) } as unknown as CampaignSharingRepository;
  const record = { id, code: 'TEST', name: 'Chiến dịch kiểm thử', approvalStatus: 'Chờ duyệt', markets: [], provinces: [],
    requestingUnits: [], additionalInformation: [{ label: 'Mô tả', value: 'Nội dung kiểm thử' }] } as unknown as CampaignSummary;
  const source = { campaign: vi.fn(async () => record), approval: vi.fn(async () => null) } as unknown as PublicGuestRepository;
  const identity = { mode: 'DIRECT', effectiveActorId: actor.id, effectiveSuperadmin: false };
  const access = {
    run: (_actor: unknown, operation: () => unknown) => operation(), snapshot: () => ({ identity }),
    campaign: async () => ({}), check: (permission: string) => ({ allowed: approver && permission === 'campaign.approve' }),
    canManageCampaignLink: () => identity.effectiveSuperadmin,
  } as unknown as AccessApplicationService;
  const workflow = { read: async () => ({ tasks: [{ eligibility: { allowed: approver } }], assignments: [], capabilities: {} }) } as unknown as CampaignWorkflowApplicationService;
  const materials = { visible: vi.fn(async () => []) } as unknown as MaterialSharingApplicationService;
  return { service: new CampaignSharingApplicationService(repository, source, access, workflow, materials), settings, source, repository, save, identity };
}

describe('Campaign share audiences', () => {
  it('blocks anonymous and ordinary signed-in access to restricted links', async () => {
    const { service, source } = setup();
    await expect(service.publicView(id)).rejects.toMatchObject({ status: 404 });
    await expect(service.signedIn(id, actor)).rejects.toMatchObject({ status: 404 });
    expect(source.campaign).not.toHaveBeenCalled();
  });

  it('gives an eligible workflow approver the restricted selection', async () => {
    const { service, settings, source } = setup('RESTRICTED', true);
    settings.tabs.RESTRICTED = ['information', 'results'];
    const view = await service.signedIn(id, actor);
    expect(view).toMatchObject({ audience: 'RESTRICTED', tabs: ['information', 'results'] });
    expect(view).not.toHaveProperty('approval');
    expect(source.approval).not.toHaveBeenCalled();
  });

  it('uses separate tabs for a logged-in viewer and a guest and never loads unchecked data', async () => {
    const { service, settings, source, repository } = setup('PUBLIC');
    settings.tabs.PUBLIC = ['information'];
    const guest = await service.publicView(id);
    expect(guest).toMatchObject({ audience: 'PUBLIC', tabs: ['information'] });
    expect(guest).not.toHaveProperty('approval');
    expect(guest).not.toHaveProperty('documents');
    expect(guest).not.toHaveProperty('planning');
    expect(source.approval).not.toHaveBeenCalled();
    expect(repository.materials).not.toHaveBeenCalled();
    expect(repository.planning).not.toHaveBeenCalled();
    const account = await service.signedIn(id, actor);
    expect(account.tabs).toEqual(['approval', 'information', 'documents', 'planning']);
    expect(account.planning?.[0]?.activity).toBe('Hoạt động kiểm thử');
  });

  it('gates writes, rejects invalid tabs and versions and applies revocation to existing links', async () => {
    const { service, settings, identity, save } = setup('PUBLIC');
    await expect(service.change(id, settings, actor)).rejects.toMatchObject({ status: 403 });
    identity.effectiveSuperadmin = true;
    await expect(service.change(id, { ...settings, tabs: { ...settings.tabs, PUBLIC: ['unknown'] } }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.change(id, { ...settings, version: 9 }, actor)).rejects.toMatchObject({ status: 409 });
    const saved = await service.change(id, { ...settings, mode: 'ACCOUNTS' }, actor);
    expect(save).toHaveBeenCalledTimes(1);
    Object.assign(settings, saved);
    identity.effectiveSuperadmin = false;
    await expect(service.publicView(id)).rejects.toMatchObject({ status: 404 });
    await expect(service.signedIn(id, actor)).resolves.toMatchObject({ audience: 'ACCOUNTS' });
  });
});
