import type { ActorContext } from '@cpms/domain';
import type { AccessApplicationService } from './access.application-service';

/** Application-method boundary, not an HTTP-only guard. Importers and CLI commands enter the same fence. */
export function AccessBoundary(actorArgument?: number): MethodDecorator {
  return (_target, _name, descriptor: PropertyDescriptor) => {
    const operation = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = function (this: { access: AccessApplicationService }, ...args: unknown[]) {
      const actor = actorArgument === undefined ? undefined : args[actorArgument] as ActorContext | undefined;
      return this.access.run(actor, () => operation.apply(this, args));
    };
  };
}
