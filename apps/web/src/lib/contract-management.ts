import { contractValidity, contractValidityLabels, supplyClassLabel, type ContractChangeKind, type ContractChangeRequest, type SupplyContractView } from '@cpms/domain';
import { bookingSum } from './booking-money';
import { formatSupply } from '../components/supply-grid';

export const contractFieldLabels: Record<string,string> = {
  code: 'Mã hợp đồng', vendorCode: 'Mã nhà cung cấp', name: 'Tên hợp đồng', number: 'Số hợp đồng', vendor: 'Nhà cung cấp', serviceRecipient:'Bên hưởng dịch vụ',marketScope:'Phạm vi thị trường',marketCodes:'Thị trường áp dụng',
  supplyType: 'Phân loại',
  startDate: 'Thời gian bắt đầu hiệu lực', endDate: 'Thời gian kết thúc hiệu lực', leaderActorId: 'LĐP phụ trách', managerActorId: 'CV phụ trách', vendorActorId: 'Đầu mối đối tác',
  signedAmount: 'Tổng giá trị hợp đồng (trước VAT)', signedVat: 'Thuế VAT', signedGross: 'Tổng giá trị hợp đồng (sau VAT)', currency: 'Loại tiền', dossierUrl: 'Link bản scan hợp đồng',
};
export const contractEditableKeys = ['name','supplyType','number','vendor','serviceRecipient','startDate','endDate','marketScope','leaderActorId','managerActorId','vendorActorId','signedAmount','signedVat','currency','dossierUrl'] as const;
export const contractChangeLabels: Record<ContractChangeKind,string> = { EDIT: 'Sửa thông tin hợp đồng', PAUSE: 'Tạm dừng hợp đồng', RESUME: 'Tiếp tục hợp đồng', DELETE: 'Chuyển hợp đồng vào Thùng rác', RESTORE: 'Phục hồi hợp đồng' };
export const contractRequestLabels: Record<ContractChangeRequest['state'],string> = { DRAFT:'Bản nháp',PENDING:'Chờ LĐP duyệt',APPROVED:'Đã áp dụng',RETURNED:'Đã trả lại',WITHDRAWN:'Đã rút' };
export function contractPatch(fields: Record<string,string>): Record<string,unknown> {
  const out: Record<string,unknown> = {};
  for (const [key,value] of Object.entries(fields)) if ((contractEditableKeys as readonly string[]).includes(key)) out[key] = ['name','currency','marketScope'].includes(key) ? value.trim() : value.trim() || null;
  return out;
}
export function contractGross(amount: unknown, vat: unknown) { return amount != null && amount !== '' && vat != null && vat !== '' ? bookingSum([String(amount),String(vat)]) : null; }
export function contractHeaderChanged(contract: SupplyContractView, fields: Record<string,string>, marketCodes: string[], supplierId: string): boolean {
  return contractEditableKeys.some(key=>String(contract[key]??(key==='marketScope'?'UNSPECIFIED':''))!==String(fields[key]??''))
    || JSON.stringify([...(contract.marketCodes??[])].sort())!==JSON.stringify([...marketCodes].sort())
    || supplierId!==(contract.supplierId??'');
}
export function contractFieldValue(key: string, value: unknown, people: Array<{id:string;name:string;email:string|null}> = []): string {
  if (key==='supplyType') return supplyClassLabel(value);
  if(key==='marketScope')return ({UNSPECIFIED:'Chưa xác định',ALL:'Toàn bộ thị trường',SELECTED:'Chọn thị trường'} as Record<string,string>)[String(value)]??'Chưa xác định';
  if(key==='marketCodes')return Array.isArray(value)?value.join(', ')||'—':'—';
  if (key.endsWith('ActorId')) { const person = people.find(p => p.id === value); return person ? key === 'vendorActorId' ? person.email ?? person.name : person.name : '—'; }
  if (key.startsWith('signed')) return formatSupply(value);
  if ((key === 'startDate' || key === 'endDate') && value) return String(value).slice(0,10).split('-').reverse().join('/');
  return value == null || value === '' ? '—' : String(value);
}
export function contractStatus(c: SupplyContractView) { return contractValidityLabels[contractValidity(c)]; }
export function contractsChanged() { window.dispatchEvent(new Event('cpms:contracts-changed')); window.dispatchEvent(new Event('cpms:workflow-updated')); window.dispatchEvent(new Event('cpms:access-updated')); }
