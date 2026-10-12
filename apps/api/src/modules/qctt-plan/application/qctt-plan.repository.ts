import type { ActorContext, BookingView, QcttPlanColumn, QcttPlanItem, QcttPlanState, QcttPlanView } from '@cpms/domain';

export abstract class QcttPlanRepository {
  abstract state(campaignId: string): Promise<QcttPlanState | null>;
  abstract campaigns(): Promise<QcttPlanView['campaigns']>;
  abstract departments(): Promise<QcttPlanView['departments']>;
  abstract responsibleDepartment(ownerId: string | null, actorIds: string[]): Promise<string | null>;
  abstract items(campaignId: string): Promise<QcttPlanItem[]>;
  abstract ensure(campaignId: string, actor: ActorContext): Promise<void>;
  abstract setColumns(campaignId: string, expectedVersion: number, columns: QcttPlanColumn[], actor: ActorContext): Promise<void>;
  abstract save(item: QcttPlanItem, before: QcttPlanItem | null, actor: ActorContext, action: string): Promise<void>;
  abstract bookings(campaignId: string): Promise<BookingView[]>;
  abstract legacy(campaignId: string): Promise<QcttPlanView['legacyPlans']>;
  abstract history(itemId: string): Promise<{ version: number; action: string; actorName: string; createdAt: string; data: unknown }[]>;
  abstract receipt(actorId: string, key: string): Promise<{ digest: string; result: unknown } | null>;
  abstract finish(actor: ActorContext, key: string, digest: string, result: unknown): Promise<void>;
  abstract initializedCampaigns(): Promise<{ id: string; code: string; name: string; status: string; startDate: string | null; endDate: string | null }[]>;
}
