import type { ChannelMapCatalog } from './channel-map';

export const QCTT_CATALOG_KINDS = ['LAYER', 'CHANNEL', 'ACTIVITY', 'PILLAR', 'TOPIC'] as const;
export type QcttCatalogKind = typeof QCTT_CATALOG_KINDS[number];
export type QcttCatalogStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT';
export const QCTT_CATALOG_LABELS: Record<QcttCatalogKind, string> = {
  LAYER: 'Lớp nghiệp vụ', CHANNEL: 'Kênh', ACTIVITY: 'Phương tiện', PILLAR: 'Trụ cột QCTT', TOPIC: 'Chủ đề con',
};
export interface QcttCatalogFields {
  name: string; status: QcttCatalogStatus; layerCode: string | null; channelCode: string | null;
  parentCode: string | null; ownerOrgId: string | null; ownerOrgName: string;
  supplyType: 'PAID' | 'INTERNAL' | null; year: number | null;
  effectiveFrom: string | null; effectiveTo: string | null; sortOrder: number;
  description: string; unit: string; note: string;
}
export interface QcttCatalogEntry extends QcttCatalogFields {
  code: string; kind: QcttCatalogKind; recordVersion: number; deletedAt: string | null;
  source: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface QcttCatalogView {
  schemaVersion: 1; recordVersion: number; entries: QcttCatalogEntry[];
  organizations: { id: string; name: string }[];
  capabilities: { manage: boolean; purge: boolean };
}
export const emptyQcttCatalogFields = (): QcttCatalogFields => ({
  name: '', status: 'ACTIVE', layerCode: null, channelCode: null, parentCode: null,
  ownerOrgId: null, ownerOrgName: '', supplyType: null, year: null,
  effectiveFrom: null, effectiveTo: null, sortOrder: 0, description: '', unit: '', note: '',
});
export function qcttCatalogAvailable(entry: QcttCatalogEntry, day?: string): boolean {
  return !entry.deletedAt && entry.status === 'ACTIVE' && (!day ||
    (!entry.effectiveFrom || entry.effectiveFrom <= day) && (!entry.effectiveTo || entry.effectiveTo >= day));
}
export function validateQcttCatalog(entries: QcttCatalogEntry[]): string[] {
  const errors: string[] = [];
  const byCode = new Map(entries.map(e => [e.code, e]));
  if (byCode.size !== entries.length) errors.push('Mã danh mục bị trùng.');
  for (const e of entries.filter(e => !e.deletedAt)) {
    const prefix = `${e.code}: `;
    if (!e.name.trim()) errors.push(prefix + 'Tên là bắt buộc.');
    if (e.effectiveFrom && e.effectiveTo && e.effectiveFrom > e.effectiveTo) errors.push(prefix + 'Ngày kết thúc trước ngày bắt đầu.');
    const parent = (code: string | null, kind: QcttCatalogKind, label: string) => {
      const p = code ? byCode.get(code) : undefined;
      if (!p || p.kind !== kind || p.deletedAt || e.status === 'ACTIVE' && p.status !== 'ACTIVE') errors.push(prefix + `${label} không tồn tại hoặc đang ngừng sử dụng.`);
    };
    if (e.kind === 'ACTIVITY') {
      parent(e.layerCode, 'LAYER', 'Lớp nghiệp vụ'); parent(e.channelCode, 'CHANNEL', 'Kênh');
      if (!e.ownerOrgId && !e.ownerOrgName.trim()) errors.push(prefix + 'Chọn CQĐV phụ trách.');
      if (!e.supplyType) errors.push(prefix + 'Chọn loại media.');
    }
    if (e.kind === 'PILLAR' || e.kind === 'TOPIC') {
      if (!e.year) errors.push(prefix + 'Năm áp dụng là bắt buộc.');
      if (e.kind === 'TOPIC') {
        parent(e.parentCode, 'PILLAR', 'Trụ cột');
        if (e.year !== byCode.get(e.parentCode ?? '')?.year) errors.push(prefix + 'Chủ đề con và trụ cột phải cùng năm.');
      }
    }
  }
  return errors;
}
export function projectQcttChannelMap(entries: QcttCatalogEntry[], recordVersion: number, day?: string): ChannelMapCatalog {
  const selected = entries.filter(e => qcttCatalogAvailable(e, day));
  const layers = selected.filter(e => e.kind === 'LAYER').map(e => ({ code: e.code, name: e.name }));
  const channels = selected.filter(e => e.kind === 'CHANNEL').map(e => ({ code: e.code, name: e.name }));
  const activities = selected.filter(e => e.kind === 'ACTIVITY' && layers.some(l => l.code === e.layerCode) && channels.some(c => c.code === e.channelCode))
    .map(e => ({ code: e.code, name: e.name, professionLayer: e.layerCode!, channelCode: e.channelCode!,
      description: e.description, unit: e.unit, supplyType: e.supplyType!, ownerOrgName: e.ownerOrgName }));
  return { recordVersion, digest: null, data: { version: 1, sourceUrl: 'https://cpms.local/catalogs/qctt',
    capturedAt: new Date().toISOString(), layers, channels, activities } };
}
