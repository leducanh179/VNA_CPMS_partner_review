import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LookupRecordKind } from '@cpms/ai-contracts';
import { AuthProvider } from '../../apps/web/src/auth-context';
import { AccessCapabilitiesProvider } from '../../apps/web/src/access-context';
import { AppShell } from '../../apps/web/src/components/app-shell';
import { SupplyGrid } from '../../apps/web/src/components/supply-grid';
import { usePathname } from '../../apps/web/src/lib/router';
import { useUnsavedChanges } from '../../apps/web/src/lib/unsaved-changes';
import { AiSettings } from '../../apps/web/src/components/ai-settings';
import '../../apps/web/src/index.css';
function Fixture() {
  const pathname = usePathname();
  const [value, setValue] = useState(''), [kind, setKind] = useState<LookupRecordKind>('CAMPAIGN');
  const [dirty,setDirty] = useState(false);useUnsavedChanges(dirty);
  return <AppShell pathname={pathname}>{pathname==='/admin/system' ? <AiSettings/> : pathname !== '/' && <section className="space-y-4">
    <h1>Biểu mẫu thử nghiệm — dữ liệu giả</h1>
    <label><input type="checkbox" aria-label="Đánh dấu form chưa lưu" checked={dirty} onChange={e=>setDirty(e.target.checked)}/>Kiểm thử form chưa lưu</label>
    <label>Nội dung đang nhập<textarea aria-label="Nội dung nghiệp vụ chưa lưu" value={value} onChange={event => setValue(event.target.value)} className="block w-full rounded border p-3"/></label>
    <label>Phân hệ<select aria-label="Phân hệ thử nghiệm" value={kind} onChange={event => setKind(event.target.value as LookupRecordKind)}>{['CAMPAIGN','MATERIAL','CONTRACT','BOOKING'].map(value => <option key={value}>{value}</option>)}</select></label>
    <SupplyGrid rows={[{id:'00000000-0000-4000-8000-000000000001',name:'Mở bán vé Tết mẫu',note:'Nội dung mẫu đang biên tập'}]}
      aiRecord={row=>({kind,id:row.id})} columns={[{key:'name',label:'Tên hồ sơ',width:230},{key:'note',label:'Ghi chú',width:320}]}
      storageKey={`qa.ai.${kind}`} spreadsheet rowNumbers expandable canEdit={false}/>
    <div className="h-[900px]">Phần tiếp theo của biểu mẫu</div>
  </section>}</AppShell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><AccessCapabilitiesProvider><Fixture/></AccessCapabilitiesProvider></AuthProvider></React.StrictMode>);
