import { describe, expect, it } from 'vitest';
import { contractAccessResource, contractValidity, validContractCode } from './contract-management';
import { evaluateAccess, type AccessIdentity, type AccessRule } from './access-policy';
import type { SupplyContractView } from './contracts';
import { bookingSnapshot } from './booking-workflow';
import type { BookingView } from './booking';

describe('Contract management invariants', () => {
  const contract = { id:'contract',createdByActorId:'creator',managerActorId:'manager',leaderActorId:'leader',vendorActorId:'vendor',assignedActorIds:['slot-only'],ownerUnitCode:null,status:'ACTIVE',startDate:'2026-01-01',endDate:'2026-09-15' } as SupplyContractView;
  const identity=(id:string):AccessIdentity=>({effectiveActorId:id,originalActorId:id,sessionValid:true,effectiveActive:true,originalActive:true,profileComplete:true,mode:'DIRECT',effectiveSuperadmin:false,orgIds:[]});
  const read=(id:string,permission:'contract.read'|'contract.update'|'contract.approve'|'contract.allocate'|'contract.restore',rules:AccessRule[]=[])=>evaluateAccess({identity:identity(id),permission,resource:contractAccessResource(contract),now:1},rules);
  it('accepts six alphanumeric suffix characters only with two or more letters and a real month',()=>{
    expect(validContractCode('CON-FPT-202506-VNEX25')).toBe(true);
    expect(validContractCode('CON-VCCORP-202507-A2B345')).toBe(true);
    for(const code of ['CON-FPT-202513-VNEX25','CON-FPT-202500-VNEX25','CON-FPT-202506-A12345','CON-FPT-202506-ABC12','CON-FPT-202506-ABC1234','CON-FPT-202506-ABC_12'])expect(validContractCode(code)).toBe(false);
  });
  it('expires at Vietnam midnight after the inclusive last day, including paused contracts',()=>{
    expect(contractValidity(contract,new Date('2026-09-15T16:59:59Z'))).toBe('ACTIVE');
    expect(contractValidity(contract,new Date('2026-09-15T17:00:00Z'))).toBe('EXPIRED');
    expect(contractValidity({...contract,status:'PAUSED'},new Date('2026-09-15T17:00:00Z'))).toBe('EXPIRED');
    expect(contractValidity({...contract,status:'PAUSED'},new Date('2026-09-15T16:00:00Z'))).toBe('PAUSED');
    expect(contractValidity(contract,new Date('2025-12-31T16:59:59Z'))).toBe('UPCOMING');
  });
  it('grants only actual assigned actors access and separates header editing from slot responsibility',()=>{
    for(const who of ['manager','leader','vendor','slot-only'])expect(read(who,'contract.read').allowed).toBe(true);
    expect(read('manager','contract.update').allowed).toBe(true);expect(read('leader','contract.approve').allowed).toBe(true);
    expect(read('vendor','contract.update').allowed).toBe(false);expect(read('slot-only','contract.update').allowed).toBe(false);
    expect(read('manager','contract.allocate').allowed).toBe(false);
    expect(read('unassigned','contract.read',[{id:'wide',actorId:'unassigned',permission:'contract.read',effect:'ALLOW',scope:{tier:'SYSTEM'},relation:'ALL',source:'ACCOUNT_OVERRIDE'}]).allowed).toBe(false);
  });
  it('preserves explicit deny and direct-admin/impersonation boundaries',()=>{
    expect(read('manager','contract.read',[{id:'deny',actorId:'manager',permission:'contract.read',effect:'DENY',scope:{tier:'SYSTEM'},relation:'ALL',source:'ACCOUNT_OVERRIDE'}]).allowed).toBe(false);
    const i={...identity('admin'),effectiveSuperadmin:true};
    expect(evaluateAccess({identity:i,permission:'contract.read',resource:contractAccessResource(contract),now:1},[]).allowed).toBe(true);
    expect(evaluateAccess({identity:{...i,mode:'DEMO_IMPERSONATION'},permission:'contract.purge',resource:contractAccessResource(contract),now:1},[]).allowed).toBe(false);
  });
  it('allows scoped trash reads and restore but never normal edits in trash',()=>{
    const resource=contractAccessResource({...contract,deletedAt:'2026-09-01T00:00:00Z'});
    for(const permission of ['contract.read','contract.restore','contract.approve'] as const)expect(evaluateAccess({identity:identity('leader'),permission,resource,now:1},[]).allowed).toBe(true);
    expect(evaluateAccess({identity:identity('leader'),permission:'contract.update',resource,now:1},[]).allowed).toBe(false);
  });
  it('keeps the pinned contract reference in the effective Booking snapshot',()=>{
    const row={contractRevisionId:'revision-v1',contractSnapshot:{revisionId:'revision-v1',version:1,contract:{...contract,name:'Original'}}} as BookingView;
    const snapshot=bookingSnapshot(row);
    expect(snapshot.contractRevisionId).toBe('revision-v1');expect(snapshot.contractSnapshot?.contract.name).toBe('Original');
  });
});
