import {
  MATERIAL_GROUPS,
  MATERIAL_LANGUAGES,
  MATERIAL_PUBLICATION_LABELS,
  MATERIAL_TYPES_BY_GROUP,
  parseMaterialLanguages,
  type CampaignRichTextDocument,
  type MarketRegionCatalogResponse,
  type MaterialCampaignReference,
  type MaterialFieldKey,
  type MaterialFields,
  type MaterialGroup,
  type MaterialPortalBootstrap,
  type MaterialSummary,
  type MaterialSupplementaryLink,
} from '@cpms/domain';
import { Card, CpmsIcon } from '@cpms/ui';
import { useAccessCapabilities } from '../access-context';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CampaignRichTextEditor } from '../components/campaign-rich-text-editor';
import { CampaignDetailDock } from '../components/campaign-detail-dock';
import { batchSaveMaterials, bulkMaterialAction, getMarketRegions, getMaterialBootstrap, getMaterials, requestJson } from '../lib/api';
import { materialDescription, materialFormGroup, materialFormLinks, materialFormReferences, materialRichText, inheritedMaterialMarkets, materialTitleSuggestion } from '../lib/material-form';
import { navigate, registerPendingNavigationGuard } from '../lib/router';
import { useUnsavedChanges } from '../lib/unsaved-changes';

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-vna-blue focus:ring-4 focus:ring-cyan-100';
const emptyFields: MaterialFields = {
  status: 'Undone', material_publish: 'Not published', submission_status: 'BOOKED', approval_status: 'BOOKED',
  publish_status: 'NOT_PUBLISHED', workflow_state: 'DRAFT', visibility: 'INTERNAL', source: 'WEB_APP', is_deleted: 'FALSE',
};

interface MaterialFormDraft {
  id: string;
  formData: MaterialDraftValue;
  recordVersion: number;
}

interface MaterialDraftValue extends Record<string, unknown> {
  materialId: string | null;
  title: string;
  fields: MaterialFields;
  references: MaterialCampaignReference[];
  referencesTouched: boolean;
  otherCampaignSelected: boolean;
  customCampaign: string;
  titleEdited: boolean;
  group: MaterialGroup | '';
  legacyLinks?: MaterialSupplementaryLink[];
  links?: MaterialSupplementaryLink[];
  description: CampaignRichTextDocument;
  manualMarkets: string[];
}

export function MaterialNewPage({ notify }: { notify(message: string): void }) {
  return <MaterialRecordPage notify={notify} />;
}

export function MaterialEditPage({ id, notify }: { id: string; notify(message: string): void }) {
  return <MaterialRecordPage id={id} notify={notify} />;
}

function MaterialRecordPage({ id, notify }: { id?: string; notify(message: string): void }) {
  const requestedDraftId = new URLSearchParams(window.location.search).get('draft');
  const draftId = useRef(requestedDraftId || crypto.randomUUID());
  const draftVersion = useRef(0);
  const draftExists = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const finishing = useRef(false);
  const capabilities = useAccessCapabilities();
  const [record, setRecord] = useState<MaterialSummary | null>(null);
  const [fields, setFields] = useState<MaterialFields>({ ...emptyFields });
  const [bootstrap, setBootstrap] = useState<MaterialPortalBootstrap | null>(null);
  const [markets, setMarkets] = useState<MarketRegionCatalogResponse | null>(null);
  const [references, setReferences] = useState<MaterialCampaignReference[]>([]);
  const [referencesTouched, setReferencesTouched] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState('');
  const [otherCampaignSelected, setOtherCampaignSelected] = useState(false);
  const [customCampaign, setCustomCampaign] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [group, setGroup] = useState<MaterialGroup | ''>('');
  const [legacyLinks, setLegacyLinks] = useState<MaterialSupplementaryLink[]>([]);
  const [description, setDescription] = useState<CampaignRichTextDocument>(materialRichText(null, null));
  const [manualMarkets, setManualMarkets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  useUnsavedChanges(touched && !saving);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([getMaterialBootstrap(), getMarketRegions(), id ? getMaterials() : Promise.resolve([]), requestedDraftId ? requestJson<MaterialFormDraft>(`/material-form-drafts/${encodeURIComponent(requestedDraftId)}`) : Promise.resolve(null)]).then(([referenceData, marketData, records, draft]) => {
      if (!active) return;
      const current = id ? records.find((candidate) => candidate.materialId === id || candidate.id === id) : undefined;
      if (id && !current) throw new Error('Không tìm thấy tư liệu cần sửa.');
      setBootstrap(referenceData);
      setMarkets(marketData);
      if (current) {
        setRecord(current);
        setFields({ ...current.fields });
        const loadedReferences = materialFormReferences(current.fields, referenceData.campaigns);
        setReferences(loadedReferences);
        setOtherCampaignSelected(loadedReferences.some((reference) => reference.kind === 'TEMPORARY'));
        setCustomCampaign(loadedReferences.find((reference) => reference.kind === 'TEMPORARY')?.name || '');
        setTitleEdited(true);
        setGroup(materialFormGroup(current.fields) as MaterialGroup | '');
        setLegacyLinks(materialFormLinks(current.fields));
        setDescription(materialDescription(current.fields));
        setManualMarkets((current.fields.market_codes || '').split(',').map((code) => code.trim()).filter(Boolean));
      }
      if (draft) {
        if (draft.formData.materialId !== (current?.id || null)) throw new Error('Bản nhập dở không thuộc tư liệu đang mở.');
        draftVersion.current = draft.recordVersion;
        draftExists.current = true;
        const value = draft.formData;
        setFields({ ...emptyFields, ...value.fields });
        setReferences(value.references || []);
        setReferencesTouched(Boolean(value.referencesTouched));
        setOtherCampaignSelected(Boolean(value.otherCampaignSelected));
        setCustomCampaign(value.customCampaign || '');
        setTitleEdited(Boolean(value.titleEdited));
        setGroup(value.group || '');
        setLegacyLinks(value.legacyLinks || value.links || materialFormLinks(value.fields));
        setDescription(value.description || materialRichText(null, null));
        setManualMarkets(value.manualMarkets || []);
        setDraftSaved(true);
      }
    }).catch((requestError: unknown) => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Không tải được form tư liệu.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, requestedDraftId]);

  const selectedCampaign = useMemo(() => inheritedMaterialMarkets(references, bootstrap?.campaigns || []), [references, bootstrap]);
  const selectedLanguages = parseMaterialLanguages(fields.material_languages);
  const titleSuggestion = materialTitleSuggestion(fields.material_type, fields.material_type_other, references);
  const title = titleEdited ? (fields.material_name || '') : titleSuggestion;
  const selectedMarketCodes = record && !referencesTouched ? (fields.market_codes || '').split(',').map((code) => code.trim()).filter(Boolean) : selectedCampaign?.market_codes || manualMarkets;
  const locked = Boolean(record?.isDeleted) || !capabilities[id ? 'material.update' : 'material.create'];
  const filteredCampaigns = (bootstrap?.campaigns || []).filter((campaign) =>
    `${campaign.campaign_code} ${campaign.campaign_name}`.toLocaleLowerCase('vi').includes(campaignQuery.trim().toLocaleLowerCase('vi'))).slice(0, 30);

  const draftValue: MaterialDraftValue = { materialId: record?.id || null, title, fields, references, referencesTouched, otherCampaignSelected, customCampaign, titleEdited, group, legacyLinks, description, manualMarkets };
  const draftSnapshot = JSON.stringify(draftValue);
  const latestDraftSnapshot = useRef(draftSnapshot);
  latestDraftSnapshot.current = draftSnapshot;

  const saveDraft = (snapshot: string): Promise<void> => {
    if (finishing.current) return Promise.resolve();
    setDraftSaving(true);
    const save = saveQueue.current.catch(() => undefined).then(async () => {
      const value = JSON.parse(snapshot) as MaterialDraftValue;
      const row = await requestJson<MaterialFormDraft>(`/material-form-drafts/${draftId.current}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: draftVersion.current, value }) });
      draftVersion.current = row.recordVersion;
      draftExists.current = true;
      if (latestDraftSnapshot.current === snapshot) { setTouched(false); setDraftSaved(true); }
    });
    saveQueue.current = save;
    void save.finally(() => setDraftSaving(false)).catch(() => undefined);
    return save;
  };

  useEffect(() => {
    if (loading || !touched || saving || finishing.current) return;
    setDraftSaved(false);
    const timer = window.setTimeout(() => { void saveDraft(draftSnapshot).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Chưa tự lưu được bản nhập dở.')); }, 1500);
    return () => window.clearTimeout(timer);
  }, [draftSnapshot, loading, saving, touched]);

  useEffect(() => registerPendingNavigationGuard(async () => {
    if (finishing.current || loading) return !loading;
    try {
      if (touched) await saveDraft(latestDraftSnapshot.current);
      else await saveQueue.current;
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được bản nhập dở.'); return false; }
  }), [loading, touched]);

  const saveDraftNow = async () => {
    try {
      if (touched) await saveDraft(latestDraftSnapshot.current);
      else await saveQueue.current;
      notify('Đã lưu nháp. Bạn có thể tiếp tục nhập tại đây.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không lưu nháp được.'); }
  };

  const closeForm = async () => {
    try {
      if (touched) await saveDraft(latestDraftSnapshot.current);
      else await saveQueue.current;
      navigate('/materials', false, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được bản nhập dở.'); }
  };

  const change = (key: MaterialFieldKey, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setTouched(true);
    setError(null);
  };

  const toggleCampaign = (campaign: MaterialPortalBootstrap['campaigns'][number]) => {
    setReferences((current) => current.some((item) => item.kind === 'SYSTEM' && item.id === campaign.campaign_id)
      ? current.filter((item) => item.id !== campaign.campaign_id)
      : [...current, { kind: 'SYSTEM', id: campaign.campaign_id, name: campaign.campaign_name }]);
    setReferencesTouched(true);
    setTouched(true);
  };

  const toggleOtherCampaign = (checked: boolean) => {
    setOtherCampaignSelected(checked);
    setReferences((current) => checked
      ? current.some((item) => item.kind === 'TEMPORARY') ? current : [...current, { kind: 'TEMPORARY', id: `temp:${crypto.randomUUID()}`, name: customCampaign }]
      : current.filter((item) => item.kind !== 'TEMPORARY'));
    setReferencesTouched(true);
    setTouched(true);
  };

  const updateOtherCampaign = (name: string) => {
    setCustomCampaign(name);
    setReferences((current) => current.map((item) => item.kind === 'TEMPORARY' ? { ...item, name } : item));
    setReferencesTouched(true);
    setTouched(true);
  };

  const setMarket = (code: string, checked: boolean) => {
    setManualMarkets((current) => checked ? [...new Set([...current, code])] : current.filter((item) => item !== code));
    setTouched(true);
  };

  const setLanguage = (language: string, checked: boolean) => {
    change('material_languages', JSON.stringify(checked
      ? [...selectedLanguages, language]
      : selectedLanguages.filter((value) => value !== language)));
  };

  const save = async () => {
    if (!bootstrap || locked || saving) return;
    if (!references.length) return setError('Hãy chọn ít nhất một Chiến dịch hoặc thêm Chiến dịch Khác.');
    if (otherCampaignSelected && !customCampaign.trim()) return setError('Hãy nhập tên Chiến dịch Khác trước khi lưu.');
    if (!group) return setError('Hãy chọn Nhóm tư liệu.');
    if (!fields.material_type) return setError('Hãy chọn Loại tư liệu.');
    if ((fields.material_type === 'Khác' || group === 'Khác') && !fields.material_type_other?.trim()) return setError('Hãy nhập tên Loại tư liệu khác.');
    if ((!record || fields.material_link !== record.fields.material_link) && !/^https?:\/\//i.test(fields.material_link?.trim() || '')) return setError('Mỗi tư liệu cần một Link tư liệu bắt đầu bằng http:// hoặc https://.');
    if (!title.trim()) return setError('Hãy nhập Tiêu đề tư liệu.');
    const nextFields: MaterialFields = {
      ...fields, material_group: group, material_name: title.trim(),
      material_description_rich_text: JSON.stringify(description),
      ...(!record ? { supplementary_links: null, supplementary_link: null, supplementary_link_1: null, supplementary_link_2: null } : {}),
      market_codes: selectedMarketCodes.join(','),
      ...(!record || referencesTouched ? { campaign_refs: JSON.stringify(references) } : {}),
    };
    setSaving(true);
    setError(null);
    finishing.current = true;
    try {
      await saveQueue.current;
      const result = await batchSaveMaterials([{
        clientKey: `material-form-${crypto.randomUUID()}`, fields: nextFields,
        ...(record ? { materialId: record.materialId, expectedVersion: record.recordVersion, baselineFields: record.fields } : {}),
      }]);
      const item = result.items[0];
      if (!item?.ok) throw new Error(item?.message || 'Không lưu được tư liệu.');
      notify(`Đã lưu tư liệu ${item.materialId ?? ''}.`);
      setTouched(false);
      if (item.material) { setRecord(item.material); setFields({ ...item.material.fields }); }
      setTitleEdited(true);
      if (draftExists.current) {
        try { await requestJson(`/material-form-drafts/${draftId.current}`, { method: 'DELETE' }); draftExists.current = false; }
        catch { notify('Tư liệu đã lưu nhưng bản nhập dở chưa dọn được. Có thể xóa bản nháp còn lại trong danh sách.'); }
      }
      navigate('/materials', false, true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không lưu được tư liệu.');
    } finally { setSaving(false); finishing.current = false; }
  };

  const changePublication = async (status: string) => {
    if (!record || status === (fields.publish_status || 'NOT_PUBLISHED')) return;
    if (touched) return setError('Hãy lưu thay đổi tư liệu trước khi đổi tình trạng xuất bản.');
    const action = status === 'PUBLISHED' ? 'PUBLISH' : status === 'PAUSED' ? 'PAUSE_PUBLISH' : 'UNPUBLISH';
    setSaving(true);
    setError(null);
    try {
      const result = await bulkMaterialAction([{ materialId: record.materialId, expectedVersion: record.recordVersion }], action);
      const item = result.items[0];
      if (!item?.ok) throw new Error(item?.message || 'Không đổi được tình trạng xuất bản.');
      const refreshed = (await getMaterials()).find((candidate) => candidate.materialId === record.materialId);
      if (refreshed) { setRecord(refreshed); setFields({ ...refreshed.fields }); }
      notify(`Đã cập nhật: ${MATERIAL_PUBLICATION_LABELS[status]}.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Không đổi được tình trạng xuất bản.'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-[1500px] space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Quản lý tư liệu QCTT</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{id ? 'Chỉnh sửa tư liệu' : 'Tạo tư liệu mới'}</h1><p className="mt-1 text-sm text-slate-500">Chiến dịch Khác chỉ là thông tin tạm gắn với tư liệu. Thị trường được lấy từ Chiến dịch chuẩn đã chọn.</p></div>
    </header>
    <CampaignDetailDock variant="entry"><Card className="flex flex-wrap items-center justify-between gap-3 border-slate-200 px-5 py-4">
      <div className="flex items-center gap-2 text-sm">{saving || draftSaving ? <><span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" /><span className="font-medium text-slate-600">Đang lưu…</span></> : touched ? <><span className="size-2 rounded-full bg-amber-500" /><span className="font-medium text-amber-800">Có thay đổi chưa lưu</span></> : draftSaved ? <><CpmsIcon name="success" className="text-emerald-600" /><span className="font-medium text-slate-600">Đã lưu nháp</span></> : record ? <><CpmsIcon name="success" className="text-emerald-600" /><span className="font-medium text-slate-600">Dữ liệu đã lưu</span></> : <span className="font-medium text-slate-500">Bản nhập dở sẽ tự lưu và chỉ bạn nhìn thấy</span>}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40" disabled={saving || draftSaving || loading} onClick={() => void closeForm()}><CpmsIcon name="back" />Về danh sách</button>
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-vna-blue hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={!touched || saving || draftSaving || locked || loading} onClick={() => void saveDraftNow()}><CpmsIcon name="save" />Lưu nháp</button>
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-vna-blue px-4 text-sm font-semibold text-white disabled:opacity-40" disabled={saving || draftSaving || locked || loading} onClick={() => void save()}><CpmsIcon name="save" />{saving ? 'Đang lưu…' : 'Lưu tư liệu'}</button>
      </div>
    </Card></CampaignDetailDock>
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}
    {loading ? <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">Đang tải dữ liệu tư liệu…</p> : null}
    {!loading && bootstrap ? <div className="space-y-5">
      <fieldset disabled={Boolean(locked) || saving} className="space-y-5">
        <MaterialFormSection title="Chiến dịch sử dụng tư liệu" description="Chọn một hoặc nhiều Chiến dịch; mục Khác chỉ lưu tên tạm cùng tư liệu." icon="campaign">
          <div className="grid gap-5 lg:grid-cols-2">
            <div><label className="text-sm font-semibold text-slate-700" htmlFor="material-campaign-search">Tìm Chiến dịch chuẩn</label><input id="material-campaign-search" className={inputClass} value={campaignQuery} onChange={(event) => setCampaignQuery(event.target.value)} placeholder="Tìm theo mã hoặc tên Chiến dịch" /><div className="mt-2 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white p-2">{filteredCampaigns.map((campaign) => <label key={campaign.campaign_id} className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm ${references.some((reference) => reference.kind === 'SYSTEM' && reference.id === campaign.campaign_id) ? 'bg-cyan-50 text-vna-blue' : 'hover:bg-slate-50'}`}><input type="checkbox" checked={references.some((reference) => reference.kind === 'SYSTEM' && reference.id === campaign.campaign_id)} onChange={() => toggleCampaign(campaign)} /><span><strong className="block">{campaign.campaign_name}</strong><span className="text-xs text-slate-500">{campaign.campaign_code}</span></span></label>)}</div></div>
            <div><label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${otherCampaignSelected ? 'border-vna-blue bg-cyan-50 text-vna-blue' : 'border-slate-200 text-slate-700'}`}><input type="checkbox" checked={otherCampaignSelected} onChange={(event) => toggleOtherCampaign(event.target.checked)} />Khác · tự nhập Chiến dịch</label>{otherCampaignSelected ? <Field label="Tên Chiến dịch khác *" className="mt-4"><input className={inputClass} required maxLength={240} value={customCampaign} onChange={(event) => updateOtherCampaign(event.target.value)} placeholder="Nhập tên Chiến dịch tạm" /></Field> : null}<p className="mt-3 text-xs text-slate-500">Tên tạm không tạo Chiến dịch mới và có thể thay bằng Chiến dịch chuẩn sau này.</p></div>
          </div>
          {references.some((reference) => reference.name.trim()) ? <div className="mt-4 flex flex-wrap gap-2">{references.filter((reference) => reference.name.trim()).map((reference) => <span key={reference.id} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-vna-blue">{reference.name}{reference.kind === 'TEMPORARY' ? ' · Khác' : ''}</span>)}</div> : null}
        </MaterialFormSection>

        <MaterialFormSection title="Thông tin chính" description="Chọn loại tư liệu; tiêu đề được gợi ý theo loại và Chiến dịch, vẫn có thể sửa theo ý bạn." icon="edit">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Nhóm tư liệu *"><select className={inputClass} value={group} onChange={(event) => { const next = event.target.value as MaterialGroup | ''; setGroup(next); change('material_type', ''); change('material_type_other', ''); }}><option value="">Chọn nhóm tư liệu</option>{MATERIAL_GROUPS.map((option) => <option key={option}>{option}</option>)}</select></Field>
            <Field label="Loại tư liệu *"><select className={inputClass} value={fields.material_type ?? ''} onChange={(event) => { change('material_type', event.target.value); if (event.target.value !== 'Khác') change('material_type_other', ''); }} disabled={!group}><option value="">Chọn loại tư liệu</option>{group ? MATERIAL_TYPES_BY_GROUP[group].map((option) => <option key={option}>{option}</option>) : null}</select></Field>
            {(fields.material_type === 'Khác' || group === 'Khác') ? <Field label="Tên loại tư liệu khác *"><input className={inputClass} value={fields.material_type_other ?? ''} onChange={(event) => change('material_type_other', event.target.value)} placeholder="Tự nhập loại tư liệu" /></Field> : null}
          </div>
          <div className="mt-6"><p className="text-sm font-semibold text-slate-700">Ngôn ngữ</p><p className="mt-1 text-xs text-slate-500">Có thể chọn nhiều ngôn ngữ cho cùng một tư liệu.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{MATERIAL_LANGUAGES.map((language) => <label key={language} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${selectedLanguages.includes(language) ? 'border-cyan-200 bg-cyan-50 font-semibold text-vna-blue' : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200'}`}><input type="checkbox" checked={selectedLanguages.includes(language)} onChange={(event) => setLanguage(language, event.target.checked)} />{language}</label>)}</div></div>
          <div className="mt-6 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4"><Field label="Tiêu đề tư liệu *"><input className={`${inputClass} border-cyan-200 bg-white text-base font-semibold`} maxLength={240} value={title} onChange={(event) => { setTitleEdited(true); change('material_name', event.target.value); }} placeholder="Ví dụ: Key Visual Mở bán vé Tết Đinh Mùi 2027" /></Field><p className="mt-2 text-xs text-slate-500">Gợi ý tự cập nhật khi đổi Loại tư liệu hoặc Chiến dịch, cho tới khi bạn tự sửa tiêu đề.</p></div>
        </MaterialFormSection>

        <MaterialFormSection title="Đường dẫn tư liệu" description="Mỗi tư liệu có một đường dẫn. Nếu có nhiều đường dẫn, hãy tạo từng tư liệu riêng; có thể thêm nhiều dòng ngay trong bảng danh sách." icon="link">
          <Field label="Link tư liệu *"><input className={inputClass} type="url" required value={fields.material_link ?? ''} onChange={(event) => change('material_link', event.target.value)} placeholder="https://…" /></Field>
          {legacyLinks.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><p className="font-semibold">Link bổ sung cũ (chỉ xem)</p><p className="mt-1">Các link này được giữ trong dữ liệu lịch sử, không thể nhập thêm. Với bản nhập dở chưa lưu thành tư liệu, chúng sẽ không đi vào bản ghi mới; hãy tạo tư liệu riêng cho từng link.</p><ul className="mt-2 list-inside list-disc space-y-1">{legacyLinks.map((link, index) => <li key={`${index}-${link.url}`} className="break-all">{link.label}: {link.url}</li>)}</ul></div> : null}
        </MaterialFormSection>

        <MaterialFormSection title="Mô tả tư liệu" description="Diễn giải nội dung tư liệu và giữ định dạng văn bản khi cần." icon="edit">
          <CampaignRichTextEditor value={description} disabled={Boolean(locked) || saving} onChange={(next) => { setDescription(next); setTouched(true); }} onValidationError={setError} label="Mô tả tư liệu" placeholder="Nhập mô tả tư liệu…" idPrefix="material-description" />
        </MaterialFormSection>

        <MaterialFormSection title="Phạm vi thị trường" description={selectedCampaign ? `Tự lấy theo “${selectedCampaign.campaign_name}” vì Chiến dịch này có nhiều thị trường nhất.` : 'Chỉ tự chọn khi dùng Chiến dịch Khác, chưa chọn Chiến dịch chuẩn.'} icon="filter">
          {selectedCampaign ? <div className="flex flex-wrap gap-2">{selectedMarketCodes.length ? selectedMarketCodes.map((code) => <span key={code} className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-vna-blue">{code}</span>) : <span className="text-xs text-slate-500">Chiến dịch chưa có thị trường.</span>}</div>
            : <div className="grid gap-3 md:grid-cols-2"><label className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-semibold"><input type="checkbox" checked={manualMarkets.includes('VN')} onChange={(event) => setMarket('VN', event.target.checked)} />Việt Nam</label><div className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-semibold">Quốc tế · chọn khu vực và thị trường cụ thể</p><div className="mt-2 max-h-56 space-y-3 overflow-auto">{markets?.regions.filter((region) => region.code !== 'DOM').map((region) => <div key={region.code}><p className="text-xs font-bold text-vna-blue">{region.name}</p><div className="mt-1 flex flex-wrap gap-3">{region.markets.map((market) => <label key={market.code} className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={manualMarkets.includes(market.code)} onChange={(event) => setMarket(market.code, event.target.checked)} />{market.code} · {market.name}</label>)}</div></div>)}</div></div></div>}
        </MaterialFormSection>

        <MaterialFormSection title="Ghi chú" description="Thông tin ngắn cần lưu ý về tư liệu." icon="info">
          <Field label="Ghi chú" className="max-w-3xl"><textarea className={`${inputClass} min-h-20 py-3`} maxLength={500} value={fields.note ?? ''} onChange={(event) => change('note', event.target.value)} placeholder="Thông tin ngắn cần lưu ý…" /></Field>
        </MaterialFormSection>
      </fieldset>

      <MaterialFormSection title="Lưu trữ và xuất bản" description="Ngày cập nhật có thể sửa; thời điểm tạo, các lần chỉnh sửa và người thực hiện được hệ thống ghi vào lịch sử." icon="info">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Field label="Mã tư liệu"><input className={`${inputClass} bg-slate-50 font-mono`} value={record?.materialId || 'Tự sinh khi lưu'} readOnly /></Field><Field label="Ngày cập nhật"><input className={inputClass} type="date" value={fields.material_update_date || (fields.created_at ? new Date(fields.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }))} disabled={Boolean(locked) || saving} onChange={(event) => change('material_update_date', event.target.value)} /></Field><Field label="Tình trạng xuất bản"><select className={inputClass} value={fields.publish_status || 'NOT_PUBLISHED'} disabled={!record || !capabilities['material.publish'] || saving || touched} onChange={(event) => void changePublication(event.target.value)}>{Object.entries(MATERIAL_PUBLICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
        {record?.isDeleted ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">Tư liệu nằm trong Thùng rác; hãy phục hồi trước khi sửa.</p> : null}
      </MaterialFormSection>
    </div> : null}
  </div>;
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block text-xs font-semibold text-slate-600 ${className}`}>{label}{children}</label>;
}

function MaterialFormSection({ title, description, icon, children }: { title: string; description: string; icon: Parameters<typeof CpmsIcon>[0]['name']; children: ReactNode }) {
  return <Card className="overflow-hidden"><div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name={icon} /></span><div><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div><div className="px-5 py-5 lg:px-6 lg:py-6">{children}</div></Card>;
}
