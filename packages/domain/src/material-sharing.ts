import type { AccessDecision, AccessIdentity } from './access-policy';

export const MATERIAL_SHARING_MODES = ['SHARED', 'CAMPAIGN', 'RESTRICTED'] as const;
export type MaterialSharingMode = typeof MATERIAL_SHARING_MODES[number] | 'LEGACY';
export type MaterialGrant = { kind: 'ACCOUNT' | 'ORG'; id: string; permission: 'VIEW' | 'EDIT' | 'MANAGE_SHARING' };
export interface MaterialSharing {
  mode: MaterialSharingMode;
  /** Server-recorded identity. Never inferred from imported display names. */
  ownerActorId: string | null;
  campaignIds: string[];
  grants: MaterialGrant[];
}
export interface MaterialCapabilities {
  view: boolean;
  edit: boolean;
  manageSharing: boolean;
  publish: boolean;
  delete: boolean;
  restore: boolean;
  purge: boolean;
}
export const MATERIAL_SHARING_LABELS: Record<MaterialSharingMode, string> = {
  SHARED: 'Dùng chung', CAMPAIGN: 'Theo chiến dịch', RESTRICTED: 'Theo người, nhóm cụ thể',
  LEGACY: 'Phạm vi cũ · Chờ xác nhận',
};
export const legacyMaterialSharing = (): MaterialSharing => ({ mode: 'LEGACY', ownerActorId: null, campaignIds: [], grants: [] });

/** Record allows supplement missing presets, never account/session ceilings or explicit denies. */
export function materialSharingCapabilities(input: {
  sharing: MaterialSharing; deleted: boolean; identity: AccessIdentity;
  decisions: Record<'read' | 'update' | 'manage' | 'publish' | 'delete' | 'restore' | 'systemManage', AccessDecision>;
  readableCampaignIds: ReadonlySet<string>; editableCampaignIds: ReadonlySet<string>;
}): MaterialCapabilities {
  const { sharing, identity, decisions: d, deleted } = input;
  if (!identity.sessionValid || !identity.effectiveActive || !identity.originalActive || !identity.profileComplete)
    return { view: false, edit: false, manageSharing: false, publish: false, delete: false, restore: false, purge: false };
  const ceiling = (decision: AccessDecision) => decision.allowed || decision.reason === 'DEFAULT_DENY';
  const grants = sharing.grants.filter(g => g.kind === 'ACCOUNT' ? g.id === identity.effectiveActorId : identity.orgIds.includes(g.id));
  const owner = sharing.ownerActorId === identity.effectiveActorId;
  const manager = d.manage.allowed;
  const sharingGrant = grants.some(g => g.permission === 'MANAGE_SHARING');
  const audience = sharing.mode === 'LEGACY' ? d.read.allowed : sharing.mode === 'SHARED' || owner || manager ||
    (sharing.mode === 'CAMPAIGN' ? sharing.campaignIds.some(id => input.readableCampaignIds.has(id)) : grants.length > 0);
  const view = ceiling(d.read) && audience && (!deleted || manager);
  const restrictedEditor = owner || manager || grants.some(g => g.permission === 'EDIT') ||
    (sharing.mode === 'CAMPAIGN' && sharing.campaignIds.some(id => input.editableCampaignIds.has(id)));
  const operationalEditor = sharing.mode === 'SHARED' || sharing.mode === 'LEGACY' ? d.update.allowed : restrictedEditor;
  const writable = view && !identity.readOnlyDemo && identity.mode === 'DIRECT';
  return {
    view,
    edit: writable && !deleted && ceiling(d.update) && operationalEditor,
    manageSharing: writable && !deleted && ceiling(d.update) && (owner || manager || sharingGrant),
    publish: writable && !deleted && ceiling(d.publish) && (sharing.mode === 'SHARED' || sharing.mode === 'LEGACY' ? d.publish.allowed : restrictedEditor),
    delete: writable && !deleted && ceiling(d.delete) && (sharing.mode === 'SHARED' || sharing.mode === 'LEGACY' ? d.delete.allowed : restrictedEditor),
    restore: writable && deleted && d.restore.allowed && (sharing.mode === 'SHARED' || sharing.mode === 'LEGACY' || restrictedEditor),
    purge: writable && manager && d.systemManage.allowed,
  };
}

export interface PublicMaterial {
  materialId: string;
  title: string;
  group: string;
  type: string;
  description: string | null;
  languages: string[];
  markets: string[];
  url: string;
  updateDate: string;
}
