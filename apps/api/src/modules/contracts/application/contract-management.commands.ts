import { z } from 'zod';
import { contractFields, expectedVersion } from './contracts.commands';
import { validContractCode } from '@cpms/domain';
import { itemChanges } from './contract-items.commands';

export const managedFields = contractFields.pick({ name: true, number: true, vendor: true, managerActorId: true, startDate: true, endDate: true, currency: true, signedAmount: true, signedVat: true, dossierUrl: true }).extend({
  leaderActorId: z.string().uuid().nullable().optional(), vendorActorId: z.string().uuid().nullable().optional(),
  supplierId: z.uuid().nullable().optional(),
  supplyType: z.enum(['PAID','INTERNAL']).optional(),
  serviceRecipient: z.string().trim().max(500).nullable().optional(),
  marketScope: z.enum(['UNSPECIFIED','ALL','SELECTED']).optional(),
  marketCodes: z.array(z.string().trim().min(1).max(20)).max(100).optional(),
}).strict();
export const contractCode = z.string().trim().toUpperCase().refine(validContractCode, 'Mã phải có dạng CON-NCC-YYYYMM-XXXXXX; phần cuối gồm 6 chữ/số và ít nhất 2 chữ cái.');
const reason = z.string().trim().max(4000), evidence = z.string().trim().max(4000).nullable().optional();
export const managementChange = z.object({
  expectedVersion, requestId: z.string().uuid().optional(), expectedRequestVersion: expectedVersion.optional(),
  itemChanges: itemChanges.optional(),
  newPeriod: z.object({id:z.uuid(),name:z.string().trim().min(1).max(200),startDate:z.iso.date(),endDate:z.iso.date()}).strict().optional(),
  kind: z.enum(['EDIT','PAUSE','RESUME','DELETE','RESTORE']).default('EDIT'), fields: managedFields.default({}),
  mode: z.enum(['DRAFT','SUBMIT','SELF_APPROVE']), reason, evidence, idempotencyKey: z.string().uuid(),
}).strict();
export const managementCreate = z.object({ ownedActivityCode:z.string().max(80).optional(),
  newOwnedActivity:z.object({professionLayer:z.string().trim().min(1).max(80),channelCode:z.string().trim().min(1).max(80)}).strict().optional(),
  code: contractCode.optional(), vendorCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/), fields: managedFields,
  mode: z.enum(['DRAFT','SUBMIT','SELF_APPROVE']), reason, evidence, idempotencyKey: z.string().uuid() }).strict()
  .refine(v=>!(v.ownedActivityCode&&v.newOwnedActivity),'Chọn hoạt động danh mục hoặc tạo hoạt động mới, không gửi đồng thời cả hai.');
export const managementDecision = z.object({ action: z.enum(['APPROVE','RETURN','WITHDRAW']), expectedVersion, expectedRequestVersion: expectedVersion, reason, idempotencyKey: z.string().uuid() }).strict();
export const managementPolicy = z.object({ required: z.boolean(), expectedVersion: z.number().int().min(0), reason: reason.min(1) }).strict();
export const managementPurge = z.object({ expectedVersion, confirmationCode: z.string(), reason: reason.min(1), idempotencyKey: z.string().uuid() }).strict();
export const managementAdopt = z.object({ idempotencyKey: z.string().uuid(), contracts: z.array(z.object({ id: z.string().uuid(), expectedVersion, vendorCode: z.string().regex(/^[A-Z0-9]{2,20}$/), code: contractCode.optional() }).strict()).min(1).max(50) }).strict();
