import type { CampaignRichTextDocument, QcttPlanFields, QcttPlanView } from '@cpms/domain';

const paragraph = (text: string): CampaignRichTextDocument => ({ schemaVersion: 1, type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });

/** Copy the displayed values, including unfinished edits, without record or Booking identity. */
export function copyQcttPlanRowFields(row: Record<string, unknown>): QcttPlanFields {
  const source = row as unknown as QcttPlanFields;
  const customValues = { ...source.customValues };
  for (const [key, value] of Object.entries(row)) if (/^custom:[0-9a-f-]{36}$/i.test(key)) customValues[key] = String(value ?? '');
  return structuredClone({
    customValues, professionLayer: source.professionLayer, channelCode: source.channelCode,
    activityCode: source.activityCode, activityLabel: String(row.activityName ?? ''),
    content: row.contentDocument as CampaignRichTextDocument | null, format: source.format, otherFormat: source.otherFormat,
    startDate: source.startDate, endDate: source.endDate, departmentId: source.departmentId,
    requirements: source.requirements, progress: source.progress,
  });
}

/** Grid patches contain editable business values only, including fields hidden from view. */
export function qcttPlanRowClipboardFields(row: Record<string, unknown>): Record<string, string> {
  const fields = copyQcttPlanRowFields(row);
  return {
    professionLayer: fields.professionLayer ?? '', channelCode: fields.channelCode ?? '',
    activityLabel: fields.activityCode ?? '', content: fields.content ? JSON.stringify(fields.content) : '',
    format: fields.format ?? '', otherFormat: fields.otherFormat, startDate: fields.startDate ?? '',
    endDate: fields.endDate ?? '', departmentId: fields.departmentId ?? '', requirements: fields.requirements,
    progress: fields.progress, ...fields.customValues,
  };
}

/** Resolve pasted labels to catalog entries; never silently create a classification. */
export function patchQcttPlanCells(fields: QcttPlanFields, patch: Record<string, string>, data: QcttPlanView): QcttPlanFields {
  const next: QcttPlanFields = { ...fields, customValues: { ...fields.customValues } };
  const map = data.catalog.data;
  const resolve = (raw: string, choices: { code: string; name: string }[]) => {
    const value = raw.trim();
    if (!value) return null;
    const matches = choices.filter(c => c.code === value || c.name === value);
    if (matches.length !== 1) throw new Error(`Giá trị “${value}” không có duy nhất trong Danh mục QCTT.`);
    return matches[0]!.code;
  };
  if ('professionLayer' in patch) {
    next.professionLayer = resolve(patch.professionLayer!, map?.layers ?? []);
    next.channelCode = null; next.activityCode = null; next.activityLabel = '';
  }
  if ('channelCode' in patch) {
    next.channelCode = resolve(patch.channelCode!, map?.channels.filter(c => !next.professionLayer || map.activities.some(a => a.professionLayer === next.professionLayer && a.channelCode === c.code)) ?? []);
    next.activityCode = null; next.activityLabel = '';
  }
  if ('activityLabel' in patch) {
    const code = resolve(patch.activityLabel!, map?.activities.filter(a => (!next.professionLayer || a.professionLayer === next.professionLayer) && (!next.channelCode || a.channelCode === next.channelCode)) ?? []);
    const activity = map?.activities.find(a => a.code === code);
    next.activityCode = activity?.code ?? null; next.activityLabel = activity?.name ?? '';
    if (activity) { next.professionLayer = activity.professionLayer; next.channelCode = activity.channelCode; }
  }
  if ('departmentId' in patch) {
    const value = patch.departmentId!.trim();
    const matches = data.departments.filter(d => d.id === value || d.name === value);
    if (value && matches.length !== 1) throw new Error(`Không tìm thấy duy nhất CQ, ĐV phụ trách “${value}”.`);
    next.departmentId = matches[0]?.id ?? null;
  }
  if ('content' in patch) {
    const value = patch.content!.trim();
    try { next.content = value ? JSON.parse(value) as CampaignRichTextDocument : null; }
    catch { next.content = paragraph(value); }
  }
  for (const key of ['startDate', 'endDate', 'format'] as const) if (key in patch) (next as unknown as Record<string, unknown>)[key] = patch[key] || null;
  for (const key of ['otherFormat', 'requirements', 'progress'] as const) if (key in patch) (next as unknown as Record<string, unknown>)[key] = patch[key];
  for (const [key, value] of Object.entries(patch)) if (/^custom:[0-9a-f-]{36}$/i.test(key)) {
    if (value.trim()) next.customValues![key] = value.trim(); else delete next.customValues![key];
  }
  return next;
}
