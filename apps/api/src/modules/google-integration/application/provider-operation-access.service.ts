import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccessPermission, AccessResource } from '@cpms/domain';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { AccessApplicationService } from '../../access/application/access.application-service';

type ProviderPermission = Extract<AccessPermission, `campaign.drive.${string}` | `campaign.sheets.${string}` | `google.${string}` | 'campaign.purge' | 'campaign.create' | 'campaign.delete' | 'campaign.restore' | 'campaign.approve' | 'system.manage'>;
const readPermissions: readonly ProviderPermission[] = ['campaign.drive.read', 'campaign.sheets.read', 'campaign.purge'];
interface ProviderContext { permission: ProviderPermission; resource?: AccessResource; actorId: string; sessionId: string | undefined }

/** Short-lived server command context. It never contains a provider token. */
@Injectable()
export class ProviderOperationAccessService {
  private readonly context = new AsyncLocalStorage<ProviderContext>();
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}
  writesEnabled() { return this.config.get('GOOGLE_PROVIDER_WRITES', { infer: true }) === 'ENABLED'; }
  driveWritesEnabled() { return this.config.get('GOOGLE_DRIVE_WRITES', { infer: true }) === 'ENABLED'; }
  private operationWritesEnabled(permission: ProviderPermission) {
    // A direct administrator may establish or revoke OAuth before Drive file writes are enabled.
    // Guarded Drive file ports never accept system.manage as authorization for a file operation.
    if (permission === 'system.manage') return true;
    return permission.startsWith('campaign.drive.') || ['campaign.create', 'campaign.delete', 'campaign.restore', 'campaign.approve', 'campaign.purge'].includes(permission)
      ? this.driveWritesEnabled() : this.writesEnabled();
  }
  execute<T>(permission: ProviderPermission, resource: AccessResource | undefined, operation: () => T): T {
    this.access.require(permission, resource);
    if (!readPermissions.includes(permission) && !this.operationWritesEnabled(permission)) throw new ForbiddenException({ code: 'PROVIDER_WRITES_BLOCKED', message: 'Thao tác ghi Google đang tắt trong cấu hình chạy hiện tại.' });
    const actor = this.access.snapshot().actor;
    return this.context.run({ permission, ...(resource ? { resource } : {}), actorId: actor.id, sessionId: actor.session?.id }, operation);
  }
  assert(allowed?: readonly ProviderPermission[]) {
    const context = this.context.getStore(); const actor = this.access.snapshot().actor;
    if (!context || context.actorId !== actor.id || context.sessionId !== actor.session?.id || (allowed && !allowed.includes(context.permission))) {
      throw new ForbiddenException('Thao tác provider không có quyền và phạm vi của lệnh hiện hành.');
    }
    this.access.require(context.permission, context.resource);
    if (!readPermissions.includes(context.permission) && !this.operationWritesEnabled(context.permission)) throw new ForbiddenException('Thao tác ghi Google đang tắt.');
    return context;
  }
}
