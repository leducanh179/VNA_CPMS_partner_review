import { createHash } from 'node:crypto';
import type { SupplyAggregate, SupplyAllocationView, SupplyQuality, SupplySourceSnapshot, SupplySlotView } from '@cpms/domain';
import { calendarMonths, decimal, parseSourceDate, parseSourceNumber, sum } from './supply-engine';

export const SUPPLY_SOURCE_TABS = ['cpms_contract_info','cpms_slot_master','cpms_slot_allocation_period','bravo_contract_header_raw','bravo_contract_line_raw','cpms_slot_bravo_line_map'] as const;
export interface SupplyCatalogs {
  units: Array<{ code: string; displayName: string; sourceName: string | null }>;
  people: Array<{ employeeCode: string; email: string | null; fullName: string }>;
  actors: Array<{ id: string; loginEmail: string | null; personnelEmployeeCode: string | null }>;
  markets: Array<{ code: string; name?: string; regionCode?: string }>;
}
type SourceRow = Record<string, unknown> & { _row: number; _sheet: string };
export interface NormalizedSupplyImport {
  aggregate: SupplyAggregate; aliases: string[]; warnings: SupplyQuality[]; blocking: SupplyQuality[];
  financialLines: SourceRow[]; financialMaps: SourceRow[]; snapshot: SupplySourceSnapshot; digest: string;
}
export function snapshotDigest(snapshot: SupplySourceSnapshot): string {
  // Read time and derived cached remaining columns are not operational source changes.
  const excluded = new Set(['remaining_month_count','avg_remaining_qty_per_month']);
  const sheets = snapshot.sheets.filter(s => (SUPPLY_SOURCE_TABS as readonly string[]).includes(s.name)).map(s => {
    const keys = s.rows[0]?.map(c => String(c.value ?? '')) ?? [];
    return { name: s.name, rows: s.rows.map(row => row.map((cell, i) => excluded.has(keys[i]!) ? null : { value: cell.value, raw: cell.raw ?? null })) };
  });
  return createHash('sha256').update(JSON.stringify({ normalizerVersion: '1.1', source: snapshot.spreadsheetId, locale: snapshot.locale, sheets })).digest('hex');
}
export function normalizeSupplySource(snapshot: SupplySourceSnapshot, catalogs: SupplyCatalogs): NormalizedSupplyImport {
  if (!snapshot.spreadsheetId || !['vi_VN','en_US'].includes(snapshot.locale) || !Number.isFinite(Date.parse(snapshot.readAt))) throw new Error('INVALID_SOURCE_METADATA');
  if (snapshot.sheets.some(s => !(SUPPLY_SOURCE_TABS as readonly string[]).includes(s.name))) throw new Error('SOURCE_TAB_NOT_ALLOWED');
  if (snapshot.sheets.length > 6 || new Set(snapshot.sheets.map(s => s.name)).size !== snapshot.sheets.length) throw new Error('DUPLICATE_SOURCE_TAB');
  if (snapshot.sheets.some(s => s.rows.length > 1001 || s.rows.some(r => r.length > 80))) throw new Error('SOURCE_TOO_LARGE');
  const warnings: SupplyQuality[] = [], blocking: SupplyQuality[] = [];
  const issue = (code: string, message: string, row?: SourceRow, severity: SupplyQuality['severity'] = 'WARNING') => {
    const item: SupplyQuality = { code, message, severity, ...(row ? { row: row._row, sheet: row._sheet } : {}) };
    (severity === 'BLOCK' ? blocking : warnings).push(item); return item;
  };
  const records = (name: string): SourceRow[] => {
    const sheet = snapshot.sheets.find(s => s.name === name);
    if (!sheet?.rows.length) return [];
    const keys = sheet.rows[0]!.map(c => String(c.value ?? '').trim());
    if (keys.filter(Boolean).some((key, i, all) => all.indexOf(key) !== i)) throw new Error('DUPLICATE_COLUMN');
    return sheet.rows.slice(1).flatMap((row, i) => row.some(c => c.value !== null && c.value !== '') ? [{ ...Object.fromEntries(keys.filter(Boolean).map(key => [key, row[keys.indexOf(key)]?.value ?? null])), _row: i + 2, _sheet: name }] : []);
  };
  const text = (value: unknown) => value == null || value === '' ? null : String(value).trim();
  const number = (v: unknown) => parseSourceNumber(v, snapshot.locale);
  const source = (row: SourceRow) => ({ spreadsheetId: snapshot.spreadsheetId, sheet: row._sheet, row: row._row, sourceKey: row.allocation_id ?? row.slot_id ?? row.contract_id ?? null, readAt: snapshot.readAt, sourceNote: row.note ?? null });
  const units = (value: unknown) => {
    const label = text(value); if (!label) return null;
    const exact = catalogs.units.filter(u => [u.code, u.displayName, u.sourceName].some(n => n?.toLocaleLowerCase() === label.toLocaleLowerCase()));
    if (exact.length === 1) return exact[0]!.code;
    if (label === 'Ban Truyền thông' && catalogs.units.some(u => u.code === 'BAN_TT')) return 'BAN_TT';
    return null;
  };
  const headers = records('cpms_contract_info');
  if (headers.length !== 1) throw new Error('ONE_CONTRACT_HEADER_REQUIRED');
  const h = headers[0]!; const slotsRaw = records('cpms_slot_master'); const allocationRaw = records('cpms_slot_allocation_period');
  const financialHeaders = records('bravo_contract_header_raw'); const financialLines = records('bravo_contract_line_raw'); const financialMaps = records('cpms_slot_bravo_line_map');
  const aliasSet = new Set([text(h.contract_id), ...slotsRaw.map(s => text(s.contract_id)), ...allocationRaw.map(a => text(a.contract_id))].filter((s): s is string => Boolean(s)));
  if (aliasSet.size > 1) {
    const bravoId = text(h.bravo_biz_doc_id)?.toUpperCase();
    const financialHeader = financialHeaders.find(b => text(b.BizDocId)?.toUpperCase() === bravoId && text(b.DocNo) === text(h.contract_no));
    if (!bravoId || !financialHeader || slotsRaw.some(s => text(s.bravo_biz_doc_id)?.toUpperCase() !== bravoId) || [...aliasSet].some(alias => !alias.toUpperCase().endsWith(bravoId))) {
      issue('UNRESOLVED_CONTRACT_ALIAS','Các mã hợp đồng chưa có đủ bằng chứng cùng số HĐ/Bravo ID.', undefined, 'BLOCK');
    } else issue('VERIFIED_CONTRACT_ALIAS','Mã header và slot khác nhau; đã đối chiếu số HĐ và Bravo ID, lưu alias có truy vết.');
  }
  const code = [...aliasSet].find(id => id.startsWith('CON-')) ?? text(h.contract_id);
  if (!code || !text(h.contract_name)) throw new Error('CONTRACT_IDENTITY_REQUIRED');
  const managerEmail = text(h.contract_manager)?.toLowerCase() ?? null;
  const manager = catalogs.actors.find(a => a.loginEmail?.toLowerCase() === managerEmail);
  const contract: SupplyAggregate['contract'] = {
    id: code, code, number: text(h.contract_no), name: String(h.contract_name), vendor: text(h.vendor_name), supplyType: h.contract_type === 'owned_media' ? 'INTERNAL' : 'PAID',
    ownerUnitCode: units(h.owner_unit), ownerDepartment: text(h.owner_department), managerActorId: manager?.id ?? null, managerEmail,
    startDate: parseSourceDate(h.contract_start_date), endDate: parseSourceDate(h.contract_end_date), currency: text(h.currency) ?? text(financialHeaders[0]?.CurrencyCode) ?? 'VND',
    signedAmount: number(h.total_amount_no_vat), signedVat: number(h.total_vat_amount), signedGross: number(h.total_amount_with_vat),
    status: ['active','paused','archived'].includes(String(h.contract_status)) ? String(h.contract_status).toUpperCase() : 'DRAFT', dossierUrl: text(h.dossier_url), source: { ...source(h), rawHeader: h, bravoHeader: financialHeaders[0] ?? null }, quality: [], recordVersion: 1, localRevision: 0, createdByActorId: '',
  };
  if (!manager) contract.quality.push(issue('UNRESOLVED_MANAGER','Email quản lý nguồn chưa liên kết tài khoản hiện hành.',h));
  if(!contract.startDate||!contract.endDate||contract.signedAmount===null||!contract.ownerUnitCode)contract.quality.push(issue('CONTRACT_CONTROL_MISSING','Thiếu thời hạn, đơn vị hoặc trần tiền hợp đồng; giữ nguồn và chưa kích hoạt hạn mức.',h,'BLOCK'));
  if (contract.signedAmount != null && contract.signedVat != null && contract.signedGross != null && decimal(contract.signedAmount).plus(contract.signedVat).minus(contract.signedGross).abs().gt('0.01')) contract.quality.push(issue('SIGNED_VAT_MISMATCH','Giá trị ký trước VAT + VAT khác sau VAT.',h));
  if (!financialLines.length) contract.quality.push(issue('BRAVO_MAPPING_MISSING','Chưa có dòng tài chính Bravo; kho demo vẫn dùng được.',h));
  const slots: SupplySlotView[] = slotsRaw.map(s => {
    const quality: SupplyQuality[] = [];
    const unit = text(s.unit); const qty = number(s.total_contract_qty); const price = number(s.base_unit_cost_no_vat); const amount = number(s.total_amount_no_vat);
    const id = text(s.slot_id); if (!id || !text(s.slot_name)) throw new Error('SLOT_IDENTITY_REQUIRED');
    if(qty===null||!unit||[qty,price,amount].some(n=>n!==null&&decimal(n).lt(0)))quality.push(issue('SLOT_CONTROL_MISSING','Slot thiếu đơn vị/quyền lợi hoặc có giá trị âm; chưa kích hoạt phân bổ.',s,'BLOCK'));
    let priceBasis: string | null = s.price_basis == null ? '1' : number(s.price_basis);
    if (unit === 'CPM' && s.price_basis == null) {
      if (qty !== null && price !== null && amount !== null && decimal(qty).mul(price).minus(amount).abs().lte('0.01')) quality.push(issue('CPM_PACKAGE_BASIS','Qty nguồn là gói 1.000 impressions; Qty × đơn giá, không chia 1.000 lần nữa.',s));
      else { priceBasis = null; quality.push(issue('CPM_BASIS_UNKNOWN','Chưa xác định Qty CPM là impressions hay gói 1.000.',s,'BLOCK')); }
    }
    if (qty != null && price != null && amount != null && decimal(qty).mul(price).minus(amount).abs().gt('0.01')) quality.push(issue('SLOT_AMOUNT_MISMATCH','Số lượng × đơn giá khác thành tiền dòng slot.',s));
    quality.push(issue('CLASSIFICATION_REVIEW','Giữ phân loại nguồn; chưa đối chiếu đủ quy hoạch slot.',s));
    const bookers = [...new Set([s['slot_booker 1'], s['slot_booker 2'], s['slot_booker 3'],...String(s.slot_bookers??'').split(/[;,\n]/)].map(v => text(v)?.toLowerCase()).filter((v): v is string => Boolean(v)))].map(email => ({ email, personnelCode: catalogs.people.find(p => p.email?.toLowerCase() === email)?.employeeCode ?? null }));
    return { id, contractId: code, code: id, name: String(s.slot_name), unit, quantityUnit: text(s.quantity_unit) ?? (unit === 'CPM' ? 'Gói 1.000 impressions' : unit === 'CPC' ? 'Click' : unit),
      priceBasis, unitPrice: price, totalQty: qty, signedAmount: amount, costType: s.cost_type === 'vendor_free_of_charge' ? 'VENDOR_FOC' : s.cost_type === 'production' ? 'PAID' : s.cost_type === 'owned_media' ? 'INTERNAL_ZERO' : s.cost_type === 'paid_media' ? 'PAID' : 'UNKNOWN',
      businessType: s.professional_layer === 'production' ? 'PRODUCTION' : ['advertising','media'].includes(String(s.professional_layer)) ? 'MEDIA' : 'UNKNOWN', channel: text(s.media_channel), specificChannel: text(s.specific_channel),
      marketCode: catalogs.markets.some(m => m.code === s.market_code) ? String(s.market_code) : null,
      description: text(s.slot_description), materialRequirement: text(s.material_requirement), previewUrl: text(s.preview_url), managerEmail: text(s.contract_manager),
      startDate: parseSourceDate(s.slot_start_date), endDate: parseSourceDate(s.slot_end_date), status: ['active','paused','archived'].includes(String(s.slot_status)) ? String(s.slot_status).toUpperCase() : 'DRAFT', capacityMode: ['UNRESTRICTED','EXCLUSIVE','SHARED_CAPACITY'].includes(String(s.capacity_mode)) ? s.capacity_mode as SupplySlotView['capacityMode'] : 'UNKNOWN', capacity: s.capacity == null ? null : Number(number(s.capacity)),
      source: { ...source(s), classification: { professionalLayer: s.professional_layer, mediaChannel: s.media_channel, specificChannel: s.specific_channel, costType: s.cost_type, market: s.market_code } }, quality, recordVersion: 1, bookers };
  });
  if (new Set(slots.map(s => s.id)).size !== slots.length) throw new Error('DUPLICATE_SLOT_KEY');
  const aggregate: SupplyAggregate = { contract, slots, periods: [], allocations: [], adjustments: [] };
  const groups = new Map<string, SupplyAggregate['adjustments'][number]>();
  for (const a of allocationRaw) {
    const quality: SupplyQuality[] = [];
    const slot = slots.find(s => s.id === a.slot_id);
    const isCap = a.scope_kind === 'CAP';
    if (!slot && (!isCap || a.slot_id)) { issue('MISSING_SLOT', 'Phân bổ tham chiếu slot không có trong nguồn.', a, 'BLOCK'); continue; }
    const start = parseSourceDate(a.period_start_date), end = parseSourceDate(a.period_end_date), periodCode = text(a.period_code);
    if (!start || !end || !periodCode || start > end) { issue('INVALID_PERIOD','Thiếu hoặc sai kỳ phân bổ.',a,'BLOCK'); continue; }
    let period = aggregate.periods.find(p => p.code === periodCode);
    if (period && (period.startDate !== start || period.endDate !== end)) { issue('PERIOD_CONFLICT','Cùng mã kỳ nhưng khác ngày.',a,'BLOCK'); continue; }
    if (!period) { period = { id: periodCode, code: periodCode, name: text(a.period_name) ?? periodCode, kind: ['CONTRACT','YEAR','HALF_YEAR','QUARTER','MONTH','CUSTOM'].includes(String(a.period_kind)) ? String(a.period_kind) : 'CUSTOM', startDate: start, endDate: end }; aggregate.periods.push(period); }
    const baselineQty = number(a.planned_qty), baselineAmount = number(a.planned_amount_no_vat), deltaQty = number(a.adjustment_qty) ?? '0', deltaAmount = number(a.adjustment_amount_no_vat) ?? '0';
    for (const [base, delta, effective, label, tolerance] of [[baselineQty,deltaQty,number(a.effective_qty),'Qty','0.00000001'],[baselineAmount,deltaAmount,number(a.effective_amount_no_vat),'Amount','0.01']] as const) {
      if (!(base == null && effective == null && decimal(delta).isZero() && (isCap || label === 'Qty' && baselineAmount !== null)) && (base == null || effective == null || decimal(base).plus(delta).minus(effective).abs().gt(tolerance))) quality.push(issue('EFFECTIVE_MISMATCH',`Baseline + delta không bằng effective ${label}; giữ nguồn, chưa kích hoạt.`,a,'BLOCK'));
    }
    const unitPrice = number(a.planned_unit_cost_no_vat);
    if (baselineQty !== null && baselineAmount !== null && unitPrice !== null && decimal(baselineQty).mul(unitPrice).div(slot?.priceBasis ?? '1').minus(baselineAmount).abs().gt('0.01')) quality.push(issue('BASE_PRICE_MISMATCH','Số lượng phân bổ × đơn giá khác ngân sách nguồn.',a,'BLOCK'));
    if (contract.startDate && start < contract.startDate || contract.endDate && end > contract.endDate) quality.push(issue('ALLOCATION_OUTSIDE_CONTRACT','Kỳ tài chính giao ngoài thời hạn hợp đồng; giữ nguồn, khả dụng lấy giao khoảng thời gian.',a));
    const months = number(a.allocation_month_count);
    if (months && decimal(months).toNumber() !== calendarMonths(start,end)) quality.push(issue('MONTH_COUNT_MISMATCH','Số tháng nguồn khác số tháng lịch giao kỳ.',a));
    if (baselineQty && !decimal(baselineQty).isInteger() || !decimal(deltaQty).isInteger()) quality.push(issue('FRACTIONAL_CONVERTED_QUOTA','Số lượng quy đổi từ ngân sách có phần lẻ; không làm tròn thành quota thực thi.',a));
    if (a.allocation_status === 'approved' && (!a.adjustment_approved_by || !a.adjustment_approved_date)) quality.push(issue('SOURCE_APPROVAL_EVIDENCE_MISSING','Giữ trạng thái approved của nguồn; chưa có người/ngày/chứng cứ duyệt đầy đủ, không tạo quyết định thay thế.',a));
    const beneficiaryLabel = text(a.slot_operator) ?? (isCap ? 'Toàn hợp đồng' : text(h.owner_unit) ?? 'Chưa xác định');
    const beneficiaryUnitCode = units(beneficiaryLabel);
    if (!beneficiaryUnitCode && !(isCap && beneficiaryLabel === 'Toàn hợp đồng')) quality.push(issue('UNKNOWN_BENEFICIARY','Chưa liên kết CQĐV hưởng phân bổ với danh mục.',a,'BLOCK'));
    const id = text(a.allocation_id); if (!id) throw new Error('ALLOCATION_KEY_REQUIRED');
    const line: SupplyAllocationView = { id, contractId: code, planId: 'SOURCE', slotId: slot?.id ?? null, periodId: period.id, sourceKey: id,
      beneficiaryUnitCode, beneficiaryLabel, scopeKind: isCap ? 'CAP' : 'ENTITLEMENT', limitMode: ['HARD_LIMIT','WARNING','REFERENCE'].includes(String(a.limit_mode)) ? a.limit_mode as SupplyAllocationView['limitMode'] : 'HARD_LIMIT',
      baselineQty, baselineAmount, unitPrice, inputBasis: 'SOURCE', percent: null, denominator: null,
      taxRate: parseSourceNumber(a.planned_tax_rate,snapshot.locale,true), vatEstimated: a.vat_estimated === true || a.vat_estimated === 'true' || /dự kiến|estimated/i.test(String(a.note??'')), sourceMonthCount: months ? Number(months) : null,
      status: [...quality,...contract.quality,...(slot?.quality??[])].some(q => q.severity === 'BLOCK') ? 'HELD' : a.allocation_status === 'approved' ? 'APPROVED' : 'DRAFT', sourceVersion: text(a.allocation_version),
      source: { ...source(a), effectiveQty: number(a.effective_qty), effectiveAmount: number(a.effective_amount_no_vat), sourceStatus: a.allocation_status, approvalBy: a.adjustment_approved_by, approvalDate: a.adjustment_approved_date,
        reason: a.adjustment_reason, decisionRef: a.adjustment_decision_ref, deltaQty, deltaAmount, overbookRule: a.overbook_rule }, quality, recordVersion: 1, approvedByActorId: null, approvedAt: null };
    aggregate.allocations.push(line);
    if (!decimal(deltaQty).isZero() || !decimal(deltaAmount).isZero()) {
      const state = line.status === 'APPROVED' ? 'SOURCE_APPLIED' : 'DRAFT';
      let group = groups.get(state);
      if (!group) {
        group = { id: `source-${state}`, contractId: code, kind: 'SOURCE_CUMULATIVE', name: 'Điều chỉnh lũy kế nhập từ nguồn', reason: 'Delta lũy kế tại thời điểm đọc nguồn; lịch sử quyết định trước import chưa đầy đủ.', evidence: null,
          status: state, effectiveDate: null, source: { spreadsheetId: snapshot.spreadsheetId, readAt: snapshot.readAt, historyIncomplete: true, sourceDecision: false }, recordVersion: 1, approvedByActorId: null, approvedAt: null, reversesId: null, lines: [] };
        groups.set(state, group);
      }
      group.lines.push({ allocationId: id, deltaQty, deltaAmount, expectedAllocationVersion: 1 });
    }
  }
  aggregate.adjustments = [...groups.values()];
  if (new Set(aggregate.allocations.map(a => a.id)).size !== aggregate.allocations.length) throw new Error('DUPLICATE_ALLOCATION_KEY');
  const slotAmount = sum(slots.map(s => s.signedAmount));
  if (contract.signedAmount !== null && slotAmount !== null && decimal(slotAmount).minus(contract.signedAmount).abs().gt('0.01')) contract.quality.push(issue('HEADER_SLOT_TOTAL_MISMATCH','Tổng giá trị slot khác giá trị ký header; giữ riêng cả hai số.',h));
  // Prose is evidence, never an authority to round or invent an extra delta.
  const years = [...new Set(allocationRaw.filter(a => a.adjustment_reason && a.adjustment_amount_no_vat).map(a => String(a.period_code).slice(0,4)))];
  for (const year of years) {
    const rows = allocationRaw.filter(a => String(a.period_code).startsWith(year));
    const delta = sum(rows.map(a => number(a.adjustment_amount_no_vat) ?? '0'));
    const mentionsBillion = rows.some(a => String(a.adjustment_reason).includes('1.000.000.000'));
    if (mentionsBillion && delta !== null && !decimal(delta).eq('-1000000000')) contract.quality.push(issue('PROSE_CUT_DIFFERENCE',`Delta chi tiết năm ${year} = ${delta}; khác mô tả cắt 1.000.000.000. Giữ số chi tiết để đối soát.`,h));
  }
  if (String(h.note).includes('2.000.000.160')) contract.quality.push(issue('PROSE_CUT_ROUNDING','Nguồn ghi mức giảm chi tiết lệch 160 VND so với mô tả cắt tròn 2 tỷ; giữ số chi tiết.',h));
  return { aggregate, aliases: [...aliasSet], warnings, blocking, financialLines, financialMaps, snapshot, digest: snapshotDigest(snapshot) };
}
