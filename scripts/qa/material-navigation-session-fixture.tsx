import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../apps/web/src/auth-context';
import { requestJson } from '../../apps/web/src/lib/api';
import { MaterialSpreadsheet } from '../../apps/web/src/components/material-spreadsheet';
import '../../apps/web/src/index.css';

const refs = [{ kind: 'SYSTEM', id: 'qa-campaign', name: 'Chiến dịch thử nghiệm' }];
const initial = { materialId: 'qa-material', recordVersion: 1, isDeleted: false, capabilities: { view: true, edit: true, publish: true }, fields: { material_name: 'Key Visual thử nghiệm', material_type: 'Key Visual', material_group: 'Hình ảnh', material_link: 'https://example.test/material', material_update_date: '2026-10-24', campaign_refs: JSON.stringify(refs), publish_status: 'NOT_PUBLISHED' } };
const bootstrap = { campaigns: refs.map(ref => ({ campaign_id: ref.id, campaign_name: ref.name, campaign_code: ref.id, market_codes: ['VN'], effectiveStartDate: '2026-10-01', effectiveEndDate: '2026-10-31', departureStartDate: '2026-11-01', departureEndDate: '2027-02-28' })), settings: {}, users: [], fieldRules: [], roleRules: [], options: { markets: [], statuses: [], materialTypes: [] } };
function Fixture() {
  const { logout, me } = useAuth();
  const [items, setItems] = useState([initial]);
  return <main className="mx-auto max-w-[1400px] bg-white p-5"><h1 className="mb-5 text-xl">Kiểm thử bảng Tư liệu — dữ liệu giả</h1>
    <button data-inline-save-surface onClick={() => { void requestJson('/qa-protected').catch(() => {}); }}>Kiểm thử yêu cầu bảo vệ</button>
    <button onClick={logout}>Đăng xuất thử nghiệm</button><span data-qa-actor>{me.account.id}</span>
    <MaterialSpreadsheet actorId={me.account.id} records={items} bootstrap={bootstrap} embedded={false} trash={false} can={() => true} directSuperadmin={false}
      notify={message => { document.querySelector('#notice')!.textContent = message; }}
      onRecords={updated => setItems(current => current.map(item => updated.find(row => row.materialId === item.materialId) || item))}
      onCollaboration={() => {}} search="" dateRange={{ from: '', to: '' }} publication="ALL" pageSize={10}/>
    <div id="notice" role="status"/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><Fixture/></AuthProvider></React.StrictMode>);
