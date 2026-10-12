import { describe,expect,it } from 'vitest';
import type { ChannelMapCatalog,SupplyContractView } from '@cpms/domain';
import { ownedProfilesOutsideCatalog } from './owned-catalog-profiles';
describe('Owned profiles survive dictionary lifecycle changes',()=>{
  const profile={id:'owned-profile',supplyType:'INTERNAL',source:{kind:'OWNED_MEDIA',ownedActivityCode:'ATV-001'}} as unknown as SupplyContractView;
  const catalog=(type:'INTERNAL'|'PAID')=>({data:{activities:[{code:'ATV-001',supplyType:type}]}} as ChannelMapCatalog);
  it('keeps a profile visible after its Activity is removed from the active dictionary',()=>{expect(ownedProfilesOutsideCatalog([profile],{data:{activities:[]}} as unknown as ChannelMapCatalog)).toEqual([profile]);});
  it('avoids a duplicate row when the active owned Activity supplies its display row',()=>{expect(ownedProfilesOutsideCatalog([profile],catalog('INTERNAL'))).toEqual([]);});
  it('retains an inherited profile whose Activity now classifies new supply as paid media',()=>{expect(ownedProfilesOutsideCatalog([profile],catalog('PAID'))).toEqual([profile]);});
  it('retains a legacy profile without a dictionary link',()=>{expect(ownedProfilesOutsideCatalog([{...profile,source:{}}],catalog('INTERNAL'))).toHaveLength(1);});
});
