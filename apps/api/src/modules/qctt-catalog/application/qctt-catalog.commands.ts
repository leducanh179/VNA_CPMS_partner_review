import { z } from 'zod';
import { QCTT_CATALOG_KINDS } from '@cpms/domain';
const nullableCode = z.string().trim().min(1).max(100).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(new Date(v).getTime()) && new Date(v).toISOString().slice(0,10) === v).nullable();
export const qcttCatalogFields = z.object({
  name: z.string().trim().min(1).max(500), status: z.enum(['ACTIVE','INACTIVE','DRAFT']),
  layerCode: nullableCode, channelCode: nullableCode, parentCode: nullableCode,
  ownerOrgId: z.uuid().nullable(), ownerOrgName: z.string().trim().max(300),
  supplyType: z.enum(['PAID','INTERNAL']).nullable(), year: z.number().int().min(2000).max(2200).nullable(),
  effectiveFrom: day, effectiveTo: day, sortOrder: z.number().int().min(0).max(1000000),
  description: z.string().max(10000), unit: z.string().trim().max(500), note: z.string().max(10000),
}).strict();
const save = z.object({ code: z.string().trim().max(100).optional(), kind: z.enum(QCTT_CATALOG_KINDS),
  expectedVersion: z.number().int().nonnegative(), fields: qcttCatalogFields }).strict();
export const qcttCatalogCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SAVE'), idempotencyKey: z.uuid(), items: z.array(save).min(1).max(50) }).strict(),
  z.object({ action: z.enum(['TRASH','RESTORE','PURGE']), idempotencyKey: z.uuid(), items: z.array(z.object({
    code: z.string().trim().min(1).max(100), expectedVersion: z.number().int().positive(),
  }).strict()).min(1).max(50) }).strict(),
]);
export const qcttCatalogImport = z.object({ expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.uuid(),
  sourceUrl: z.url(), capturedAt: z.iso.datetime(), ownerOrgName: z.literal('Ban TT'),
  items: z.array(save.extend({ sourceReference: z.string().max(500), needsConfirmation: z.boolean() }).strict()).min(1).max(500),
}).strict();
