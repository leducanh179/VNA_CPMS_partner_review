import type { ContractItemValue } from './contract-items';
import type { SupplyContractView } from './contracts';

export interface ChannelMapEntry { code: string; name: string }
export interface ChannelActivity extends ChannelMapEntry {
  professionLayer: string;
  channelCode: string;
  sourceChannelName?: string | undefined;
  description: string;
  supplyType: 'PAID' | 'INTERNAL';
  unit: string;
}
export interface SupplyChannelMap {
  version: 1;
  sourceUrl: string;
  capturedAt: string;
  layers: ChannelMapEntry[];
  channels: ChannelMapEntry[];
  activities: ChannelActivity[];
}
export interface ChannelMapCatalog { data: SupplyChannelMap | null; recordVersion: number; digest: string | null }
export interface ItemClassificationSnapshot {
  professionLayer: string; professionLayerName: string;
  channelCode: string; channelName: string;
  activityCode: string; activityName: string;
  catalogVersion: number;
}
/** Legacy codes remain readable; normalization does not rewrite an archived baseline. */
export const canonicalLayer = (code: string | null | undefined) => code?.replace(/^PF(\d{3})$/, 'PFL-$1') ?? null;
export const canonicalChannel = (code: string | null | undefined) => code?.replace(/^CH(\d{3})$/, 'CHN-$1') ?? null;
export function defaultProfessionLayer(department: string | null | undefined): string | null {
  const value = (department ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  if (value.includes('thuong hieu')) return 'PFL-001';
  if (value.includes('truyen thong')) return 'PFL-002';
  if (value.includes('su kien')) return 'PFL-003';
  return null;
}
export function activityForItem(map: SupplyChannelMap, item: Pick<ContractItemValue, 'professionLayer' | 'channelCode' | 'activityCode'>) {
  return map.activities.find(a => a.code === item.activityCode && a.professionLayer === canonicalLayer(item.professionLayer) && a.channelCode === canonicalChannel(item.channelCode));
}
export function capturedClassificationLabel(item: Partial<ContractItemValue>, field: string): string | undefined {
  const s=item.classificationSnapshot;
  if(!s)return undefined;
  if(field==='professionLayer'&&s.professionLayer===canonicalLayer(item.professionLayer))return s.professionLayerName;
  if(field==='channelCode'&&s.channelCode===canonicalChannel(item.channelCode))return s.channelName;
  if(field==='activityCode'&&s.activityCode===item.activityCode)return s.activityName;
  return undefined;
}
/** Used by cell edits, paste and multi-row edits so stale descendants never survive a parent change. */
export function changeItemClassification(value: ContractItemValue, patch: Partial<ContractItemValue>, map: SupplyChannelMap | null): ContractItemValue {
  const next = { ...value, ...patch };
  if (!map) return next;
  if ('professionLayer' in patch || 'channelCode' in patch || 'activityCode' in patch) {
    next.professionLayer = canonicalLayer(next.professionLayer);
    next.channelCode = canonicalChannel(next.channelCode);
    if (!map.activities.some(a => a.professionLayer === next.professionLayer && a.channelCode === next.channelCode)) next.channelCode = null;
    if (!activityForItem(map, next)) next.activityCode = null;
    delete next.classificationSnapshot;
  }
  return next;
}
export const isOwnedChannel = (c: Pick<SupplyContractView, 'source'>) => c.source.kind === 'OWNED_MEDIA';
export const ownedActivityCode = (c: Pick<SupplyContractView, 'source'>) => isOwnedChannel(c) && typeof c.source.ownedActivityCode === 'string' ? c.source.ownedActivityCode : null;

/** Locally created activities belong to their managed profile, not the imported Sheet catalog. */
export function localOwnedActivity(c: SupplyContractView): ChannelActivity | null {
  if (!isOwnedChannel(c) || c.source.activityOrigin !== 'LOCAL') return null;
  const activity = c.source.activity as ChannelActivity | undefined;
  if (!activity || activity.code !== ownedActivityCode(c) || activity.supplyType !== 'INTERNAL' || typeof activity.professionLayer !== 'string' || typeof activity.channelCode !== 'string') return null;
  return {...activity,name:c.name};
}
export function withLocalOwnedActivities(catalog: ChannelMapCatalog, profiles: SupplyContractView[]): ChannelMapCatalog {
  if (!catalog.data) return catalog;
  const activities=profiles.flatMap(c=>{const activity=localOwnedActivity(c);return activity?[activity]:[];});
  return {...catalog,data:{...catalog.data,activities:[...catalog.data.activities,...activities]}};
}
