import { z } from 'zod';
import { parseSourceDate } from '../domain/supply-engine';

const text = z.string().trim().max(4000);
const decimalText = z.string().regex(/^-?\d{1,18}(\.\d{1,10})?$/, 'Nhập số thập phân, dùng dấu chấm và không có dấu phân cách hàng nghìn.');
const money = decimalText.nullable();
const exactMoney = z.string().regex(/^-?\d{1,18}(\.\d{1,6})?$/, 'Tiền và đơn giá tối đa 6 chữ số thập phân.').nullable();
const day = z.string().refine(v => { try { return parseSourceDate(v) === v; } catch { return false; } }, 'Ngày phải theo YYYY-MM-DD và tồn tại.').nullable();
const url = z.string().max(2000).refine(v => { try { return ['https:', 'http:'].includes(new URL(v).protocol); } catch { return false; } }, 'Liên kết phải dùng http/https.').nullable();
export const expectedVersion = z.number().int().min(1);
export const contractFields = z.object({
  code: z.string().trim().min(1).max(120).optional(), name: z.string().trim().min(1).max(500).optional(), number: text.nullable().optional(), vendor: text.nullable().optional(),
  supplyType: z.enum(['PAID','INTERNAL','BARTER']).optional(), ownerUnitCode: text.nullable().optional(), ownerDepartment: text.nullable().optional(),
  managerActorId: z.string().uuid().nullable().optional(), managerEmail: z.string().email().nullable().optional(),
  startDate: day.optional(), endDate: day.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  signedAmount: exactMoney.optional(), signedVat: exactMoney.optional(), signedGross: exactMoney.optional(), status: z.enum(['DRAFT','ACTIVE','PAUSED','ARCHIVED']).optional(), dossierUrl: url.optional(),
}).strict();
export const contractSave = z.object({ expectedVersion: expectedVersion.optional(), fields: contractFields, legalReason: text.optional(), legalEvidence: text.optional() }).strict();
export const slotFields = z.object({
  code: z.string().trim().min(1).max(120).optional(), name: z.string().trim().min(1).max(500).optional(), unit: text.nullable().optional(), quantityUnit: text.nullable().optional(),
  priceBasis: money.optional(), unitPrice: exactMoney.optional(), totalQty: money.optional(), signedAmount: exactMoney.optional(), costType: z.enum(['PAID','VENDOR_FOC','INTERNAL_ZERO','UNKNOWN']).optional(),
  businessType: z.enum(['MEDIA','PRODUCTION','UNKNOWN']).optional(), channel: text.nullable().optional(), specificChannel: text.nullable().optional(), marketCode: text.nullable().optional(),
  description: text.nullable().optional(), materialRequirement: text.nullable().optional(), previewUrl: url.optional(), managerEmail: z.string().email().nullable().optional(),
  startDate: day.optional(), endDate: day.optional(), status: z.enum(['DRAFT','ACTIVE','PAUSED','ARCHIVED']).optional(),
  capacityMode: z.enum(['UNKNOWN','UNRESTRICTED','EXCLUSIVE','SHARED_CAPACITY']).optional(), capacity: z.number().int().min(1).max(100000).nullable().optional(),
  bookerEmails: z.array(z.string().email()).max(100).optional(),
}).strict();
export const slotSave = z.object({ expectedVersion, id: z.string().uuid().optional(), recordVersion: expectedVersion.optional(), fields: slotFields, legalReason: text.optional(), legalEvidence: text.optional() }).strict();
export const allocationFields = z.object({
  slotId: z.string().uuid().nullable(), period: z.object({ code: z.string().trim().min(1).max(120), name: text, kind: z.enum(['CONTRACT','YEAR','HALF_YEAR','QUARTER','MONTH','CUSTOM']), startDate: day, endDate: day }).strict(),
  beneficiaryUnitCode: text.nullable(), scopeKind: z.enum(['ENTITLEMENT','CAP']), limitMode: z.enum(['HARD_LIMIT','WARNING','REFERENCE']),
  basis: z.enum(['QTY','AMOUNT','PERCENT_QTY','PERCENT_AMOUNT']), value: decimalText, denominator: money.optional(),
  taxRate: money.optional(), vatEstimated: z.boolean().optional(),
}).strict();
export const allocationSave = z.object({ expectedVersion, id: z.string().uuid().optional(), recordVersion: expectedVersion.optional(), fields: allocationFields }).strict();
export const adjustmentFields = z.object({ kind: z.enum(['CUT','ADD','TRANSFER','MIXED']), name: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(4000), evidence: text.nullable(), effectiveDate: day,
  lines: z.array(z.object({ allocationId: z.string().uuid(), expectedAllocationVersion: expectedVersion, deltaQty: money, deltaAmount: exactMoney }).strict()).min(1).max(100) }).strict();
export const adjustmentSave = z.object({ expectedVersion, id: z.string().uuid().optional(), recordVersion: expectedVersion.optional(), fields: adjustmentFields }).strict();
export const transitionCommand = z.object({ expectedVersion, recordVersion: expectedVersion, action: z.enum(['SUBMIT','APPROVE','REJECT','REVERSE']), idempotencyKey: z.string().min(8).max(150), reason: text.optional(), effectiveDate: day.optional() }).strict();
export const importApplyCommand = z.object({ idempotencyKey: z.string().min(8).max(150), acknowledgeWarnings: z.boolean() }).strict();
export const freeAllocationSplitCommand = z.object({ expectedVersion, allocationId: z.string().uuid(), idempotencyKey: z.string().min(8).max(150), reason: z.string().trim().min(1).max(4000),
  parts: z.array(z.object({ periodId: z.string().uuid(), qty: decimalText, taxRate: z.string().regex(/^\d(\.\d{1,8})?$/), vatEstimated: z.boolean() }).strict()).min(2).max(24) }).strict();
export const listQuery = z.object({ supplyType:z.enum(['PAID','INTERNAL']).optional(), trash: z.enum(['true','false']).optional(), q: z.string().max(200).optional(), start: day.optional(), end: day.optional(), status: z.string().max(50).optional(), vendor: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(['code','name','vendor','startDate','endDate','signedAmount','status']).default('code'), direction: z.enum(['asc','desc']).default('asc') }).strict();
