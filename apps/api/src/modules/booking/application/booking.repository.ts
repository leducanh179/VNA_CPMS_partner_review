import type { ActorContext, BookingAllocationAccess, BookingTemplate, BookingView, BookingPolicy, BookingDelegation } from '@cpms/domain';
export abstract class BookingRepository {
  abstract delegations(contractId?:string):Promise<BookingDelegation[]>;
  abstract saveDelegation(value:BookingDelegation,expectedVersion:number,actor:ActorContext):Promise<void>;
  abstract policy():Promise<BookingPolicy>;
  abstract savePolicy(required:boolean,expectedVersion:number,reason:string,actor:ActorContext,actions?:BookingPolicy['actions']):Promise<BookingPolicy>;
  abstract all(contractIds?: string[]): Promise<BookingView[]>;
  abstract allocationScopes(contractIds:string[]):Promise<Array<{allocationId:string;slotId:string|null;scopeKind:string;periodStart:string;periodEnd:string;beneficiaryUnitCode:string|null}>>;
  abstract get(ids: string[]): Promise<BookingView[]>;
  abstract lock(contractIds: string[]): Promise<void>;
  abstract allocationAccess(): Promise<BookingAllocationAccess[]>;
  abstract templates(contractIds?: string[]): Promise<BookingTemplate[]>;
  abstract catalog(): Promise<{ people: Array<{id:string;name:string;email:string|null}>; departments:Array<{id:string;name:string}>; campaigns:Array<{id:string;code:string;name:string;status:string;startDate:string|null;endDate:string|null}>; materials:Array<{id:string;name:string;url:string|null}> }>;
  abstract save(row: BookingView, before: BookingView | null, actor: ActorContext, action: string): Promise<void>;
  abstract purge(row: BookingView, actor: ActorContext): Promise<void>;
  abstract history(id: string): Promise<Array<{id:string;version:number;action:string;actorId:string;createdAt:string;data:unknown}>>;
  abstract command(key: string): Promise<{ actorId: string; digest: string; result: unknown } | null>;
  abstract saveCommand(key:string,digest:string,result:unknown,actor:ActorContext):Promise<void>;
  abstract saveAccess(value: BookingAllocationAccess, actor: ActorContext): Promise<void>;
  abstract saveTemplate(value: BookingTemplate, actor: ActorContext): Promise<void>;
}
