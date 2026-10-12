import type { ActorContext } from '@cpms/domain';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { AccessApplicationService } from '../access/application/access.application-service';
import { AccessBoundary } from '../access/application/access-boundary';

export abstract class SystemRepository { abstract checkDatabase(): Promise<void>; }

@Injectable()
export class SystemApplicationService {
  constructor(@Inject(SystemRepository) private readonly repository: SystemRepository,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) {}
  @AccessBoundary(0)
  async status(actor: ActorContext) {
    this.access.require('system.manage');
    await this.repository.checkDatabase();
    return { service: 'cpms-api', version: '0.1.0', status: 'ok',
      database: { status: 'connected', engine: 'postgresql', runtime: this.config.get('DB_RUNTIME', { infer: true }) },
      auth: { mode: this.config.get('AUTH_MODE', { infer: true }), actor: { id: actor.id, key: actor.key, displayName: actor.displayName, roles: actor.roles } },
      ai: { mode: this.config.get('AI_MODE', { infer: true }), provider: 'none' }, checkedAt: new Date().toISOString() };
  }
}
