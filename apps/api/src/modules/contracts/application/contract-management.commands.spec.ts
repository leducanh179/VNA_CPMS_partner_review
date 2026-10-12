import { describe, expect, it } from 'vitest';
import { managementChange, managementCreate } from './contract-management.commands';
describe('Contract command boundary',()=>{
  const command={expectedVersion:1,kind:'EDIT',fields:{name:'Revised'},mode:'SUBMIT',reason:'Correct metadata',idempotencyKey:'00000000-0000-4000-8000-000000000001'};
  it('rejects code changes, computed money, slots and actor injection',()=>{
    expect(managementChange.safeParse(command).success).toBe(true);
    for(const fields of [{code:'CON-FPT-202506-AB1234'},{signedGross:'100'},{slots:[]},{vendorCode:'FPT'},{actorId:'owner'}])expect(managementChange.safeParse({...command,fields}).success).toBe(false);
    expect(managementChange.safeParse({...command,actorId:'owner'}).success).toBe(false);
  });
  it('normalizes manual codes while enforcing the suffix rule',()=>{
    const create={fields:{name:'Contract',startDate:'2026-06-01'},mode:'DRAFT',reason:'',idempotencyKey:command.idempotencyKey,vendorCode:' fpt ',code:' con-fpt-202606-vnex25 '};
    expect(managementCreate.parse(create).code).toBe('CON-FPT-202606-VNEX25');
    expect(managementCreate.safeParse({...create,code:'CON-FPT-202606-A12345'}).success).toBe(false);
  });
  it('accepts a new owned activity but rejects ambiguous origin and forged activity IDs',()=>{
    const create={vendorCode:'VNA',fields:{name:'New activity'},mode:'DRAFT',reason:'',idempotencyKey:command.idempotencyKey,newOwnedActivity:{professionLayer:'PFL-002',channelCode:'CHN-004'}};
    expect(managementCreate.safeParse(create).success).toBe(true);
    expect(managementCreate.safeParse({...create,ownedActivityCode:'ATV-008'}).success).toBe(false);
    expect(managementCreate.safeParse({...create,newOwnedActivity:{...create.newOwnedActivity,code:'FORGED'}}).success).toBe(false);
  });
  it('accepts recipient and catalog market selection without computed or arbitrary fields',()=>{
    const fields={serviceRecipient:'VNA',marketScope:'SELECTED',marketCodes:['VN','JP']};
    expect(managementChange.safeParse({...command,fields}).success).toBe(true);
    expect(managementChange.safeParse({...command,fields:{...fields,marketScope:'ANY'}}).success).toBe(false);
    expect(managementChange.safeParse({...command,fields:{...fields,marketCodes:['VN',10]}}).success).toBe(false);
  });
});
