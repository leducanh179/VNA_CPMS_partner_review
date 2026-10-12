import { describe, expect, it } from 'vitest';
import { emptyQcttPlanFields, type QcttPlanView } from '@cpms/domain';
import { copyQcttPlanRowFields, patchQcttPlanCells, qcttPlanRowClipboardFields } from './qctt-plan-cells';

const data = { catalog: { data: { layers: [{ code: 'PFL-001', name: 'Quảng cáo' }],
  channels: [{ code: 'CHN-004', name: 'Mạng xã hội' }, { code: 'CHN-007', name: 'Email' }],
  activities: [{ code: 'ATV-003', name: 'Quảng cáo Meta', professionLayer: 'PFL-001', channelCode: 'CHN-004' }, { code: 'ATV-004', name: 'Email mở bán', professionLayer: 'PFL-001', channelCode: 'CHN-007' }] } },
  departments: [{ id: 'dept-a', name: 'Ban A' }] } as QcttPlanView;
const customKey = 'custom:12345678-1234-1234-1234-123456789012';

describe('QCTT spreadsheet cells', () => {
  it('pastes full business fields over another Activity without copying identity or flattening rich text', () => {
    const source = patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'ATV-003', [customKey]: 'Ẩn', departmentId: 'dept-a' }, data);
    source.content = { schemaVersion: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Đậm\nDòng hai', marks: [{ type: 'bold' }] }] }] };
    const target = patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'ATV-004', requirements: 'Cũ' }, data);
    const patch = qcttPlanRowClipboardFields({ ...source, activityName: source.activityLabel, contentDocument: source.content,
      id: 'source', campaignId: 'campaign', recordVersion: 7, origin: 'BOOKING', bookingIds: ['booking'] });
    const pasted = patchQcttPlanCells(target, patch, data);
    expect(pasted).toEqual(source);
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('campaignId');
    expect(patch).not.toHaveProperty('recordVersion');
    expect(patch).not.toHaveProperty('bookingIds');
    expect(patch).not.toHaveProperty('origin');
  });
  it('resolves the selected Activity and its catalog parents', () => {
    const row = patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'ATV-003', departmentId: 'Ban A' }, data);
    expect([row.professionLayer, row.channelCode, row.activityCode, row.activityLabel, row.departmentId])
      .toEqual(['PFL-001', 'CHN-004', 'ATV-003', 'Quảng cáo Meta', 'dept-a']);
  });
  it('rejects an uncatalogued or ambiguous classification instead of saving free text', () => {
    expect(() => patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'Tự nghĩ ra' }, data)).toThrow(/Danh mục QCTT/);
    const duplicate = { ...data, departments: [{ id: 'a', name: 'Ban A' }, { id: 'b', name: 'Ban A' }] };
    expect(() => patchQcttPlanCells(emptyQcttPlanFields(), { departmentId: 'Ban A' }, duplicate)).toThrow(/duy nhất/);
  });
  it('keeps user-defined text separate and clears a dependent Activity when Channel changes', () => {
    const initial = patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'ATV-003', [customKey]: 'Ghi chú riêng' }, data);
    const changed = patchQcttPlanCells(initial, { channelCode: 'CHN-007' }, data);
    expect(changed.activityCode).toBeNull();
    expect(changed.customValues).toEqual({ [customKey]: 'Ghi chú riêng' });
    expect(initial.activityCode).toBe('ATV-003');
  });
  it('turns pasted plain text into rich text without losing the topic', () => {
    const row = patchQcttPlanCells(emptyQcttPlanFields(), { content: 'Khai trương đường bay' }, data);
    expect(row.content?.content[0]?.content?.[0]?.text).toBe('Khai trương đường bay');
  });
  it('copies projected edits and custom columns without identity, history or Booking links', () => {
    const fields = patchQcttPlanCells(emptyQcttPlanFields(), { activityLabel: 'ATV-003', [customKey]: 'Cũ', content: 'Chủ đề' }, data);
    const row = { ...fields, id: 'source', recordVersion: 4, origin: 'BOOKING', deletedAt: null,
      activityLabel: fields.activityCode, activityName: fields.activityLabel, content: JSON.stringify(fields.content),
      contentDocument: fields.content, requirements: 'Đang sửa', [customKey]: 'Mới', bookingIds: ['booking'] };
    const copy = copyQcttPlanRowFields(row);
    expect(copy.activityLabel).toBe('Quảng cáo Meta');
    expect(copy.activityCode).toBe('ATV-003');
    expect(copy.requirements).toBe('Đang sửa');
    expect(copy.customValues).toEqual({ [customKey]: 'Mới' });
    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('bookingIds');
    expect(copy).not.toHaveProperty('origin');
    copy.content!.content[0]!.content![0]!.text = 'Đổi bản sao';
    expect(fields.content?.content[0]?.content?.[0]?.text).toBe('Chủ đề');
  });
  it('retains incomplete input for duplicating a new unfinished row', () => {
    const fields = emptyQcttPlanFields();
    const copy = copyQcttPlanRowFields({ ...fields, activityName: '', contentDocument: null, requirements: 'Nhập dở' });
    expect(copy.activityCode).toBeNull();
    expect(copy.content).toBeNull();
    expect(copy.requirements).toBe('Nhập dở');
  });
});
