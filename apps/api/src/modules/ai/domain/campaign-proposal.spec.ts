import { describe,expect,it } from 'vitest';
import type { CampaignSummary } from '@cpms/domain';
import { buildCampaignProposal } from './campaign-proposal';
const current={ name:'Hồ sơ mẫu',recordVersion:4,descriptionRichText:null,fieldValues:{},startDate:null,levelCode:'CLV_02' } as unknown as CampaignSummary;
describe('AI campaign proposals',()=>{
  it('builds an allowlisted patch with exact expected version and readable before/after values',()=>{
    const value=buildCampaignProposal(current,[{field:'campaign_name',value:'Tên mới'},{field:'descriptionText',value:'Mô tả\nĐoạn hai'}]);
    expect(value.patch).toMatchObject({expectedVersion:4,name:'Tên mới',descriptionRichText:{schemaVersion:1,type:'doc'}});
    expect(value.changes[0]).toMatchObject({field:'name',before:'Hồ sơ mẫu',after:'Tên mới'});
    expect(current.name).toBe('Hồ sơ mẫu');
  });
  it('rejects status/approval fields, invalid dates, alias collisions and no-ops',()=>{
    for(const field of ['lifecycleState','campaign_lifecycle_state','department_approval_state','campaign_folder_link','actorId','__proto__'])
      expect(()=>buildCampaignProposal(current,[{field,value:'APPROVED'}])).toThrow();
    expect(()=>buildCampaignProposal(current,[{field:'startDate',value:'2026-02-30'}])).toThrow();
    expect(()=>buildCampaignProposal(current,[{field:'name',value:'A'},{field:'campaign_name',value:'B'}])).toThrow();
    expect(()=>buildCampaignProposal(current,[{field:'name',value:current.name}])).toThrow();
  });
});
