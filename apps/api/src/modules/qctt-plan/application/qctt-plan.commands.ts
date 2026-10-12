import { z } from 'zod';
import { validateCampaignRichText, type CampaignRichTextDocument } from '@cpms/domain';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v; }, 'Ngày không hợp lệ');
const code = z.string().trim().min(1).max(100).nullable();
export const qcttPlanFields = z.object({
  customValues: z.record(z.string().max(100), z.string().trim().max(1000)).default({}),
  professionLayer: code, channelCode: code, activityCode: code, activityLabel: z.string().trim().max(1000),
  content: z.custom<CampaignRichTextDocument>(v => v !== null && validateCampaignRichText(v).length === 0).nullable(),
  format: z.enum(['WRITE','FILM','PHOTO','OTHER']).nullable(), otherFormat: z.string().trim().max(300),
  startDate: day.nullable(), endDate: day.nullable(), departmentId: z.string().uuid().nullable(),
  requirements: z.string().max(10000), progress: z.enum(['PLANNED','IN_PROGRESS','COMPLETED','STOPPED']),
}).strict().refine(v => !v.startDate || !v.endDate || v.startDate <= v.endDate, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
const item = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(), fields: qcttPlanFields }).strict();
export const qcttPlanCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SAVE'), idempotencyKey: z.string().uuid(), items: z.array(item).min(1).max(50) }).strict(),
  z.object({ action: z.literal('COLUMNS'), idempotencyKey: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), columns: z.array(z.object({ key: z.string().min(1).max(100), label: z.string().trim().min(1).max(100) }).strict()).min(1).max(30) }).strict(),
  z.object({ action: z.enum(['DELETE','RESTORE']), idempotencyKey: z.string().uuid(), items: z.array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict()).min(1).max(50) }).strict(),
]);
