import { describe, expect, it } from 'vitest';
import { activityForItem, capturedClassificationLabel, canonicalChannel, canonicalLayer, changeItemClassification, defaultProfessionLayer, type SupplyChannelMap } from './channel-map';
import type { ContractItemValue } from './contract-items';
const map:SupplyChannelMap={version:1,sourceUrl:'https://example.test/map',capturedAt:'2026-09-23T00:00:00Z',layers:[],channels:[],activities:[
  {code:'A',name:'Paid',professionLayer:'PFL-001',channelCode:'CHN-001',description:'',supplyType:'PAID',unit:'click'},
  {code:'B',name:'Owned',professionLayer:'PFL-002',channelCode:'CHN-004',description:'',supplyType:'INTERNAL',unit:'bài'},
]};
const item={professionLayer:'PF001',channelCode:'CH001',activityCode:'A',supplyType:'INHERIT'} as ContractItemValue;
describe('Contract channel hierarchy',()=>{
  it('defaults from the responsible department without guessing unknown departments',()=>{
    expect(defaultProfessionLayer('Phòng Thương hiệu')).toBe('PFL-001');
    expect(defaultProfessionLayer('Phòng Truyền thông')).toBe('PFL-002');
    expect(defaultProfessionLayer('Phòng Sự kiện tài trợ')).toBe('PFL-003');
    expect(defaultProfessionLayer('Phòng Kế hoạch')).toBeNull();
  });
  it('reads legacy aliases while validating the full parent chain',()=>{
    expect(canonicalLayer('PF004')).toBe('PFL-004');expect(canonicalChannel('CH013')).toBe('CHN-013');
    expect(activityForItem(map,item)?.code).toBe('A');
    expect(activityForItem(map,{...item,channelCode:'CH004'})).toBeUndefined();
  });
  it('clears stale children on parent edits while accepting a valid full-row paste',()=>{
    expect(changeItemClassification(item,{professionLayer:'PFL-002'},map)).toMatchObject({professionLayer:'PFL-002',channelCode:null,activityCode:null,supplyType:'INHERIT'});
    expect(changeItemClassification(item,{channelCode:'CHN-004'},map).activityCode).toBeNull();
    expect(changeItemClassification(item,{professionLayer:'PFL-002',channelCode:'CHN-004',activityCode:'B'},map)).toMatchObject({activityCode:'B',channelCode:'CHN-004',supplyType:'INHERIT'});
  });
  it('preserves the item classification on unrelated edits and never infers sourcing from price',()=>{
    expect(changeItemClassification(item,{unitPrice:'0'},map)).toEqual({...item,unitPrice:'0'});
    expect(changeItemClassification(item,{supplyType:'INTERNAL'},map).activityCode).toBe('A');
  });
  it('shows the published name after catalog renames but drops stale names while changing classification',()=>{
    const captured={...item,classificationSnapshot:{professionLayer:'PFL-001',professionLayerName:'Original layer',channelCode:'CHN-001',channelName:'Original channel',activityCode:'A',activityName:'Original activity',catalogVersion:1}};
    expect(capturedClassificationLabel(captured,'activityCode')).toBe('Original activity');
    expect(capturedClassificationLabel(changeItemClassification(captured,{activityCode:'B'},map),'activityCode')).toBeUndefined();
  });
});
