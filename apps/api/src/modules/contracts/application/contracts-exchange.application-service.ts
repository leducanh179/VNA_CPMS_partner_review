import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SPREADSHEET_DOCUMENT_PORT, type SpreadsheetDocumentPort, type TabularWorkbookData } from '@cpms/integrations';
import type { ActorContext, SupplySourceSnapshot } from '@cpms/domain';
import { ContractsApplicationService } from './contracts.application-service';
import { SUPPLY_SOURCE_TABS } from '../domain/source-import';
import { appDate, effectivePair, subtract } from '../domain/supply-engine';

type ExportData = Awaited<ReturnType<ContractsApplicationService['exportContract']>>;
const table = (name: string, records: Record<string, unknown>[]) => {
  const headers = [...new Set(records.flatMap(r => Object.keys(r)))].filter(k=>!k.startsWith('_'));
  if(!headers.length)headers.push('source_key');
  return { name, rows: [headers, ...records.map(r => headers.map(h => r[h] == null ? null : typeof r[h] === 'boolean' ? r[h] as boolean : String(r[h])))] };
};

/** Exchange is a source snapshot, not a way to forge CPMS approval/audit records. */
@Injectable()
export class ContractsExchangeApplicationService {
  constructor(@Inject(ContractsApplicationService) private readonly contracts: ContractsApplicationService,
    @Inject(SPREADSHEET_DOCUMENT_PORT) private readonly spreadsheets: SpreadsheetDocumentPort) {}

  previewJson(input: SupplySourceSnapshot | {format:string;sourceSnapshot:SupplySourceSnapshot}, actor?:ActorContext) {
    if(!input || typeof input!=='object')throw new BadRequestException('Snapshot không hợp lệ.');
    const snapshot='format' in input ? input.sourceSnapshot : input;
    if(!snapshot) throw new BadRequestException('Bản JSON cần sourceSnapshot; lịch sử và inventory trong archive không phải dữ liệu nhập.');
    return this.contracts.importPreview(snapshot,actor);
  }

  async previewFile(input:{fileName:string;contentBase64:string;sourceId?:string;locale?:string}, actor?:ActorContext) {
    if(!input || typeof input.fileName!=='string' || !input.fileName.toLowerCase().endsWith('.xlsx') || typeof input.contentBase64!=='string' || input.contentBase64.length>11_200_000)
      throw new BadRequestException('Chọn XLSX tối đa 8 MB.');
    await this.contracts.catalogs(actor);
    let workbook:TabularWorkbookData;
    try { workbook=await this.spreadsheets.read({fileName:input.fileName,content:Buffer.from(input.contentBase64,'base64')}); }
    catch { throw new BadRequestException('Không đọc được XLSX.'); }
    const guide=workbook.sheets.find(s=>s.name==='Huong_dan');
    const exportedId=guide?.rows.find(r=>r[0]==='CPMS_SUPPLY_V1')?.[1];
    const sourceId=input.sourceId?.trim() || (typeof exportedId==='string'?exportedId:'');
    if(!sourceId || sourceId.length>200) throw new BadRequestException('Cần mã nguồn ổn định cho XLSX chưa xuất từ CPMS.');
    const snapshot:SupplySourceSnapshot={spreadsheetId:sourceId,locale:exportedId?'en_US':input.locale??'en_US',timeZone:'Asia/Ho_Chi_Minh',readAt:new Date().toISOString(),
      sheets:workbook.sheets.filter(s=>(SUPPLY_SOURCE_TABS as readonly string[]).includes(s.name)).map(s=>({name:s.name,rows:s.rows.map(row=>row.map(value=>({value})))}))};
    return this.contracts.importPreview(snapshot,actor);
  }

  private workbook(d:ExportData):TabularWorkbookData {
    const c=d.contract;const at=d.exportedAt;
    return {sheets:[
      table('cpms_contract_info',[{contract_id:c.code,contract_no:c.number,contract_name:c.name,vendor_name:c.vendor,contract_type:c.supplyType==='INTERNAL'?'owned_media':'paid_media',owner_unit:c.ownerUnitCode,owner_department:c.ownerDepartment,contract_manager:c.managerEmail,contract_start_date:c.startDate,contract_end_date:c.endDate,currency:c.currency,total_amount_no_vat:c.signedAmount,total_vat_amount:c.signedVat,total_amount_with_vat:c.signedGross,contract_status:c.status.toLowerCase(),dossier_url:c.dossierUrl}]),
      table('cpms_slot_master',d.slots.map(s=>({slot_id:s.code,contract_id:c.code,slot_name:s.name,slot_description:s.description,unit:s.unit,quantity_unit:s.quantityUnit,price_basis:s.priceBasis,base_unit_cost_no_vat:s.unitPrice,total_contract_qty:s.totalQty,total_amount_no_vat:s.signedAmount,professional_layer:s.businessType==='PRODUCTION'?'production':s.businessType==='MEDIA'?'advertising':'unknown',media_channel:s.channel,specific_channel:s.specificChannel,cost_type:s.costType==='VENDOR_FOC'?'vendor_free_of_charge':s.costType==='INTERNAL_ZERO'?'owned_media':s.costType==='PAID'?'paid_media':'unknown',market_code:s.marketCode,slot_bookers:s.bookers.map(b=>b.email).join(';'),contract_manager:s.managerEmail,material_requirement:s.materialRequirement,preview_url:s.previewUrl,slot_status:s.status.toLowerCase(),slot_start_date:s.startDate,slot_end_date:s.endDate,capacity_mode:s.capacityMode,capacity:s.capacity}))),
      table('cpms_slot_allocation_period',d.allocations.filter(a=>!a.supersededAt).map(a=>{
        const slot=d.slots.find(s=>s.id===a.slotId);const p=d.periods.find(p=>p.id===a.periodId)!;
        const effective=effectivePair(d,a,at,a.status!=='APPROVED');
        return {allocation_id:a.sourceKey??`cpms-${a.id}`,slot_id:slot?.code??null,contract_id:c.code,scope_kind:a.scopeKind,limit_mode:a.limitMode,period_code:p.code,period_name:p.name,period_kind:p.kind,period_start_date:p.startDate,period_end_date:p.endDate,planned_qty:a.baselineQty,planned_unit_cost_no_vat:a.unitPrice,planned_amount_no_vat:a.baselineAmount,planned_tax_rate:a.taxRate,vat_estimated:a.vatEstimated,allocation_status:a.status==='APPROVED'?'approved':'draft',adjustment_qty:subtract(effective.qty,a.baselineQty),adjustment_amount_no_vat:subtract(effective.amount,a.baselineAmount),effective_qty:effective.qty,effective_amount_no_vat:effective.amount,allocation_version:a.sourceVersion??String(a.recordVersion),slot_operator:a.beneficiaryUnitCode??'Toàn hợp đồng',adjustment_reason:'Snapshot vận hành CPMS; lịch sử đầy đủ ở archive JSON.',note:a.vatEstimated?'VAT dự kiến; nhập lại chỉ làm nguồn đối soát.':'Nhập lại chỉ làm nguồn đối soát; không tạo quyết định duyệt CPMS.'};
      })),
      table('bravo_contract_header_raw',c.source.bravoHeader?[c.source.bravoHeader as Record<string,unknown>]:[]),
      table('bravo_contract_line_raw',d.financialLines.map(l=>l.source as Record<string,unknown>)),
      table('cpms_slot_bravo_line_map',d.financialMaps.map(l=>l.source as Record<string,unknown>)),
    ]};
  }

  async exportBundle(id:string,actor?:ActorContext) {
    const data=await this.contracts.exportContract(id,actor);const workbook=this.workbook(data);
    const sourceId=String(data.contract.source.spreadsheetId??`cpms-export-${data.contract.id}`);
    const sourceSnapshot:SupplySourceSnapshot={spreadsheetId:sourceId,locale:'en_US',timeZone:'Asia/Ho_Chi_Minh',readAt:data.exportedAt,
      sheets:workbook.sheets.map(s=>({name:s.name,rows:s.rows.map(r=>r.map(value=>({value})))}))};
    const future=data.adjustments.filter(g=>g.status==='APPROVED'&&g.effectiveDate&&g.effectiveDate>appDate(data.exportedAt)).length;
    return {...data,sourceSnapshot,exchangeNotice:`sourceSnapshot là hạn mức tại thời điểm xuất, giữ draft riêng. Archive giữ ${future} nhóm đã duyệt có hiệu lực tương lai và toàn bộ lịch sử. Khôi phục đầy đủ lịch sử phải dùng backup PostgreSQL; import không tái tạo người/ngày duyệt.`};
  }

  async exportFile(id:string,actor?:ActorContext) {
    const data=await this.exportBundle(id,actor);const workbook=this.workbook(data);
    workbook.sheets.push({name:'Huong_dan',rows:[['CPMS_SUPPLY_V1',data.sourceSnapshot.spreadsheetId],['Locale','en_US'],['Phạm vi',data.exchangeNotice],['Số tính toán','Không nhập usage/remaining. Effective chỉ để đối soát.'],['Đọc tại',data.exportedAt]]});
    return {fileName:`${data.contract.code}-nguon-cung.xlsx`,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',contentBase64:Buffer.from(await this.spreadsheets.write(workbook)).toString('base64'),sourceId:data.sourceSnapshot.spreadsheetId};
  }
}
