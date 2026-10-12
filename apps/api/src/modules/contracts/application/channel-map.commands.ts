import { z } from 'zod';
const entry = z.object({code:z.string().trim().min(1).max(80),name:z.string().trim().min(1).max(500)}).strict();
export const channelMapImport = z.object({
  expectedVersion:z.number().int().min(0),
  data:z.object({
    version:z.literal(1),sourceUrl:z.url(),capturedAt:z.iso.datetime(),
    layers:z.array(entry).min(1).max(100),channels:z.array(entry).min(1).max(500),
    activities:z.array(entry.extend({professionLayer:z.string(),channelCode:z.string(),sourceChannelName:z.string().optional(),description:z.string().max(10000),supplyType:z.enum(['PAID','INTERNAL']),unit:z.string().max(500)})).max(2000),
  }).strict(),
}).strict();
