import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useAuth } from '../auth-context';
import { WorkflowPolicyEditor } from '../components/workflow-policy-editor';
import { BookingPolicyEditor } from '../components/booking-workflow-controls';
import { BookingDelegationEditor } from '../components/booking-delegation-editor';
import { useAccessCapabilities } from '../access-context';
import { useEffect, useState } from 'react';
import { confirmUnsavedNavigation } from '../lib/unsaved-changes';
import { connectSharedDriveIntegration, getSharedDriveIntegrationStatus, requestJson, type SharedDriveIntegrationStatus } from '../lib/api';
import { AppLink } from '../lib/router';

export function AdminSystemPage() {
  const { me } = useAuth();
  const capabilities=useAccessCapabilities();
  const [section,setSection]=useState(me.directSuperadmin && new URLSearchParams(window.location.search).get('section') === 'DRIVE' ? 'DRIVE' : me.directSuperadmin?'POLICY':'DELEGATION');
  const [driveStatus, setDriveStatus] = useState<SharedDriveIntegrationStatus | null>(null);
  const [driveError, setDriveError] = useState(new URLSearchParams(window.location.search).get('google') === 'error'
    ? 'Kết nối Google Drive chưa hoàn tất. Kiểm tra tài khoản tích hợp và quyền Drive rồi thử lại.' : '');
  const [driveBusy, setDriveBusy] = useState(false);
  useEffect(() => {
    if (!me.directSuperadmin || section !== 'DRIVE') return;
    let active = true;
    void getSharedDriveIntegrationStatus().then((result) => { if (active) setDriveStatus(result); })
      .catch((error: unknown) => { if (active) setDriveError(error instanceof Error ? error.message : 'Không tải được trạng thái Google Drive.'); });
    return () => { active = false; };
  }, [me.directSuperadmin, section]);
  const connectDrive = async () => {
    setDriveBusy(true); setDriveError('');
    try { const result = await connectSharedDriveIntegration(); window.location.assign(result.authorizationUrl); }
    catch (error) { setDriveError(error instanceof Error ? error.message : 'Không thể bắt đầu kết nối Google Drive.'); setDriveBusy(false); }
  };
  const [catalogMissing, setCatalogMissing] = useState<boolean | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  useEffect(() => {
    if (!me.directSuperadmin) return;
    let active = true;
    void requestJson<{ permissions: { 'access.manage'?: boolean } }>('/access/capabilities')
      .then((result) => { if (active) setCatalogMissing(!result.permissions['access.manage']); })
      .catch((error: unknown) => { if (active) setCatalogError(error instanceof Error ? error.message : 'Không kiểm tra được danh mục quyền.'); });
    return () => { active = false; };
  }, [me.directSuperadmin]);
  const initializeCatalog = async () => {
    setCatalogBusy(true); setCatalogError('');
    try {
      await requestJson('/access/catalog/initialize', { method: 'POST' });
      setCatalogMissing(false);
      window.dispatchEvent(new Event('cpms:access-updated'));
    } catch (error) { setCatalogError(error instanceof Error ? error.message : 'Không khởi tạo được danh mục quyền.'); }
    finally { setCatalogBusy(false); }
  };
  if (!me.directSuperadmin&&!capabilities['contract.approve']) return <Card className="p-6">Cần quyền quản trị hoặc LĐP phụ trách hợp đồng để mở mục này.</Card>;
  return <div className="mx-auto max-w-[1500px] space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[0.2em] text-vna-gold-dark">Quản trị CPMS</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Quản trị hệ thống</h1><p className="mt-2 text-sm text-slate-600">Thiết lập chính sách vận hành dùng chung cho các phân hệ.</p>{me.directSuperadmin && <AppLink to="/admin/accounts" className="mt-3 inline-block text-sm font-semibold text-vna-blue">Tài khoản và nhân sự</AppLink>}</header>
    {me.directSuperadmin && catalogMissing && <Card className="space-y-3 border-amber-300 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">Danh mục quyền chưa được khởi tạo</h2><p className="text-sm text-amber-900">Tài khoản của anh đã là ADMIN toàn hệ thống. Khởi tạo danh mục sẽ kích hoạt quyền cho các phân hệ đã triển khai và quyền mặc định theo vai trò; không tạo thêm tài khoản.</p><Button disabled={catalogBusy} onClick={() => void initializeCatalog()}>Khởi tạo danh mục quyền</Button></Card>}
    {me.directSuperadmin && catalogError && <p role="alert" className="text-sm text-rose-700">{catalogError}</p>}
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <Card className="h-fit p-3"><nav aria-label="Mục con Quản trị hệ thống" className="space-y-2">{(me.directSuperadmin?[['POLICY','Phân quyền'],['DELEGATION','Ủy quyền duyệt đặt chỗ'],['DRIVE','Google Drive Chiến dịch']]:[['DELEGATION','Ủy quyền duyệt đặt chỗ']]).map(([key,label])=><button key={key} type="button" aria-current={section===key?'page':undefined} onClick={()=>{if(confirmUnsavedNavigation())setSection(key!);}} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold ${section===key?'bg-cyan-50 text-vna-blue':'text-slate-600'}`}><CpmsIcon name="locked"/>{label}</button>)}</nav></Card>
      <Card className="min-w-0 overflow-hidden">{section==='DRIVE' && me.directSuperadmin ? <div className="space-y-4 p-5 lg:p-6"><h2 className="text-lg font-semibold text-slate-950">Kết nối Google Drive dùng chung</h2><p className="text-sm text-slate-600">Một tài khoản Google do quản trị viên kết nối để CPMS tạo và quản lý folder Chiến dịch. Người dùng CPMS không cần tự kết nối Google.</p>{driveStatus ? <p className="text-sm font-semibold text-slate-800">{driveStatus.connected ? `Đã kết nối: ${driveStatus.account?.email}` : driveStatus.message}</p> : <p className="text-sm text-slate-500">Đang kiểm tra kết nối…</p>}{driveError ? <p role="alert" className="text-sm text-rose-700">{driveError}</p> : null}{driveStatus?.configured && !driveStatus.connected ? <Button disabled={driveBusy} onClick={() => void connectDrive()}><CpmsIcon name="link" />{driveBusy ? 'Đang mở Google…' : 'Kết nối tài khoản Google dùng chung'}</Button> : null}<p className="text-xs text-slate-500">Folder Chiến dịch kế thừa quyền truy cập từ thư mục cha. CPMS không tự đặt quyền “Anyone” riêng trên từng folder; chính sách cấp quyền theo Gmail có thể thay thế về sau.</p></div> : section==='POLICY'&&me.directSuperadmin?<><div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6"><h2 className="text-lg font-semibold text-slate-950">Chính sách luồng phê duyệt mặc định cho toàn bộ Chiến dịch</h2><p className="mt-1 text-sm text-slate-500">Chọn phạm vi áp dụng và mức độ kiểm soát phù hợp với giai đoạn vận hành.</p></div><div className="p-5 lg:p-6"><WorkflowPolicyEditor campaignId={null} /></div><BookingPolicyEditor/></>:<BookingDelegationEditor/>}</Card>
    </div>
  </div>;
}
