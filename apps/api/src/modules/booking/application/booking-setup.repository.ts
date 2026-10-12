import type { ActorContext } from '@cpms/domain';
export interface BookingContactSetup {email:string;displayName:string;organizationName:string;departmentId:string|null;divisionId:string|null;external:boolean}
export abstract class BookingSetupRepository {
  abstract provision(contact:BookingContactSetup,passwordHash:string,mustChangePassword:boolean,actor:ActorContext):Promise<{id:string;created:boolean}>;
}
