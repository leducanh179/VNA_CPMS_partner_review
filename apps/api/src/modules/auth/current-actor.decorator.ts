import type { ActorContext } from '@cpms/domain';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithActor } from './request-with-actor';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext => {
    return context.switchToHttp().getRequest<RequestWithActor>().actor;
  },
);
