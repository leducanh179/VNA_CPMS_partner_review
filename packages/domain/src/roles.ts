export const ROLE_CODES = [
  'VIEWER',
  'REQUESTER',
  'CAMPAIGN_MANAGER',
  'CONTRACT_MANAGER',
  'CAMPAIGN_REQUESTER',
  'COMM_CAMPAIGN_MANAGER',
  'COMM_CONTRACT_MANAGER',
  'SLOT_OPERATOR',
  'VENDOR',
  'LEADER',
  'DIVISION_LEADER',
  'DEPARTMENT_LEADER',
  'CORPORATE_LEADER',
  'ADMIN',
  'GUEST',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSIONS = [
  'campaign.read',
  'campaign.public.read',
  'campaign.create',
  'campaign.update',
  'campaign.approve',
  'campaign.delete',
  'campaign.restore',
  'campaign.comment',
  'campaign.journal.read',
  'contract.manage',
  'slot.operate',
  'system.manage',
  'ai.contract.configure',
  'material.read',
  'material.public.read',
  'material.create',
  'material.update',
  'material.approve',
  'material.publish',
  'material.delete',
  'material.restore',
  'material.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionGrant = Permission | '*';

export const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionGrant[]>> = {
  VIEWER: ['campaign.read', 'campaign.journal.read', 'material.read'],
  REQUESTER: ['campaign.read', 'campaign.comment', 'campaign.journal.read', 'material.read'],
  CAMPAIGN_MANAGER: ['campaign.read', 'campaign.create', 'campaign.update', 'campaign.comment', 'campaign.journal.read', 'material.read', 'material.create', 'material.update', 'material.delete', 'material.restore', 'material.publish'],
  CONTRACT_MANAGER: ['campaign.read', 'campaign.journal.read', 'contract.manage', 'material.read', 'material.create', 'material.update', 'material.delete', 'material.restore', 'material.publish', 'material.manage'],
  CAMPAIGN_REQUESTER: ['campaign.read', 'campaign.create', 'campaign.update', 'campaign.comment', 'campaign.journal.read', 'material.read'],
  COMM_CAMPAIGN_MANAGER: [
    'campaign.read',
    'campaign.create',
    'campaign.update',
    'campaign.delete',
    'campaign.restore',
    'campaign.comment',
    'campaign.journal.read',
    'material.read',
    'material.create',
    'material.update',
    'material.delete',
    'material.restore',
    'material.publish',
  ],
  COMM_CONTRACT_MANAGER: ['campaign.read', 'campaign.journal.read', 'contract.manage', 'material.read', 'material.create', 'material.update', 'material.delete', 'material.restore', 'material.publish', 'material.manage'],
  SLOT_OPERATOR: ['campaign.read', 'campaign.journal.read', 'slot.operate', 'material.read', 'material.create', 'material.update', 'material.publish'],
  VENDOR: ['campaign.read', 'campaign.create', 'campaign.update', 'campaign.comment', 'campaign.journal.read', 'slot.operate', 'material.read', 'material.create', 'material.update', 'material.delete', 'material.restore'],
  LEADER: ['campaign.read', 'campaign.approve', 'campaign.delete', 'campaign.restore', 'campaign.comment', 'campaign.journal.read', 'material.read', 'material.approve'],
  DIVISION_LEADER: [],
  DEPARTMENT_LEADER: [],
  CORPORATE_LEADER: [],
  ADMIN: ['*'],
  GUEST: ['campaign.public.read', 'material.public.read'],
};

export function hasPermission(roles: readonly RoleCode[], permission: Permission): boolean {
  if (['material.read', 'material.create', 'material.update'].includes(permission) && roles.some((role) => role !== 'GUEST')) return true;
  return roles.some((role) => {
    const grants = ROLE_PERMISSIONS[role];
    return grants.includes('*') || grants.includes(permission);
  });
}
