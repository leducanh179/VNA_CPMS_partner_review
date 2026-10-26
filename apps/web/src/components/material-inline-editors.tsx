import { MATERIAL_GROUPS, MATERIAL_PUBLICATION_LABELS, MATERIAL_TYPES_BY_GROUP, type MaterialGroup } from '@cpms/domain';
import { Button } from '@cpms/ui';
import { useState } from 'react';
import { materialTypeChoicePatch } from '../lib/material-inline-input';
import type { SupplyGridEditorProps } from './supply-grid';

export function MaterialTypeEditor({ row, onChangeFields, onCommit, onCancel }: SupplyGridEditorProps) {
  const group = String(row.material_group || ''), type = String(row.material_type || ''), other = String(row.material_type_other || '');
  const known = Boolean(MATERIAL_TYPES_BY_GROUP[group as MaterialGroup]?.includes(type));
  return <div>
    <label className="block text-sm font-medium">Loại tư liệu
      <select autoFocus aria-label="Chọn Loại tư liệu" className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2" value={type ? JSON.stringify([group, type]) : ''}
        onChange={event => { if (event.target.value) { const [nextGroup, nextType] = JSON.parse(event.target.value) as [string, string]; onChangeFields(materialTypeChoicePatch(nextGroup, nextType)); } }}>
        <option value="">Chọn loại tư liệu</option>
        {!known && type && <option value={JSON.stringify([group, type])}>{type} (hiện tại)</option>}
        {MATERIAL_GROUPS.map(name => <optgroup key={name} label={name}>{MATERIAL_TYPES_BY_GROUP[name].map(choice => <option key={choice} value={JSON.stringify([name, choice])}>{choice}</option>)}</optgroup>)}
      </select>
    </label>
    {group && <p className="mt-2 text-xs text-slate-500">Nhóm tư liệu: {group}</p>}
    {(type === 'Khác' || group === 'Khác') && <label className="mt-3 block text-sm">Loại tư liệu khác
      <input aria-label="Loại tư liệu khác" className="mt-1 w-full rounded-lg border border-slate-200 p-2" value={other} onChange={event => onChangeFields({ material_type_other: event.target.value })}/>
    </label>}
    <div className="mt-3 flex gap-2"><Button size="sm" disabled={!type || ((type === 'Khác' || group === 'Khác') && !other.trim())} onClick={onCommit}>Xong và lưu</Button><Button size="sm" variant="secondary" onClick={onCancel}>Hủy</Button></div>
  </div>;
}

export function MaterialPublicationEditor({ value, onCancel, onApply }: Pick<SupplyGridEditorProps, 'value' | 'onCancel'> & { onApply(status: string): Promise<boolean> }) {
  const [status, setStatus] = useState(value || 'NOT_PUBLISHED'), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (status === (value || 'NOT_PUBLISHED')) { onCancel(); return; }
    setBusy(true); setError('');
    try { if (await onApply(status)) onCancel(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không đổi được tình trạng xuất bản.'); }
    finally { setBusy(false); }
  };
  return <div>
    <label className="block text-sm font-medium">Tình trạng xuất bản
      <select autoFocus aria-label="Chọn Tình trạng xuất bản" disabled={busy} className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2" value={status} onChange={event => setStatus(event.target.value)}>
        {Object.entries(MATERIAL_PUBLICATION_LABELS).map(([key, label]) => <option key={key} value={key} disabled={key === 'PAUSED' && value !== 'PUBLISHED' && value !== 'PAUSED'}>{label}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Xong và lưu'}</Button><Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Hủy</Button></div>
  </div>;
}
