import { z } from 'zod';
import { supplyAnalyticsQuery } from './supply-analytics.query';

const dimension = z.enum(['slot', 'beneficiary', 'period', 'time']);
const measure = z.enum(['total', 'used', 'remaining', 'usedPercent', 'remainingPercent']);
export const supplyPivotLayout = z.object({
  version: z.literal(1), rows: z.array(dimension).min(1).max(2), columns: z.array(dimension).max(1),
  filters: z.array(dimension).max(4), values: z.array(measure).min(1).max(5), totals: z.boolean(),
  sort: z.object({ field: z.enum(['label', ...measure.options]), direction: z.enum(['asc', 'desc']) }).strict(),
  widths: z.record(z.string().max(300), z.number().int().min(90).max(600)).refine(w => Object.keys(w).length <= 650),
  collapsed: z.array(z.string().max(600)).max(1000),
}).strict().superRefine((layout, ctx) => {
  const fields = [...layout.rows, ...layout.columns, ...layout.filters];
  if (fields.length !== 4 || new Set(fields).size !== 4) ctx.addIssue({ code: 'custom', message: 'Mỗi trường phải ở đúng một vùng Hàng, Cột hoặc Bộ lọc.' });
  if (new Set(layout.values).size !== layout.values.length) ctx.addIssue({ code: 'custom', message: 'Chỉ số bị lặp.' });
});
export const supplyPivotDefinition = z.object({ version: z.literal(1), query: supplyAnalyticsQuery, layout: supplyPivotLayout }).strict();
export const saveSupplyPivotView = z.object({
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100), definition: supplyPivotDefinition, isDefault: z.boolean(),
}).strict().refine(v => Boolean(v.id) === Boolean(v.expectedVersion), 'Lưu view cần đúng phiên bản đã tải.');
export const deleteSupplyPivotView = z.object({ expectedVersion: z.number().int().positive() }).strict();
