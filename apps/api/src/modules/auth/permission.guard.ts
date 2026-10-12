import { hasPermission, type Permission } from '@cpms/domain';
import { ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithActor } from './request-with-actor';

const PERMISSION_KEY = 'cpms:permission';

export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!permission) return true;

    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    // A current local session was resolved by middleware. Each mounted Application Service evaluates
    // the requested resource and changed fields; a global role predicate cannot represent record allows.
    if (actor?.session) return true;
    if (!actor || !hasPermission(actor.roles, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }
}
