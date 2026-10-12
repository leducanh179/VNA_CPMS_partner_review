import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { APPROVAL_PRESETS, campaignRequiredApprovals } from '@cpms/domain';

const uuid = z.string().uuid();
const base = { idempotencyKey: uuid, expectedVersion: z.number().int().min(0), expectedSubjectRevision: z.number().int().positive(), reason: z.string().trim().max(1000).default('') };
const receiving = { receivingDivisionId: uuid.nullable().default(null) };
const member = z.object({ actorId: uuid, orgId: uuid, responsibility: z.enum(['LEAD','COOP']) }).strict();
const assignment = { members: z.array(member).min(1).max(30) };
const task = { stepId: uuid, expectedStepVersion: z.number().int().positive() };
const schema = z.discriminatedUnion('operation', [
  z.object({ ...base, ...receiving, operation: z.literal('SUBMIT') }).strict(),
  z.object({ ...base, ...receiving, operation: z.literal('REVISE_POLICY') }).strict(),
  z.object({ ...base, operation: z.literal('WITHDRAW') }).strict(),
  z.object({ ...base, ...task, ...assignment, operation: z.literal('APPROVE_ASSIGN') }).strict(),
  z.object({ ...base, ...task, ...assignment, leaderActorId: uuid, operation: z.literal('ADMIN_SKIP_ASSIGN') }).strict(),
  z.object({ ...base, ...task, operation: z.literal('RETURN') }).strict(),
  z.object({ ...base, ...task, operation: z.literal('REJECT') }).strict(),
  z.object({ ...base, ...task, operation: z.literal('ADMIN_REJECT') }).strict(),
  z.object({ ...base, ...assignment, operation: z.literal('REASSIGN'), orgId: uuid, functionalRole: z.enum(['DIVISION_LEADER','CAMPAIGN_MANAGER']) }).strict(),
  z.object({ ...base, operation: z.literal('REQUEST_COOPERATION'), sourceOrgId: uuid, targetOrgId: uuid, targetActorId: uuid.nullable().default(null) }).strict(),
  z.object({ ...base, operation: z.literal('ACCEPT_COOPERATION'), requestId: uuid, expectedRequestVersion: z.number().int().positive() }).strict(),
  z.object({ ...base, operation: z.literal('DECLINE_COOPERATION'), requestId: uuid, expectedRequestVersion: z.number().int().positive() }).strict(),
  z.object({ ...base, operation: z.literal('CANCEL_COOPERATION'), requestId: uuid, expectedRequestVersion: z.number().int().positive() }).strict(),
]);
export type WorkflowCommand = z.infer<typeof schema>;
export function parseWorkflowCommand(raw: unknown): WorkflowCommand {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Command workflow thiếu phiên bản hoặc có trường không hợp lệ.');
  const input = parsed.data;
  if (!['SUBMIT','APPROVE_ASSIGN','REJECT','ADMIN_REJECT','DECLINE_COOPERATION'].includes(input.operation) && !input.reason) throw new BadRequestException('Cần lý do cho thay đổi workflow.');
  if ('members' in input && new Set(input.members.map((m) => `${m.orgId}:${m.actorId}`)).size !== input.members.length) throw new BadRequestException('Người nhận bị trùng trong phạm vi.');
  return input;
}
const policySchema = z.object({ expectedVersion: z.number().int().min(0), campaignId: uuid.nullable(), preset: z.enum(APPROVAL_PRESETS).nullable(),
  requiredApprovals: z.object({ DEPLOY: z.boolean(), EDIT: z.boolean(), PAUSE: z.boolean(), RESUME: z.boolean(), CANCEL: z.boolean(), PURGE: z.boolean() }).strict().default(campaignRequiredApprovals()),
  effectiveFrom: z.string().datetime({ offset: true }), reason: z.string().trim().min(1).max(1000) }).strict();
export function parseWorkflowPolicy(raw: unknown) {
  const result = policySchema.safeParse(raw);
  if (!result.success || (!result.data.campaignId && !result.data.preset)) throw new BadRequestException('Cấu hình chính sách không hợp lệ.');
  return result.data;
}
export function workflowId(value: string): string { if (!uuid.safeParse(value).success) throw new BadRequestException('ID workflow không hợp lệ.'); return value; }
