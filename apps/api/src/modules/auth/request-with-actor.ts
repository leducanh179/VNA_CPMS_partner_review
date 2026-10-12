import type { ActorContext } from '@cpms/domain';
import type { Request } from 'express';
import type { StoredLocalSession } from '../identity/application/identity.repository';

export interface RequestWithActor extends Request {
  actor: ActorContext;
  localSession?: StoredLocalSession;
}
