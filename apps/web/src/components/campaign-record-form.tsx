import type {
  CampaignLevelCatalogItem,
  CampaignObjectiveCatalogItem,
  CampaignSummary,
  ContentPillarCatalogItem,
  MarketRegionCatalogResponse,
  OrganizationUnitCatalogItem,
  PersonnelDirectoryCatalogItem,
  ProvinceCatalogItem,
  SimilarCampaignSummary,
} from '@cpms/domain';
import { canonicalCampaignFieldKey, isProtectedCampaignField } from '@cpms/domain';
import { Button, Card, CpmsIcon, LoadingBlock, StatusBadge } from '@cpms/ui';
import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccessCapabilities } from '../access-context';
import {
  findSimilarCampaigns,
  getCampaignLevels,
  getCampaignObjectives,
  getContentPillars,
  getMarketRegions,
  getOrganizationUnits,
  getPersonnel,
  getProvinces,
} from '../lib/api';
import {
  campaignRecordSnapshot,
  campaignRecordValue,
  canSaveCampaignRecord,
  campaignCommunicationDates,
  shiftCampaignDate,
  type CampaignRecordValue,
  validateCampaignRecord,
} from '../lib/campaign-v2-form';
import { campaignDetailPath, navigate } from '../lib/router';
import { marketScopeMatches, setVisibleMarketScopeSelection, type MarketScopeOption } from '../lib/market-scope';
import { useUnsavedChanges } from '../lib/unsaved-changes';
import { CampaignRichTextEditor } from './campaign-rich-text-editor';
import { CampaignDriveWorkspaceCard } from './campaign-drive-workspace-card';
import { CampaignDetailDock } from './campaign-detail-dock';

export type { CampaignRecordValue } from '../lib/campaign-v2-form';

interface CampaignRecordFormProps {
  campaign?: CampaignSummary;
  initialDraftValue?: CampaignRecordValue;
  onAutoSave?(value: CampaignRecordValue): Promise<void>;
  onExit?(): Promise<void>;
  onDiscardDraft?(): Promise<void>;
  saving: boolean;
  error?: string | null;
  onPersist(value: CampaignRecordValue): Promise<CampaignSummary>;
  onSubmitToComm?(value: CampaignRecordValue): Promise<CampaignSummary>;
  saveLabel?: string;
  successMessage?: string;
  onDuplicate?(value: CampaignRecordValue): Promise<CampaignSummary>;
  onMoveToTrash?(): Promise<void>;
  onDeletePermanently?(): Promise<void>;
  showDriveWorkspace?: boolean;
  showSaveBar?: boolean;
  saveBarAtTop?: boolean;
  onDirtyChange?(dirty: boolean): void;
  notify(message: string): void;
}

export interface CampaignRecordFormHandle {
  submit(): Promise<void>;
  duplicate(): Promise<void>;
  isDirty(): boolean;
  currentValue(): CampaignRecordValue;
}

interface FormCatalogs {
  levels: CampaignLevelCatalogItem[];
  objectives: CampaignObjectiveCatalogItem[];
  markets: MarketRegionCatalogResponse;
  provinces: ProvinceCatalogItem[];
  units: OrganizationUnitCatalogItem[];
  pillars: ContentPillarCatalogItem[];
}

const inputClass = 'mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-vna-blue focus:ring-4 focus:ring-cyan-100';
const textAreaClass = `${inputClass} min-h-28 resize-y leading-6`;
const FormFieldAccess = createContext<(keys: string[]) => boolean>(() => false);

export const CampaignRecordForm = forwardRef<CampaignRecordFormHandle, CampaignRecordFormProps>(function CampaignRecordForm({ campaign, initialDraftValue, onAutoSave, onExit, onDiscardDraft, saving, error, onPersist, onSubmitToComm, saveLabel, successMessage, onDuplicate, onMoveToTrash, onDeletePermanently, showDriveWorkspace = true, showSaveBar = true, saveBarAtTop = false, onDirtyChange, notify }, ref) {
  const capabilities = useAccessCapabilities();
  const canEdit = (keys: string[]) => keys.every((key) => !isProtectedCampaignField(key) && (campaign ? campaign.access?.editableFields.includes(canonicalCampaignFieldKey(key)) === true : capabilities['campaign.create'] === true));
  const canSave = campaign ? !campaign.isDeleted && campaign.access?.canEditAnyField === true : capabilities['campaign.create'] === true;
  const initial = useMemo(() => initialDraftValue ?? campaignRecordValue(campaign), [campaign, initialDraftValue]);
  const [value, setValue] = useState(initial);
  const [baseline, setBaseline] = useState(() => campaignRecordSnapshot(initial));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<FormCatalogs | null>(null);
  const timeScrollHandled = useRef(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [personnelQuery, setPersonnelQuery] = useState(campaign?.requestingEmployeeName ?? '');
  const [personnel, setPersonnel] = useState<PersonnelDirectoryCatalogItem[]>([]);
  const [personnelOpen, setPersonnelOpen] = useState(false);
  const [selectedPersonnelName, setSelectedPersonnelName] = useState(campaign?.requestingEmployeeName ?? '');
  const [requesterMode, setRequesterMode] = useState<'DIRECTORY' | 'EMAIL'>(initial.manualRequesterEmail ? 'EMAIL' : 'DIRECTORY');
  const [similar, setSimilar] = useState<SimilarCampaignSummary[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [unitQuery, setUnitQuery] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [showVietnam, setShowVietnam] = useState(campaign?.markets.some((market) => market.marketCode === 'VN') ?? false);
  const [showInternational, setShowInternational] = useState(initial.draftInternationalSelected || initial.draftRegionCodes.length > 0 || initial.marketCodes.some((code) => code !== 'VN'));
  const [activeRegionCodes, setActiveRegionCodes] = useState<string[]>(initial.draftRegionCodes ?? []);
  const submitting = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = campaignRecordSnapshot(value) !== baseline;
  useUnsavedChanges(dirty && !saving);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!catalogs || timeScrollHandled.current || window.location.hash !== '#campaign-time') return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById('campaign-time');
      if (target) { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); timeScrollHandled.current = true; }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [catalogs]);

  useEffect(() => {
    if (!onAutoSave || !dirty || saving || submitting.current) return;
    const snapshot = campaignRecordSnapshot(value);
    const timer = window.setTimeout(() => {
      setAutoSaveState('saving');
      void onAutoSave(value).then(() => {
        setBaseline(snapshot);
        setAutoSaveState('saved');
      }).catch(() => setAutoSaveState('error'));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [value, baseline, onAutoSave, saving, dirty]);

  useEffect(() => {
    const next = initialDraftValue ?? campaignRecordValue(campaign);
    setValue(next);
    setBaseline(campaignRecordSnapshot(next));
    setPersonnelQuery(campaign?.requestingEmployeeName ?? '');
    setSelectedPersonnelName(campaign?.requestingEmployeeName ?? '');
    setRequesterMode(next.manualRequesterEmail ? 'EMAIL' : 'DIRECTORY');
    setValidationError(null);
    setSaveSuccess(null);
    setShowVietnam(next.marketCodes.includes('VN'));
    setShowInternational(next.draftInternationalSelected || (next.draftRegionCodes?.length ?? 0) > 0 || next.marketCodes.some((code) => code !== 'VN'));
    setActiveRegionCodes(next.draftRegionCodes ?? []);
  }, [campaign, initialDraftValue]);

  useEffect(() => {
    if (!catalogs || !initialDraftValue) return;
    const selected = new Set(initialDraftValue.marketCodes.filter((code) => code !== 'VN'));
    setActiveRegionCodes(initialDraftValue.draftRegionCodes?.length ? initialDraftValue.draftRegionCodes : catalogs.markets.regions.filter((region) => region.markets.some((market) => selected.has(market.code))).map((region) => region.code));
  }, [catalogs, initialDraftValue]);

  useEffect(() => {
    if (!catalogs || !initialDraftValue?.draftInternationalSelected || initialDraftValue.draftInternationalSpecific || initialDraftValue.marketCodes.some((code) => code !== 'VN')) return;
    const internationalCodes = catalogs.markets.regions.filter((region) => region.code !== 'DOM').flatMap((region) => region.markets.map((market) => market.code));
    setValue((current) => ({ ...current, marketMode: 'CUSTOM', marketCodes: [...new Set([...current.marketCodes, ...internationalCodes])], marketsTouched: true }));
  }, [catalogs, initialDraftValue]);

  useEffect(() => {
    let active = true;
    setCatalogError(null);
    void Promise.all([
      getCampaignLevels(),
      getCampaignObjectives(),
      getMarketRegions(),
      getProvinces(),
      getOrganizationUnits(),
      getContentPillars(2026),
    ]).then(([levels, objectives, markets, provinces, units, pillars]) => {
      if (active) setCatalogs({ levels, objectives, markets, provinces, units, pillars });
    }).catch((requestError: unknown) => {
      if (!active) return;
      setCatalogError(requestError instanceof Error ? requestError.message : 'Không thể tải danh mục Campaign V2.');
    });
    return () => { active = false; };
  }, [catalogRevision]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getPersonnel(personnelQuery.trim()).then((rows) => {
        if (active) setPersonnel(rows);
      }).catch(() => {
        if (active) setPersonnel([]);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [personnelQuery]);

  useEffect(() => {
    let active = true;
    const query = value.name.trim();
    if (query.length < 3) {
      setSimilar([]);
      setSimilarLoading(false);
      return () => { active = false; };
    }
    setSimilarLoading(true);
    const timer = window.setTimeout(() => {
      void findSimilarCampaigns(query, campaign?.id).then((rows) => {
        if (active) setSimilar(rows.slice(0, 4));
      }).catch(() => {
        if (active) setSimilar([]);
      }).finally(() => {
        if (active) setSimilarLoading(false);
      });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [campaign?.id, value.name]);

  const change = (updater: (current: CampaignRecordValue) => CampaignRecordValue) => {
    setValue(updater);
    setValidationError(null);
    setSaveSuccess(null);
  };

  const changeValue = <K extends keyof CampaignRecordValue>(key: K, next: CampaignRecordValue[K]) => {
    change((current) => ({ ...current, [key]: next }));
  };

  const persist = async (sendToComm = false) => {
    if (submitting.current || saving || !catalogs || !canSave) return;
    const problem = showVietnamDetails && showVietnam && !value.provinceCodes.length
      ? 'Hãy chọn ít nhất một tỉnh, thành phố hoặc bỏ chọn phạm vi cụ thể.'
      : showInternational && showInternationalDetails && !value.marketCodes.some((code) => code !== 'VN')
      ? 'Hãy chọn ít nhất một thị trường Quốc tế hoặc bỏ chọn phạm vi cụ thể.'
      : validateCampaignRecord(value, Boolean(campaign && !campaign.levelCode), campaign);
    if (problem) {
      setValidationError(problem);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    submitting.current = true;
    setValidationError(null);
    setSaveSuccess(null);
    try {
      const saved = await (sendToComm && onSubmitToComm ? onSubmitToComm : onPersist)(value);
      const next = campaignRecordValue(saved);
      setValue(next);
      setBaseline(campaignRecordSnapshot(next));
      const message = sendToComm ? 'Chiến dịch đã được gửi đến Ban TT' : successMessage ?? (campaign ? 'Đã lưu thay đổi.' : `Đã lưu bản nháp ${saved.code}.`);
      setSaveSuccess(message);
      notify(message);
      if (sendToComm) navigate(campaignDetailPath(saved.id), false, true);
    } catch {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      submitting.current = false;
    }
  };

  const duplicate = async () => {
    if (!onDuplicate || saving || submitting.current || !capabilities['campaign.create']) return;
    const problem = validateCampaignRecord(value, false);
    if (problem) return setValidationError(problem);
    submitting.current = true;
    try {
      const copy = await onDuplicate({ ...value, name: `${value.name.trim()} (Bản sao)`, lifecycleState: 'DRAFT' });
      notify(`Đã tạo bản sao ${copy.code}.`);
      navigate(campaignDetailPath(copy.id), false, true);
    } finally {
      submitting.current = false;
    }
  };

  useImperativeHandle(ref, () => ({ submit: () => persist(), duplicate, isDirty: () => dirty, currentValue: () => valueRef.current }), [dirty, duplicate, persist]);

  if (!catalogs) {
    return (
      <Card className="overflow-hidden">
        {catalogError ? (
          <div className="grid min-h-64 place-items-center p-8 text-center">
            <div><CpmsIcon name="error" className="mx-auto text-rose-600" size={28} /><p className="mt-3 font-semibold text-rose-800">Không tải được danh mục biểu mẫu.</p><p className="mt-2 text-sm text-slate-600">{catalogError}</p><Button className="mt-5 gap-2" variant="secondary" onClick={() => setCatalogRevision((current) => current + 1)}><CpmsIcon name="refresh" />Thử lại</Button></div>
          </div>
        ) : <LoadingBlock label="Đang tải danh mục Campaign V2…" />}
      </Card>
    );
  }

  const parentPillars = catalogs.pillars.filter((pillar) => pillar.level === 1);
  const allInternationalMarketCodes = catalogs.markets.regions.filter((region) => region.code !== 'DOM').flatMap((region) => region.markets.map((market) => market.code));
  const showVietnamDetails = value.draftVietnamSpecific || value.provinceCodes.length > 0;
  const showInternationalDetails = value.draftInternationalSpecific || Boolean(campaign && value.marketCodes.some((code) => code !== 'VN') && !allInternationalMarketCodes.every((code) => value.marketCodes.includes(code)));
  const childPillars = catalogs.pillars.filter((pillar) => pillar.level === 2 && pillar.parentCode === value.contentPillarL1Code);
  const marketByCode = new Map(catalogs.markets.regions.flatMap((region) => region.markets).map((market) => [market.code, market]));
  const selectedMarkets = value.marketCodes.flatMap((code) => marketByCode.get(code) ? [marketByCode.get(code)!] : []);
  const filteredUnits = catalogs.units.filter((unit) => {
    const query = unitQuery.trim().toLocaleLowerCase('vi');
    return !query || `${unit.code} ${unit.displayName} ${unit.sourceName ?? ''}`.toLocaleLowerCase('vi').includes(query);
  });
  const quickUnits = filteredUnits.filter((unit) => unit.category === 'QUICK_SELECT');
  const foreignUnits = filteredUnits.filter((unit) => unit.category === 'FOREIGN_BRANCH');
  const selectedUnitCodes = new Set(value.requestingUnits.flatMap((unit) => unit.unitCode ? [unit.unitCode] : []));

  const setMarketCodes = (codes: string[]) => change((current) => ({ ...current, marketMode: codes.length ? 'CUSTOM' : 'NONE', marketCodes: codes, marketsTouched: true }));
  const setProvinceCodes = (codes: string[]) => change((current) => ({ ...current, provinceCodes: codes, provincesTouched: true }));
  const toggleVietnam = () => {
    setShowVietnam(!showVietnam);
    if (showVietnam) {
      setMarketCodes(value.marketCodes.filter((code) => code !== 'VN'));
      setProvinceCodes([]);
      changeValue('draftVietnamSpecific', false);
    } else setMarketCodes([...new Set([...value.marketCodes, 'VN'])]);
  };
  const toggleInternational = () => {
    setShowInternational(!showInternational);
    changeValue('draftInternationalSelected', !showInternational);
    if (showInternational) {
      setMarketCodes(value.marketCodes.filter((code) => code === 'VN'));
      setActiveRegionCodes([]);
      changeValue('draftRegionCodes', []);
      changeValue('draftInternationalSpecific', false);
    } else {
      setMarketCodes([...new Set([...value.marketCodes.filter((code) => code === 'VN'), ...allInternationalMarketCodes])]);
      changeValue('draftInternationalSpecific', false);
    }
  };
  const toggleInternationalSpecific = () => {
    if (showInternationalDetails) {
      setMarketCodes([...new Set([...value.marketCodes.filter((code) => code === 'VN'), ...allInternationalMarketCodes])]);
      setActiveRegionCodes([]);
      changeValue('draftRegionCodes', []);
      changeValue('draftInternationalSpecific', false);
    } else {
      setMarketCodes(value.marketCodes.filter((code) => code === 'VN'));
      setActiveRegionCodes([]);
      changeValue('draftRegionCodes', []);
      changeValue('draftInternationalSpecific', true);
    }
  };
  const setRegions = (codes: string[]) => {
    const removed = activeRegionCodes.filter((code) => !codes.includes(code));
    const removedMarkets = new Set(catalogs.markets.regions.filter((region) => removed.includes(region.code)).flatMap((region) => region.markets.map((market) => market.code)));
    if (removedMarkets.size) setMarketCodes(value.marketCodes.filter((code) => !removedMarkets.has(code)));
    setActiveRegionCodes(codes);
    changeValue('draftRegionCodes', codes);
  };

  const toggleUnit = (unit: OrganizationUnitCatalogItem) => {
    if (!selectedUnitCodes.has(unit.code) && value.requestingUnits.length >= 20) {
      setValidationError('Đơn vị yêu cầu không được vượt quá 20 lựa chọn.');
      return;
    }
    change((current) => {
      const selected = current.requestingUnits.some((item) => item.unitCode === unit.code);
      return {
        ...current,
        requestingUnits: selected
          ? current.requestingUnits.filter((item) => item.unitCode !== unit.code)
          : [...current.requestingUnits, { unitCode: unit.code, displayName: unit.displayName, category: unit.category }],
        requestingUnitsTouched: true,
      };
    });
  };

  const addCustomUnit = () => {
    const name = customUnit.trim();
    if (!name || value.requestingUnits.length >= 20) return;
    if (value.requestingUnits.some((unit) => unit.customName?.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) return;
    change((current) => ({ ...current, requestingUnits: [...current.requestingUnits, { customName: name, displayName: name, category: 'CUSTOM' }], requestingUnitsTouched: true }));
    setCustomUnit('');
  };

  const legacyValue = (fieldKey: string) => {
    if (fieldKey === 'requesting_unit') return campaign?.requestingUnit || '—';
    if (fieldKey === 'fieldValues') return 'Dữ liệu tương thích đang được giữ nguyên trong bản ghi.';
    const candidate = campaign?.fieldValues[fieldKey];
    return candidate === undefined || candidate === null ? '—' : typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
  };

  const saveBar = showSaveBar ? <Card className="flex flex-wrap items-center justify-between gap-3 border-slate-200 px-5 py-4">
    <div className="flex items-center gap-2 text-sm">
      {saving ? <><span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" /><span className="font-medium text-slate-600">Đang lưu…</span></> : dirty ? <><span className="size-2 rounded-full bg-amber-500" /><span className="font-medium text-amber-800">Có thay đổi chưa lưu</span></> : campaign ? <><CpmsIcon name="success" className="text-emerald-600" /><span className="font-medium text-slate-600">Dữ liệu đã lưu</span></> : <span className="font-medium text-slate-500">Thao tác áp dụng cho toàn bộ Chiến dịch</span>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {onAutoSave ? <span className={`text-xs ${autoSaveState === 'error' ? 'text-rose-700' : 'text-slate-500'}`} role="status">{autoSaveState === 'saving' ? 'Đang lưu bản nhập dở…' : autoSaveState === 'saved' ? 'Đã lưu tự động' : autoSaveState === 'error' ? 'Chưa lưu được bản nhập dở. Hãy thử lại trước khi rời trang.' : 'Bản nhập dở sẽ được lưu tự động'}</span> : null}
      <Button variant="secondary" className="gap-2" disabled={saving} onClick={() => onExit ? void onExit() : navigate('/campaigns')}><CpmsIcon name="back" />{onExit ? 'Về danh sách' : 'Hủy'}</Button>
      {onDiscardDraft ? <Button variant="secondary" disabled={saving} onClick={() => void onDiscardDraft()}>Bỏ bản nhập dở</Button> : null}
      <Button variant={!campaign && onSubmitToComm ? 'secondary' : 'primary'} className="gap-2" disabled={!canSaveCampaignRecord({ existingCampaign: Boolean(campaign), dirty, saving, authorized: canSave, name: value.name, levelCode: value.levelCode })} onClick={() => void persist()}><CpmsIcon name="save" />{saving ? 'Đang lưu…' : saveLabel ?? (campaign ? 'Lưu thay đổi' : 'Lưu nháp')}</Button>
      {onSubmitToComm && (!campaign || campaign.lifecycleState === 'DRAFT') && <Button disabled={saving || !canSave || Boolean(campaign && (dirty || !campaign.access?.permissions['campaign.submit']))} title={campaign && dirty ? 'Hãy lưu thay đổi trước khi gửi Ban TT' : undefined} onClick={() => void persist(true)}><CpmsIcon name="approve" />{campaign ? 'Gửi Ban TT' : 'Tạo và gửi Ban TT'}</Button>}
    </div>
  </Card> : null;

  return (
    <FormFieldAccess.Provider value={canEdit}><div className="space-y-4">
      {saveBarAtTop && saveBar ? <CampaignDetailDock variant="entry">{saveBar}</CampaignDetailDock> : null}
      {(validationError || error) ? <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert"><CpmsIcon name="error" className="mt-0.5 shrink-0" />{validationError ?? error}</div> : null}
      {saveSuccess ? <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800" role="status"><CpmsIcon name="success" />{saveSuccess}</div> : null}

      {campaign?.normalizationStatus === 'NEEDS_NORMALIZATION' ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><CpmsIcon name="warning" className="mt-0.5 shrink-0" /><div><p className="font-semibold">Cần chuẩn hóa</p><p className="mt-1 text-amber-800">Chiến dịch cũ vẫn có thể mở và lưu. Dữ liệu chưa ánh xạ được hiển thị chỉ đọc và không bị xóa.</p></div></div>
      ) : null}

      {!canSave && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Chỉ xem · Tài khoản hiện tại không có quyền sửa thông tin tại đây.</p>}
      <fieldset className="space-y-4" disabled={saving || !canSave}>
        <FormSection title="Thông tin chính" description="Chỉ Tên chiến dịch và Cấp chiến dịch là bắt buộc khi lưu bản nháp." icon="campaign">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <FieldAccessBoundary keys={['name']} className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-4 shadow-sm">
              <label className="block text-base font-bold text-slate-900" htmlFor="campaign-v2-name">Tên chiến dịch *</label>
              <input id="campaign-v2-name" autoFocus={!campaign} className={`${inputClass} mt-2 min-h-14 border-cyan-300 bg-white text-lg font-bold text-slate-950 shadow-sm focus:border-vna-blue focus:ring-4 focus:ring-cyan-100`} maxLength={240} value={value.name} onChange={(event) => changeValue('name', event.target.value)} placeholder="Nhập tên chiến dịch" />
              {similarLoading ? <p className="mt-2 text-xs text-slate-500">Đang kiểm tra tên gần giống…</p> : similar.length > 0 ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><p className="font-semibold">Có chiến dịch tên gần giống — vẫn có thể lưu:</p>{similar.map((item) => <p key={item.id} className="mt-1"><a className="font-mono font-semibold text-vna-blue hover:underline" href={campaignDetailPath(item.id)}>{item.code}</a> · {item.name}</p>)}</div> : null}
            </FieldAccessBoundary>
            <FieldLabel text="Mã chiến dịch"><input className={`${inputClass} bg-slate-50 font-mono`} readOnly value={campaign?.code ?? 'Tự sinh khi lưu'} /></FieldLabel>
          </div>

          <FieldAccessBoundary keys={['levelCode']} className="mt-6">
            <p className="text-sm font-semibold text-slate-800">Cấp chiến dịch *</p>
            {!value.levelCode && campaign ? <p className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-800"><CpmsIcon name="warning" />Chiến dịch cũ chưa có cấp. Có thể lưu nguyên trạng hoặc chọn cấp để chuẩn hóa.</p> : null}
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {catalogs.levels.map((level) => <label key={level.code} className={`cursor-pointer rounded-xl border p-4 transition ${value.levelCode === level.code ? 'border-vna-blue bg-cyan-50 ring-1 ring-vna-blue/20' : 'border-slate-200 hover:border-vna-blue/40'}`}><span className="flex items-center gap-2"><input type="radio" name="campaign-level" checked={value.levelCode === level.code} onChange={() => changeValue('levelCode', level.code)} /><span className="font-semibold text-slate-900">{level.label}</span></span><span className="mt-2 block text-xs leading-5 text-slate-600">{level.ruleDescription}</span></label>)}
            </div>
          </FieldAccessBoundary>
        </FormSection>

        <FormSection id="campaign-time" title="Thời gian" description="Có thể dùng quy tắc mặc định hoặc tự nhập thời gian QCTT." icon="pending">
          <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-200 bg-cyan-50/60 px-4 py-3 text-sm text-slate-700">
            <input className="mt-0.5" type="checkbox" checked={value.communicationDatesAuto} onChange={(event) => change((current) => ({
              ...current,
              communicationDatesAuto: event.target.checked,
              ...(event.target.checked ? campaignCommunicationDates(current.effectiveStartDate, current.effectiveEndDate) : {}),
            }))} />
            <span><span className="block font-semibold text-slate-900">Tự động tính thời gian QCTT</span><span className="mt-1 block leading-5">Bắt đầu QCTT 30 ngày trước ngày chương trình có hiệu lực và kết thúc QCTT vào đúng ngày chương trình hết hiệu lực.</span></span>
          </label>
          <div className="grid gap-5 lg:grid-cols-2">
            <DateRange title="Thời gian hiệu lực" startField="effectiveStartDate" endField="effectiveEndDate" start={value.effectiveStartDate} end={value.effectiveEndDate} onStart={(next) => change((current) => ({ ...current, effectiveStartDate: next, ...(current.communicationDatesAuto ? { startDate: next ? shiftCampaignDate(next, -30) : '' } : {}) }))} onEnd={(next) => change((current) => ({ ...current, effectiveEndDate: next, ...(current.communicationDatesAuto ? { endDate: next } : {}) }))} />
            <DateRange title="Thời gian QCTT" startField="startDate" endField="endDate" start={value.startDate} end={value.endDate} onStart={(next) => change((current) => ({ ...current, startDate: next, communicationDatesAuto: false }))} onEnd={(next) => change((current) => ({ ...current, endDate: next, communicationDatesAuto: false }))} />
          </div>
        </FormSection>

        <FormSection title="Mục tiêu và nội dung" description="Mục tiêu, chỉ tiêu và cấu trúc nội dung của chiến dịch." icon="edit">
          <div className="grid gap-5 lg:grid-cols-2">
            <FieldLabel text="Mục tiêu chính" fieldKeys={["primaryObjectiveCode", "primaryObjectiveOther"]}><select className={inputClass} value={value.primaryObjectiveCode ?? ''} onChange={(event) => change((current) => ({ ...current, primaryObjectiveCode: (event.target.value || null) as CampaignRecordValue['primaryObjectiveCode'], primaryObjectiveOther: event.target.value === 'OTHER' ? current.primaryObjectiveOther : '' }))}><option value="">Chưa chọn</option>{catalogs.objectives.map((objective) => <option key={objective.code} value={objective.code}>{objective.label}</option>)}</select></FieldLabel>
            {value.primaryObjectiveCode === 'OTHER' ? <FieldLabel text="Nội dung mục tiêu khác *" fieldKeys={["primaryObjectiveOther"]}><input className={inputClass} maxLength={1000} value={value.primaryObjectiveOther} onChange={(event) => changeValue('primaryObjectiveOther', event.target.value)} /></FieldLabel> : <FieldLabel text="Chỉ tiêu" fieldKeys={["kpiText"]}><textarea className={textAreaClass} maxLength={4000} value={value.kpiText} onChange={(event) => changeValue('kpiText', event.target.value)} placeholder="Nhập chỉ tiêu dạng văn bản" /></FieldLabel>}
            {value.primaryObjectiveCode === 'OTHER' ? <FieldLabel text="Chỉ tiêu" fieldKeys={["kpiText"]} className="lg:col-span-2"><textarea className={textAreaClass} maxLength={4000} value={value.kpiText} onChange={(event) => changeValue('kpiText', event.target.value)} placeholder="Nhập chỉ tiêu dạng văn bản" /></FieldLabel> : null}
            <FieldLabel text="Trụ cột nội dung" fieldKeys={["content_pillar_l1_code", "content_pillar_l1_label", "content_pillar_l2_code", "content_pillar_l2_label"]}><select className={inputClass} value={value.contentPillarL1Code} onChange={(event) => { const selected = parentPillars.find((pillar) => pillar.code === event.target.value); change((current) => ({ ...current, contentPillarL1Code: selected?.code ?? '', contentPillarL1Label: selected?.label ?? '', contentPillarL2Code: '', contentPillarL2Label: '' })); }}><option value="">Chưa chọn</option>{value.contentPillarL1Code && !parentPillars.some((pillar) => pillar.code === value.contentPillarL1Code) ? <option value={value.contentPillarL1Code}>{value.contentPillarL1Label || value.contentPillarL1Code} (legacy)</option> : null}{parentPillars.map((pillar) => <option key={pillar.code} value={pillar.code}>{pillar.label}</option>)}</select></FieldLabel>
            <FieldLabel text="Chủ đề nội dung" fieldKeys={["content_pillar_l2_code", "content_pillar_l2_label"]}><select className={inputClass} value={value.contentPillarL2Code} disabled={!value.contentPillarL1Code} onChange={(event) => { const selected = childPillars.find((pillar) => pillar.code === event.target.value); change((current) => ({ ...current, contentPillarL2Code: selected?.code ?? '', contentPillarL2Label: selected?.label ?? '' })); }}><option value="">Chưa chọn</option>{value.contentPillarL2Code && !childPillars.some((pillar) => pillar.code === value.contentPillarL2Code) ? <option value={value.contentPillarL2Code}>{value.contentPillarL2Label || value.contentPillarL2Code} (legacy)</option> : null}{childPillars.map((pillar) => <option key={pillar.code} value={pillar.code}>{pillar.label}</option>)}</select></FieldLabel>
          </div>
          <FieldAccessBoundary keys={['descriptionRichText']} className="mt-6"><p className="text-sm font-semibold text-slate-800">Mô tả chiến dịch</p><CampaignRichTextEditor value={value.descriptionRichText} disabled={saving || !canSave || !canEdit(['descriptionRichText'])} onChange={(next) => changeValue('descriptionRichText', next)} onValidationError={setValidationError} /></FieldAccessBoundary>
        </FormSection>

        <FormSection title="Phạm vi thị trường" description="Tùy chọn · Có thể chọn đồng thời Việt Nam và Quốc tế. Các lựa chọn được lưu có cấu trúc." icon="filter">
          <FieldAccessBoundary keys={['market']}>
          {value.marketMode === 'LEGACY' ? <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Thị trường legacy chưa ánh xạ được vẫn được giữ nguyên khi lưu. Chọn lại bên dưới nếu muốn thay thế bằng danh mục hiện hành.</p> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" checked={showVietnam} onChange={toggleVietnam} />Việt Nam</label>
              {showVietnam ? <div className="mt-4"><label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showVietnamDetails} onChange={(event) => { changeValue('draftVietnamSpecific', event.target.checked); if (!event.target.checked) setProvinceCodes([]); }} />Chọn tỉnh, thành phố cụ thể?</label>{showVietnamDetails ? <div className="mt-3"><MultiChoiceSelector title="Tỉnh, thành phố" searchLabel="Tìm tỉnh, thành phố" options={catalogs.provinces.map((province) => ({ code: province.code, label: province.name }))} selected={value.provinceCodes} onChange={setProvinceCodes} /></div> : <p className="mt-2 text-xs text-slate-500">Mặc định áp dụng toàn Việt Nam.</p>}</div> : null}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" checked={showInternational} onChange={toggleInternational} />Quốc tế</label>
              {showInternational ? <div className="mt-4 space-y-4"><label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showInternationalDetails} onChange={toggleInternationalSpecific} />Chọn khu vực, thị trường cụ thể?</label>{showInternationalDetails ? <>
                <MultiChoiceSelector title="Khu vực" searchLabel="Tìm khu vực" options={catalogs.markets.regions.filter((region) => region.code !== 'DOM').map((region) => ({ code: region.code, label: region.name }))} selected={activeRegionCodes} onChange={setRegions} />
                <MultiChoiceSelector title="Thị trường" searchLabel="Tìm thị trường" options={catalogs.markets.regions.filter((region) => activeRegionCodes.includes(region.code)).flatMap((region) => region.markets.map((market) => ({ code: market.code, label: `${market.name} · ${region.name}` })))} selected={value.marketCodes.filter((code) => code !== 'VN')} onChange={(codes) => setMarketCodes([...value.marketCodes.filter((code) => code === 'VN'), ...codes])} emptyLabel="Chọn khu vực trước để xem thị trường." />
              </> : <p className="text-xs text-slate-500">Mặc định áp dụng toàn bộ thị trường quốc tế trong danh mục.</p>}</div> : null}
            </div>
          </div>
          {(selectedMarkets.length > 0 || value.provinceCodes.length > 0) ? <div className="mt-4"><p className="mb-2 text-xs font-semibold text-slate-500">Phạm vi đã chọn</p><div className="flex flex-wrap gap-2">{showVietnam ? <Chip label="Việt Nam" onRemove={toggleVietnam} /> : null}{showInternational && !showInternationalDetails ? <Chip label="Quốc tế · toàn bộ thị trường" onRemove={toggleInternational} /> : selectedMarkets.filter((market) => market.code !== 'VN').map((market) => <Chip key={market.code} label={`${market.code} · ${market.name}`} onRemove={() => setMarketCodes(value.marketCodes.filter((code) => code !== market.code))} />)}{value.provinceCodes.map((code) => { const province = catalogs.provinces.find((item) => item.code === code); return province ? <Chip key={code} label={province.name} onRemove={() => setProvinceCodes(value.provinceCodes.filter((item) => item !== code))} /> : null; })}</div></div> : null}
        </FieldAccessBoundary>
        </FormSection>

        <FormSection title="Đơn vị và người yêu cầu" description="Đơn vị được lưu dạng nhiều lựa chọn; người yêu cầu dùng danh bạ demo hoặc email thủ công." icon="users">
          <div className="grid gap-6 xl:grid-cols-2">
            <FieldAccessBoundary keys={["requestingUnits", "requestingUnit"]}>
              <p className="text-sm font-semibold text-slate-800">Đơn vị yêu cầu</p>
              {value.requestingUnits.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{value.requestingUnits.map((unit) => <Chip key={unit.unitCode ?? `custom-${unit.customName}`} label={unit.displayName} onRemove={() => change((current) => ({ ...current, requestingUnits: current.requestingUnits.filter((item) => item !== unit), requestingUnitsTouched: true }))} />)}</div> : <p className="mt-2 text-xs text-slate-500">Chưa chọn đơn vị.</p>}
              <div className="relative mt-3"><CpmsIcon name="search" className="pointer-events-none absolute left-3 top-5 text-slate-400" /><input className={`${inputClass} pl-10`} value={unitQuery} onChange={(event) => setUnitQuery(event.target.value)} placeholder="Tìm đơn vị hoặc CNNN" /></div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                <UnitGroup title="Lựa chọn nhanh" units={quickUnits} selected={selectedUnitCodes} onToggle={toggleUnit} />
                <UnitGroup title="Chi nhánh nước ngoài" units={foreignUnits} selected={selectedUnitCodes} onToggle={toggleUnit} />
                {!filteredUnits.length ? <p className="px-3 py-4 text-center text-sm text-slate-500">Không có đơn vị phù hợp.</p> : null}
              </div>
              <div className="mt-3 flex gap-2"><input className={`${inputClass} mt-0`} maxLength={240} value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomUnit(); } }} placeholder="Nhập đơn vị khác" /><Button className="shrink-0 gap-2" variant="secondary" disabled={!customUnit.trim() || value.requestingUnits.length >= 20} onClick={addCustomUnit}><CpmsIcon name="add" />Thêm</Button></div>
            </FieldAccessBoundary>

            <FieldAccessBoundary keys={["requestingEmployeeCode", "manualRequesterEmail"]}>
              <p className="text-sm font-semibold text-slate-800">Người yêu cầu</p>
              <div className="mt-3 flex gap-2">{(['DIRECTORY', 'EMAIL'] as const).map((mode) => <label key={mode} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold ${requesterMode === mode ? 'border-vna-blue bg-cyan-50 text-vna-blue' : 'border-slate-200 text-slate-600'}`}><input className="sr-only" type="radio" checked={requesterMode === mode} onChange={() => { setRequesterMode(mode); if (mode === 'EMAIL') { change((current) => ({ ...current, requestingEmployeeCode: '' })); setSelectedPersonnelName(''); setPersonnelQuery(''); } else change((current) => ({ ...current, manualRequesterEmail: '' })); }} />{mode === 'DIRECTORY' ? 'Chọn từ danh bạ' : 'Nhập email thủ công'}</label>)}</div>
              {requesterMode === 'EMAIL' ? <FieldLabel text="Email người yêu cầu" className="mt-3"><input type="email" className={inputClass} maxLength={320} value={value.manualRequesterEmail} onChange={(event) => changeValue('manualRequesterEmail', event.target.value)} placeholder="name@example.com" /></FieldLabel> : <div className="relative mt-3"><FieldLabel text="Tìm nhân sự"><div className="relative"><CpmsIcon name="search" className="pointer-events-none absolute left-3 top-5 text-slate-400" /><input className={`${inputClass} pl-10`} value={personnelQuery} onFocus={() => setPersonnelOpen(true)} onChange={(event) => { setPersonnelQuery(event.target.value); setPersonnelOpen(true); if (value.requestingEmployeeCode) changeValue('requestingEmployeeCode', ''); }} placeholder="Tìm theo tên, mã, email, đơn vị" /></div></FieldLabel>{personnelOpen ? <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{personnel.length ? personnel.map((person) => <button key={person.employeeCode} type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-cyan-50" onClick={() => { change((current) => ({ ...current, requestingEmployeeCode: person.employeeCode, manualRequesterEmail: '' })); setSelectedPersonnelName(person.fullName); setPersonnelQuery(person.fullName); setPersonnelOpen(false); }}><span className="block text-sm font-semibold text-slate-800">{person.fullName} · {person.employeeCode}</span><span className="mt-0.5 block text-xs text-slate-500">{person.organizationName}{person.departmentName ? ` · ${person.departmentName}` : ''}{person.email ? ` · ${person.email}` : ''}</span></button>) : <p className="px-3 py-4 text-center text-sm text-slate-500">Không tìm thấy nhân sự.</p>}</div> : null}</div>}
              {value.requestingEmployeeCode ? <div className="mt-3 flex flex-wrap gap-2"><Chip label={`${selectedPersonnelName || value.requestingEmployeeCode} · ${value.requestingEmployeeCode}`} onRemove={() => { changeValue('requestingEmployeeCode', ''); setSelectedPersonnelName(''); setPersonnelQuery(''); }} /></div> : null}
            </FieldAccessBoundary>
          </div>
        </FormSection>

        <FieldAccessBoundary keys={['additionalInformation']}><Card className="overflow-hidden">
          <details open={value.additionalInformation.length > 0}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 lg:px-6"><span><span className="block font-semibold text-slate-900">Thông tin bổ sung</span><span className="mt-1 block text-xs text-slate-500">Tùy chọn · tối đa 10 dòng</span></span><StatusBadge>{value.additionalInformation.length}/10</StatusBadge></summary>
            <div className="border-t border-slate-100 px-5 py-5 lg:px-6">
              <div className="space-y-3">{value.additionalInformation.map((item, index) => <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-[220px_minmax(0,1fr)_40px]"><input aria-label={`Tên trường ${index + 1}`} className={`${inputClass} mt-0`} maxLength={160} value={item.label} onChange={(event) => change((current) => ({ ...current, additionalInformation: current.additionalInformation.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) }))} placeholder="Tên thông tin" /><textarea aria-label={`Giá trị ${index + 1}`} className={`${textAreaClass} mt-0 min-h-20`} maxLength={4000} value={item.value} onChange={(event) => change((current) => ({ ...current, additionalInformation: current.additionalInformation.map((candidate) => candidate.id === item.id ? { ...candidate, value: event.target.value } : candidate) }))} placeholder="Nội dung" /><button type="button" className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={`Xóa dòng ${index + 1}`} title="Xóa dòng" onClick={() => change((current) => ({ ...current, additionalInformation: current.additionalInformation.filter((candidate) => candidate.id !== item.id) }))}><CpmsIcon name="delete" /></button></div>)}</div>
              <Button className="mt-4 gap-2" variant="secondary" disabled={value.additionalInformation.length >= 10} onClick={() => change((current) => ({ ...current, additionalInformation: [...current.additionalInformation, { id: crypto.randomUUID(), label: '', value: '', order: current.additionalInformation.length }] }))}><CpmsIcon name="add" />Thêm dòng</Button>
            </div>
          </details>
        </Card></FieldAccessBoundary>

        {campaign?.normalizationWarnings.length ? <Card className="overflow-hidden"><details><summary className="flex cursor-pointer items-center gap-3 px-5 py-4 text-sm font-semibold text-amber-900"><CpmsIcon name="warning" />Dữ liệu legacy chưa ánh xạ · chỉ đọc</summary><div className="border-t border-amber-100 bg-amber-50/60 px-5 py-4"><p className="mb-3 text-xs leading-5 text-amber-800">Các giá trị dưới đây được giữ nguyên trong fieldValues và không bị mất khi lưu form V2.</p><dl className="space-y-3">{campaign.normalizationWarnings.map((warning) => <div key={`${warning.code}-${warning.fieldKey}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2"><dt className="text-xs font-semibold text-amber-900">{warning.message}</dt><dd className="mt-1 break-words text-sm text-slate-700">{legacyValue(warning.fieldKey)}</dd></div>)}</dl></div></details></Card> : null}
      </fieldset>

      {!saveBarAtTop ? saveBar : null}

      {showDriveWorkspace && (!campaign || campaign.access?.permissions['campaign.drive.read']) && <CampaignDriveWorkspaceCard campaign={campaign} notify={notify} />}

      {campaign && (onDuplicate || onMoveToTrash || onDeletePermanently) ? <Card className="px-5 py-4"><details><summary className="cursor-pointer text-sm font-semibold text-slate-700">Thao tác khác</summary><div className="mt-4 flex flex-wrap gap-2">{onDuplicate ? <Button variant="secondary" className="gap-2" onClick={() => void duplicate()}><CpmsIcon name="duplicate" />Nhân bản</Button> : null}{onMoveToTrash ? <Button variant="secondary" className="gap-2 text-rose-700" onClick={() => void onMoveToTrash()}><CpmsIcon name="delete" />Chuyển vào Thùng rác</Button> : null}{onDeletePermanently ? <Button variant="ghost" className="gap-2 text-rose-700" onClick={() => void onDeletePermanently()}><CpmsIcon name="delete" />Xóa vĩnh viễn</Button> : null}</div></details></Card> : null}
    </div></FormFieldAccess.Provider>
  );
});

function FormSection({ id, title, description, icon, children }: { id?: string; title: string; description: string; icon: Parameters<typeof CpmsIcon>[0]['name']; children: ReactNode }) {
  return <Card id={id} className="overflow-hidden"><div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name={icon} /></span><div><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div><div className="px-5 py-5 lg:px-6 lg:py-6">{children}</div></Card>;
}

function FieldAccessBoundary({ keys, children, className = '' }: { keys: string[]; children: ReactNode; className?: string }) {
  const canEdit = useContext(FormFieldAccess); const allowed = canEdit(keys);
  return <fieldset className={`min-w-0 ${className}`} disabled={!allowed}>{children}{!allowed && <p className="mt-1 flex items-center gap-1 text-xs font-normal text-slate-500"><CpmsIcon name="locked" size={14} />Chỉ xem · Không có quyền sửa trường này</p>}</fieldset>;
}
function FieldLabel({ text, children, className = '', fieldKeys }: { text: string; children: ReactNode; className?: string; fieldKeys?: string[] }) {
  const content = <label className="block text-sm font-semibold text-slate-700">{text}{children}</label>;
  return fieldKeys ? <FieldAccessBoundary keys={fieldKeys} className={className}>{content}</FieldAccessBoundary> : <div className={className}>{content}</div>;
}
function DateRange({ title, startField, endField, start, end, startMin, onStart, onEnd }: { title: string; startField: string; endField: string; start: string; end: string; startMin?: string; onStart(value: string): void; onEnd(value: string): void }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><p className="text-sm font-semibold text-slate-800">{title}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><FieldLabel text="Từ ngày" fieldKeys={[startField]}><input type="date" min={startMin} className={inputClass} value={start} onChange={(event) => onStart(event.target.value)} /></FieldLabel><FieldLabel text="Đến ngày" fieldKeys={[endField]}><input type="date" min={start || startMin} className={inputClass} value={end} onChange={(event) => onEnd(event.target.value)} /></FieldLabel></div></div>;
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-vna-blue ring-1 ring-inset ring-cyan-200">{label}{onRemove ? <button type="button" className="rounded-full p-0.5 hover:bg-cyan-100" aria-label={`Bỏ ${label}`} title="Bỏ lựa chọn" onClick={onRemove}><CpmsIcon name="delete" size={13} /></button> : null}</span>;
}

function MultiChoiceSelector({ title, searchLabel, options, selected, onChange, emptyLabel = 'Không có lựa chọn phù hợp.' }: {
  title: string; searchLabel: string; options: MarketScopeOption[]; selected: string[]; onChange(codes: string[]): void; emptyLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const visible = options.filter((option) => marketScopeMatches(option, query));
  const visibleCodes = visible.map((option) => option.code);
  return <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{title} <span className="font-normal text-slate-500">({selected.length})</span></p><div className="flex gap-3 text-xs font-semibold"><button type="button" className="text-vna-blue disabled:text-slate-400" disabled={!visible.length} onClick={() => onChange(setVisibleMarketScopeSelection(selected, visibleCodes, true))}>Chọn tất cả</button><button type="button" className="text-vna-blue disabled:text-slate-400" disabled={!visible.length} onClick={() => onChange(setVisibleMarketScopeSelection(selected, visibleCodes, false))}>Bỏ chọn tất cả</button></div></div>
    <div className="relative mt-2"><CpmsIcon name="search" size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><input type="search" aria-label={searchLabel} className={`${inputClass} mt-0 pl-9`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} /></div>
    <div className="mt-2 max-h-48 overflow-y-auto">{visible.length ? visible.map((option) => <label key={option.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-cyan-50"><input type="checkbox" checked={selected.includes(option.code)} onChange={() => onChange(setVisibleMarketScopeSelection(selected, [option.code], !selected.includes(option.code)))} /><span>{option.label}</span></label>) : <p className="px-2 py-3 text-xs text-slate-500">{emptyLabel}</p>}</div>
  </div>;
}

function UnitGroup({ title, units, selected, onToggle }: { title: string; units: OrganizationUnitCatalogItem[]; selected: Set<string>; onToggle(unit: OrganizationUnitCatalogItem): void }) {
  if (!units.length) return null;
  return <div className="mb-2 last:mb-0"><p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</p>{units.map((unit) => <label key={unit.code} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-cyan-50"><input className="mt-0.5" type="checkbox" checked={selected.has(unit.code)} onChange={() => onToggle(unit)} /><span><span className="block font-medium text-slate-800">{unit.displayName}</span><span className="block text-xs text-slate-500">{unit.code}</span></span></label>)}</div>;
}
