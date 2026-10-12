import { DEMO_ACTOR } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import { ProviderOperationAccessService } from './provider-operation-access.service';

describe('ProviderOperationAccessService Campaign Drive gate', () => {
  it('enables Campaign Drive and central OAuth without enabling Google Sheets writes', () => {
    const access = { require: () => undefined, snapshot: () => ({ actor: DEMO_ACTOR }) };
    const config = { get: (key: string) => key === 'GOOGLE_DRIVE_WRITES' ? 'ENABLED' : 'BLOCKED' };
    const service = new ProviderOperationAccessService(access as never, config as never);
    expect(service.execute('campaign.drive.ensure', undefined, () => service.assert(['campaign.drive.ensure']).permission)).toBe('campaign.drive.ensure');
    expect(service.execute('system.manage', undefined, () => service.assert(['system.manage']).permission)).toBe('system.manage');
    expect(() => service.execute('campaign.sheets.write', undefined, () => undefined)).toThrow('Thao tác ghi Google đang tắt');
    expect(() => service.execute('google.connect', undefined, () => undefined)).toThrow('Thao tác ghi Google đang tắt');
  });

  it('allows administrator OAuth setup while Drive file writes remain blocked', () => {
    const access = { require: () => undefined, snapshot: () => ({ actor: DEMO_ACTOR }) };
    const config = { get: () => 'BLOCKED' };
    const service = new ProviderOperationAccessService(access as never, config as never);
    expect(service.execute('system.manage', undefined, () => service.assert(['system.manage']).permission)).toBe('system.manage');
    expect(() => service.execute('system.manage', undefined, () => service.assert(['campaign.drive.ensure']))).toThrow('Thao tác provider không có quyền');
    expect(() => service.execute('campaign.drive.ensure', undefined, () => undefined)).toThrow('Thao tác ghi Google đang tắt');
    expect(() => service.execute('campaign.create', undefined, () => undefined)).toThrow('Thao tác ghi Google đang tắt');
  });
});
