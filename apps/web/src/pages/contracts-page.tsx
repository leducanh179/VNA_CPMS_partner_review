import type { SupplyContractWorkspace, SupplyInformationPhase, SupplySlotView } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SupplyGrid, formatSupply, type SupplyGridColumn } from '../components/supply-grid';
import { requestJson } from '../lib/api';
import { AppLink } from '../lib/router';
import { useAuth } from '../auth-context';
import { BookingContractPanel } from '../components/booking-contract-panel';
import { ContractAllocationPanel } from '../components/contract-allocation-panel';
import { ContractInfoPanel } from '../components/contract-management';
import { ContractItemsPanel } from '../components/contract-items-panel';
import { ContractSlotAnalytics } from '../components/contract-slot-analytics';
import { isOwnedChannel, formatSupplyDate, formatSupplyPeriod, isContractLifetimePeriod } from '@cpms/domain';

const statusLabel = (status: unknown) => ({ DRAFT: 'Bản nháp', ACTIVE: 'Đang hoạt động', PAUSED: 'Tạm dừng', ARCHIVED: 'Lưu trữ', PENDING: 'Chờ duyệt', APPROVED: 'Đã áp dụng', HELD: 'Chờ đối soát', REJECTED: 'Từ chối' }[String(status)] ?? String(status));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không thể tải dữ liệu. Vui lòng thử lại.';
const day = (value: unknown) => formatSupplyDate(value ? String(value) : null);
function Alert({ children }: { children: ReactNode }) { return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{children}</div>; }
function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export { ContractListPage as ContractsPage } from '../components/contract-list-page';

const tabs = ['Tình trạng slot', 'Đặt chỗ', 'Thông tin hợp đồng'] as const;
function SlotDescription({ slot }: { slot: SupplySlotView | undefined }) {
  if (!slot) return null;
  const preview = safeLink(slot.previewUrl);
  return <details className="mt-2 text-slate-500"><summary className="cursor-pointer text-xs text-vna-blue">Chi tiết slot</summary><div className="mt-2 space-y-2 whitespace-pre-wrap">
    <p>{slot.description || 'Chưa có mô tả bổ sung.'}</p><p>Tư liệu yêu cầu: {slot.materialRequirement || 'Chưa có thông tin.'}</p>
    <p>Kênh: {[slot.channel, slot.specificChannel].filter(Boolean).join(' · ') || 'Chưa chuẩn hóa'}</p>
    <p>Booker: {slot.bookers.map(person => person.email).join(', ') || 'Chưa có thông tin'}</p>
    {preview && <a className="text-vna-blue underline" href={preview} target="_blank" rel="noreferrer">Xem minh họa vị trí</a>}
  </div></details>;
}

export function ContractDetailPage({ id }: { id: string }) {
  const { me } = useAuth();
  const [data, setData] = useState<SupplyContractWorkspace | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<typeof tabs[number]>(new URLSearchParams(location.search).has('info') || new URLSearchParams(location.search).has('revision') ? tabs[2] : tabs[0]);
  const [period, setPeriod] = useState('CURRENT'), [phase, setPhase] = useState<SupplyInformationPhase>('EFFECTIVE');
  const [assignmentDirty, setAssignmentDirty] = useState(false), [itemDirty,setItemDirty]=useState(false);
  const [headerDirty, setHeaderDirty] = useState(false), [historical, setHistorical] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true);
    try {
      const result = await requestJson<SupplyContractWorkspace>(`/contracts/${id}/workspace?${new URLSearchParams({ period, phase })}`);
      if (request === generation.current) { setData(result); setError(''); }
    } catch (caught) { if (request === generation.current) setError(errorText(caught)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [id, period, phase]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { if (headerDirty || assignmentDirty || itemDirty) return; const poll = () => void load(); const timer = window.setInterval(poll, data?.pollIntervalMs ?? 30000); window.addEventListener('focus', poll); return () => { clearInterval(timer); window.removeEventListener('focus', poll); }; }, [load, data?.pollIntervalMs, headerDirty, assignmentDirty, itemDirty]);
  if (!data) return error ? <Alert>{error}<Button className="ml-3" size="sm" variant="secondary" onClick={() => void load()}>Thử lại</Button></Alert> : <LoadingBlock label="Đang tải hợp đồng…"/>;
  const contract = data.contract;
  const currentPeriods = data.periods.filter(p => data.currentPeriodIds.includes(p.id));
  const currentLabel = currentPeriods.length ? currentPeriods.map(p => p.name).join(' · ') : 'Không có kỳ phân bổ hiện hành';
  const informationColumns: SupplyGridColumn[] = [
    { key: 'name', label: 'Hàng hóa, dịch vụ', width: 340, render: row => <><strong className="font-medium">{String(row.name)}</strong>{row.freeOfCharge === true && <p className="mt-1 text-xs text-vna-blue">Tặng miễn phí</p>}<p className="mt-1 text-[11px] text-slate-500">{(row.periodNames as string[]).join(' · ')} · {(row.beneficiaries as string[]).join(', ')}</p><SlotDescription slot={data.slots.find(slot => slot.id === row.slotId)}/></> },
    { key: 'unit', label: 'Đơn vị', width: 125 }, { key: 'qty', label: 'Số lượng', type: 'number', width: 145 },
    { key: 'unitPrice', label: 'Đơn giá trước VAT', type: 'number', width: 170, render: row => <>{formatSupply(row.unitPrice)}{row.priceBasis !== null && row.priceBasis !== '1' && <p className="mt-1 text-[11px] text-slate-500">/ {formatSupply(row.priceBasis)} {String(row.unit ?? 'đơn vị')}</p>}</> },
    { key: 'amount', label: 'Thành tiền trước VAT', type: 'number', width: 180, hint: 'Thành tiền của phân bổ ở giai đoạn đang chọn; giữ số nguồn và các điều chỉnh đã áp dụng.' },
    { key: 'vat', label: 'Tiền VAT', type: 'number', width: 160 }, { key: 'gross', label: 'Thành tiền sau VAT', type: 'number', width: 180 },
    { key: 'status', label: 'Trạng thái phân bổ', width: 155, render: row => <StatusBadge>{statusLabel(row.status)}</StatusBadge> },
  ];
  return <div className="space-y-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><AppLink className="inline-flex items-center gap-1 text-xs font-semibold text-vna-blue" to={isOwnedChannel(contract)?'/contracts?type=owned':'/contracts'}><CpmsIcon name="back" size={18}/>Kênh &amp; Hợp đồng</AppLink><p className="mt-3 break-words text-xs text-slate-500">{contract.code} · {contract.number}</p><h1 className="mt-1 text-xl font-semibold text-slate-950">{contract.name}</h1><p className="mt-2 text-sm text-slate-600">{contract.vendor} · {day(contract.startDate)} — {day(contract.endDate)}</p></div><Button variant="ghost" aria-label="Tải lại hợp đồng" title="Tải lại hợp đồng" onClick={() => void load()}><CpmsIcon name="refresh" size={18}/></Button></div>
    {error && <Alert>{error} Dữ liệu bên dưới là lần tải thành công gần nhất.</Alert>}
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-xs text-cyan-950">{data.notice !== 'Sử dụng theo consumption provider; các trạng thái có thể chồng lấn.' && <span>{data.notice}</span>}<span className="ml-auto">{loading ? 'Đang cập nhật…' : `Dữ liệu lúc ${new Date(data.asOf).toLocaleString('vi-VN')} · Cập nhật mỗi ${data.pollIntervalMs / 1000} giây`}</span></div>
    <div role="tablist" aria-label="Nội dung hợp đồng" className="flex gap-1 overflow-auto border-b border-slate-200">{tabs.map((name, index) => <button key={name} id={`contract-tab-${index}`} role="tab" disabled={(assignmentDirty || headerDirty || itemDirty) && tab !== name} title={assignmentDirty && tab !== name ? 'Lưu hoặc Hủy phân công trước khi đổi tab' : undefined} aria-selected={tab === name} aria-controls={`contract-panel-${index}`} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${tab === name ? 'border-vna-blue text-vna-blue' : 'border-transparent text-slate-500 hover:text-slate-900'}`} onClick={() => setTab(name)}>{index===2&&isOwnedChannel(contract)?'Thông tin kênh':name}</button>)}</div>
    {tab === tabs[0] ? <section role="tabpanel" id="contract-panel-0" aria-labelledby="contract-tab-0" className="space-y-3">
      <ContractSlotAnalytics key={id} workspace={data} actorId={me.account.id}/>
    </section> : tab === tabs[1] ? <section role="tabpanel" id="contract-panel-1" aria-labelledby="contract-tab-1">
      <BookingContractPanel contractId={id}/>
    </section> : <section role="tabpanel" id="contract-panel-2" aria-labelledby="contract-tab-2" className="space-y-4">
      <ContractInfoPanel id={id} onChanged={()=>void load()} onDirty={setHeaderDirty} onHistorical={setHistorical}/>
      {!historical&&<>
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <label className="min-w-0 max-w-full text-sm">Kỳ phân bổ<select disabled={assignmentDirty||itemDirty} aria-label="Kỳ phân bổ" className="mt-1 block w-full max-w-full rounded-lg border bg-white px-3 py-2" value={period} onChange={event => setPeriod(event.target.value)}><option value="CURRENT">Kỳ hiện hành</option><option value="ALL">Toàn bộ hợp đồng</option>{data.periods.filter(p => !isContractLifetimePeriod(p)).map(p => <option key={p.id} value={p.id}>{formatSupplyPeriod(p)}</option>)}</select></label>
        <label className="text-sm">Giai đoạn<select disabled={assignmentDirty||itemDirty} aria-label="Giai đoạn" className="mt-1 block rounded-lg border bg-white px-3 py-2" value={phase} onChange={event => setPhase(event.target.value as SupplyInformationPhase)}><option value="BASELINE">Ban đầu</option><option value="EFFECTIVE">Sau điều chỉnh</option></select></label>
        <p className="max-w-xl text-xs text-slate-500">Giá trị ký hợp đồng được giữ riêng. Danh mục bên dưới theo kỳ và giai đoạn đã chọn; các dòng nháp được ghi rõ và chưa cấp quyền sử dụng.</p>
      </Card>
      {data.period !== period || data.phase !== phase ? <LoadingBlock label="Đang tải danh mục theo lựa chọn…"/> : <>
        <ContractItemsPanel key={`${id}:${period}:${phase}`} id={id} periodId={period} phase={phase} onDirty={setItemDirty} onSaved={()=>void load()}/>
        <p className="text-sm font-semibold">Danh mục hàng hóa, dịch vụ · {data.phase === 'BASELINE' ? 'Ban đầu' : 'Sau điều chỉnh'} · {data.period === 'ALL' ? 'Toàn bộ hợp đồng' : data.period === 'CURRENT' ? currentLabel : data.periods.find(p => p.id === data.period)?.name}</p>
        {data.informationGroups.map(group => <Card key={group.id} className="overflow-hidden">
          <div className="border-b bg-slate-50 px-4 py-3"><h2 className="text-sm font-semibold">{group.taxRate === null ? 'Chưa xác định VAT' : `VAT ${group.estimated ? 'dự kiến ' : ''}${formatSupply(group.taxPercent)}%`}</h2><p className="mt-1 text-xs text-slate-500">{group.periods.map(p => formatSupplyPeriod(p)).join(' · ')}</p>{group.estimated && <p className="mt-1 text-xs text-amber-800">Mức thuế dự kiến theo nguồn hợp đồng.</p>}</div>
          <SupplyGrid canEdit={false} rows={group.rows.map(row => ({ ...row }))} columns={informationColumns} storageKey={`cpms:supply:contract-info-v2:${me.account.id}`}/>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 border-t px-4 py-3 text-xs"><span>Trước VAT: <strong>{formatSupply(group.amount)} {contract.currency}</strong></span><span>VAT: <strong>{formatSupply(group.vat)} {contract.currency}</strong></span><span>Sau VAT: <strong>{formatSupply(group.gross)} {contract.currency}</strong></span></div>
        </Card>)}
        <ContractAllocationPanel readOnly contractId={id} rows={data.allocationRows} periods={data.periods} phase={data.phase} onDirty={setAssignmentDirty}/>
        {!data.informationGroups.length && <Card className="p-8 text-center text-sm text-slate-500">Không có hàng hóa, dịch vụ trong kỳ đã chọn.</Card>}
      </>}
      {contract.quality.length > 0 && <Card className="p-4"><details><summary className="cursor-pointer text-sm font-medium">Ghi chú đối soát nguồn</summary><div className="mt-3 space-y-2 text-xs text-amber-800">{contract.quality.map((item, index) => <p key={index}>{item.message}</p>)}</div></details></Card>}
      </>}
    </section>}
  </div>;
}
