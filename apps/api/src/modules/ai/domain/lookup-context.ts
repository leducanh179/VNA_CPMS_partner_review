import { z } from 'zod';
export const lookupRecordSchema = z.object({ kind: z.enum(['CAMPAIGN', 'MATERIAL', 'CONTRACT', 'BOOKING']), id: z.string().min(1).max(120) }).strict();
export const lookupContextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RECORD'), record: lookupRecordSchema }).strict(),
  z.object({ type: z.literal('CELL'), text: z.string().min(1).max(4000), label: z.string().min(1).max(200),
    fieldKey: z.string().min(1).max(120).optional(), record: lookupRecordSchema.optional() }).strict(),
]);
export function boundedContext(text: string, bytes: number) {
  let result = '';
  for (const char of text) { if (Buffer.byteLength(result + char) > bytes) break; result += char; }
  return { text: result, truncated: result !== text };
}
