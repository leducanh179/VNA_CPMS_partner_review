import { MATERIAL_LANGUAGES, parseMaterialCampaignRefs, parseMaterialLanguages, type MaterialCampaignReference, type MaterialPortalBootstrap } from '@cpms/domain';
import { Button } from '@cpms/ui';
import { useState } from 'react';
import { CampaignRichTextEditor } from './campaign-rich-text-editor';
import { materialRichText } from '../lib/material-form';
import type { SupplyGridEditorProps } from './supply-grid';

function EditorActions({ onCommit, onCancel, disabled = false }: Pick<SupplyGridEditorProps, 'onCommit' | 'onCancel'> & { disabled?: boolean }) {
  return <div className="mt-3 flex gap-2"><Button size="sm" disabled={disabled} onClick={onCommit}>Xong và lưu</Button><Button size="sm" variant="secondary" onClick={onCancel}>Hủy</Button></div>;
}
export function MaterialCampaignEditor({ value, onChange, onCommit, onCancel, campaigns }: SupplyGridEditorProps & { campaigns: MaterialPortalBootstrap['campaigns'] }) {
  const refs = parseMaterialCampaignRefs(value);
  const [other, setOther] = useState(refs.some(ref => ref.kind === 'TEMPORARY'));
  const [query, setQuery] = useState('');
  const temporary = refs.find(ref => ref.kind === 'TEMPORARY');
  const set = (next: MaterialCampaignReference[]) => onChange(JSON.stringify(next));
  return <div><h3 className="mb-2 font-semibold">Chiến dịch</h3><input autoFocus aria-label="Tìm Chiến dịch" placeholder="Tìm Chiến dịch" className="mb-2 w-full rounded border p-2" value={query} onChange={event => setQuery(event.target.value)}/>
    <div className="max-h-44 overflow-auto">{campaigns.filter(item => (item.campaign_name + item.campaign_code).toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))).map(item => <label key={item.campaign_id} className="flex gap-2 p-2 text-sm"><input type="checkbox" checked={refs.some(ref => ref.id === item.campaign_id)} onChange={event => set(event.target.checked ? [...refs, { kind: 'SYSTEM', id: item.campaign_id, name: item.campaign_name }] : refs.filter(ref => ref.id !== item.campaign_id))}/>{item.campaign_name}</label>)}</div>
    {refs.filter(ref => ref.kind === 'SYSTEM' && !campaigns.some(item => item.campaign_id === ref.id)).map(ref => <p key={ref.id} className="text-xs text-slate-500">{ref.name} (liên kết đang lưu)</p>)}
    <label className="my-2 flex gap-2 text-sm"><input type="checkbox" checked={other} onChange={event => { setOther(event.target.checked); set(event.target.checked ? [...refs, { kind: 'TEMPORARY', id: `temp:${crypto.randomUUID()}`, name: '' }] : refs.filter(ref => ref.kind !== 'TEMPORARY')); }}/>Khác</label>
    {other && <input aria-label="Tên Chiến dịch khác" className="w-full rounded border p-2" value={temporary?.name || ''} placeholder="Bắt buộc nhập tên Chiến dịch khác" onChange={event => set(refs.map(ref => ref.id === temporary?.id ? { ...ref, name: event.target.value } : ref))}/>}
    <EditorActions onCommit={onCommit} onCancel={onCancel} disabled={!refs.length || refs.some(ref => !ref.name.trim())}/>
  </div>;
}
export function MaterialLanguageEditor(props: SupplyGridEditorProps) {
  const values = parseMaterialLanguages(props.value);
  return <div><h3 className="mb-2 font-semibold">Ngôn ngữ</h3>{MATERIAL_LANGUAGES.map(language => <label key={language} className="flex gap-2 py-1.5 text-sm"><input type="checkbox" checked={values.includes(language)} onChange={event => props.onChange(JSON.stringify(event.target.checked ? [...values, language] : values.filter(value => value !== language)))}/>{language}</label>)}<EditorActions {...props}/></div>;
}
export function MaterialDescriptionEditor(props: SupplyGridEditorProps) {
  const [error, setError] = useState('');
  return <div><CampaignRichTextEditor label="Mô tả tư liệu" value={materialRichText(props.value, '')} onChange={value => props.onChange(JSON.stringify(value))} onValidationError={setError}/>{error && <p role="alert">{error}</p>}<EditorActions {...props} disabled={Boolean(error)}/></div>;
}
export function MaterialMarketEditor(props: SupplyGridEditorProps & { markets: string[] }) {
  const values = props.value.split(',').filter(Boolean);
  return <div><h3 className="mb-2 font-semibold">Phạm vi thị trường</h3><div className="grid grid-cols-2 gap-2">{[...new Set([...props.markets, ...values])].map(market => <label key={market} className="flex gap-2 text-sm"><input type="checkbox" checked={values.includes(market)} onChange={event => props.onChange((event.target.checked ? [...values, market] : values.filter(value => value !== market)).join(','))}/>{market}</label>)}</div><EditorActions {...props}/></div>;
}
