import type { SupplySourceSnapshot } from '@cpms/domain';
import type { SupplyCatalogs } from './source-import';

/** Synthetic public fixture; never production source data or a seed. */
export const syntheticSupplyCatalogs: SupplyCatalogs = {
  units: [{code:'UNIT_A',displayName:'Unit A',sourceName:null},{code:'UNIT_B',displayName:'Unit B',sourceName:null}],
  people:[{employeeCode:'SYN-001',email:'manager@example.test',fullName:'Synthetic Manager'}],
  actors:[{id:'00000000-0000-4000-8000-000000000099',loginEmail:'manager@example.test',personnelEmployeeCode:'SYN-001'}],markets:[{code:'TEST'}],
};
export function syntheticSource(): SupplySourceSnapshot {
  const sheet = (name:string, records:Record<string,unknown>[]) => {
    const headers = [...new Set(records.flatMap(r=>Object.keys(r)))];
    return {name,rows:[headers.map(value=>({value})),...records.map(r=>headers.map(h=>({value:(r[h]??null) as string|number|boolean|null})))]};
  };
  return {spreadsheetId:'synthetic-source',locale:'en_US',timeZone:'Asia/Saigon',readAt:'2026-09-09T00:00:00Z',sheets:[
    sheet('cpms_contract_info',[{contract_id:'CON-SYN-1',contract_no:'SYN-1',contract_name:'Synthetic Supply',vendor_name:'Synthetic Vendor',owner_unit:'Unit A',owner_department:'Synthetic Department',contract_manager:'manager@example.test',contract_start_date:'2025-01-01',contract_end_date:'2027-12-31',total_amount_no_vat:10000,total_vat_amount:800,total_amount_with_vat:10800,contract_status:'active'}]),
    sheet('cpms_slot_master',[{slot_id:'SLOT-SYN-1',contract_id:'CON-SYN-1',slot_name:'Synthetic banner',unit:'CPM',base_unit_cost_no_vat:100,total_contract_qty:100,total_amount_no_vat:10000,cost_type:'paid_media',professional_layer:'advertising',market_code:'TEST','slot_booker 1':'manager@example.test','slot_booker 2':'manager@example.test',slot_status:'active'}]),
    sheet('cpms_slot_allocation_period',[
      {allocation_id:'A-1',slot_id:'SLOT-SYN-1',contract_id:'CON-SYN-1',period_code:'2026',period_name:'Year 2026',period_start_date:'2026-01-01',period_end_date:'2026-12-31',planned_qty:40,planned_unit_cost_no_vat:100,planned_amount_no_vat:4000,planned_tax_rate:0.08,allocation_status:'approved',adjustment_qty:-10,adjustment_amount_no_vat:-1000,effective_qty:30,effective_amount_no_vat:3000,allocation_version:4,slot_operator:'Unit A'},
      {allocation_id:'A-2',slot_id:'SLOT-SYN-1',contract_id:'CON-SYN-1',period_code:'2026',period_name:'Year 2026',period_start_date:'2026-01-01',period_end_date:'2026-12-31',planned_qty:20,planned_unit_cost_no_vat:100,planned_amount_no_vat:2000,allocation_status:'approved',adjustment_qty:0,adjustment_amount_no_vat:0,effective_qty:20,effective_amount_no_vat:2000,allocation_version:1,slot_operator:'Unit B'},
      {allocation_id:'A-3',slot_id:'SLOT-SYN-1',contract_id:'CON-SYN-1',period_code:'2027',period_name:'Year 2027',period_start_date:'2027-01-01',period_end_date:'2027-12-31',planned_qty:40,planned_unit_cost_no_vat:100,planned_amount_no_vat:4000,allocation_status:'draft',adjustment_qty:5,adjustment_amount_no_vat:500,effective_qty:45,effective_amount_no_vat:4500,allocation_version:2,slot_operator:'Unit A'},
    ]),
  ]};
}
