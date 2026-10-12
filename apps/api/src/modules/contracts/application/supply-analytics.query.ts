import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const supplyAnalyticsQuery = z.object({
  period: z.string().min(1).max(100).default('CURRENT'),
  stage: z.enum(['booked', 'vendorConfirmed', 'approved', 'accepted']).default('booked'),
  grain: z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).default('MONTH'),
  mode: z.enum(['CONTIGUOUS', 'DISCRETE']).default('CONTIGUOUS'),
  slotIds: z.array(z.string().uuid()).max(100).default([]), beneficiary: z.string().min(1).max(100).default('ALL'),
  from: date.optional(), to: date.optional(), keys: z.array(date).max(3660).default([]),
}).strict().superRefine((q, ctx) => {
  if (q.mode === 'DISCRETE' && (q.from || q.to) || q.mode === 'CONTIGUOUS' && q.keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chọn dải liên tục hoặc các mốc cùng mặt cắt, không trộn hai chế độ.' });
});
