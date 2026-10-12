import type { RoleCode } from './roles';

export interface ActorContext {
  id: string;
  key: string;
  displayName: string;
  roles: readonly RoleCode[];
  session?: {
    id: string;
    originalActorId: string;
    mode: 'DIRECT' | 'DEMO_IMPERSONATION' | 'ADMIN_ASSIST';
    authzVersion: number;
    mustChangePassword: boolean;
  };
}

export const DEMO_ACTOR = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'demo-superuser',
  displayName: 'Demo Superuser',
  roles: ['ADMIN'],
} as const satisfies ActorContext;
