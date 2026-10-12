import type {
  CampaignDriveFileItem,
  CampaignDriveFileStatus,
  CampaignDriveFolderKey,
  CampaignDriveSyncStatus,
  CampaignDriveWorkspaceView,
  CampaignSummary,
} from '@cpms/domain';
import { Button, Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  adoptExistingCampaignDriveFolder,
  ensureCampaignDriveWorkspace,
  getCampaignDriveWorkspace,
  listCampaignDriveFiles,
  previewExistingCampaignDriveFolder,
  type ExistingCampaignDriveFolderPreview,
  renameCampaignDriveFile,
  restoreCampaignDriveFile,
  syncCampaignDriveWorkspaceName,
  trashCampaignDriveFile,
  uploadCampaignDriveFile,
} from '../lib/api';

interface CampaignDriveWorkspaceCardProps {
  campaign: CampaignSummary | undefined;
  notify(message: string): void;
}

interface UploadTask {
  id: string;
  file: File;
  progress: number;
  status: 'UPLOADING' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
  error: string | null;
  cancel?: () => void;
}

const STATUS_LABELS: Record<CampaignDriveSyncStatus, string> = {
  NOT_CREATED: 'Chưa tạo',
  CREATING: 'Đang tạo',
  READY: 'Đã sẵn sàng',
  NEEDS_SYNC: 'Cần đồng bộ',
  CONFLICT: 'Xung đột',
  PERMISSION_SETUP_REQUIRED: 'Cần cấp quyền',
  OUT_OF_SYNC: 'Chưa đồng bộ',
  ERROR: 'Lỗi Google Drive',
};

const STATUS_STYLE: Record<CampaignDriveSyncStatus, string> = {
  NOT_CREATED: 'bg-slate-100 text-slate-700',
  CREATING: 'bg-cyan-50 text-vna-blue',
  READY: 'bg-emerald-50 text-emerald-800',
  NEEDS_SYNC: 'bg-amber-50 text-amber-900',
  CONFLICT: 'bg-rose-50 text-rose-800',
  PERMISSION_SETUP_REQUIRED: 'bg-amber-50 text-amber-900',
  OUT_OF_SYNC: 'bg-amber-50 text-amber-900',
  ERROR: 'bg-rose-50 text-rose-800',
};

function formatBytes(value: number | null) {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function CampaignDriveWorkspaceCard({ campaign, notify }: CampaignDriveWorkspaceCardProps) {
  const [workspace, setWorkspace] = useState<CampaignDriveWorkspaceView | null>(null);
  const [activeFolder, setActiveFolder] = useState<CampaignDriveFolderKey>('BASE_DOCUMENTS');
  const [fileStatus, setFileStatus] = useState<CampaignDriveFileStatus>('ACTIVE');
  const [files, setFiles] = useState<CampaignDriveFileItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(Boolean(campaign));
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [existingFolderUrl, setExistingFolderUrl] = useState('');
  const [existingFolderPreview, setExistingFolderPreview] = useState<ExistingCampaignDriveFolderPreview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadWorkspace = useCallback(async () => {
    if (!campaign) return;
    setLoadingWorkspace(true);
    setError(null);
    try {
      setWorkspace(await getCampaignDriveWorkspace(campaign.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải trạng thái Google Drive Workspace.');
    } finally {
      setLoadingWorkspace(false);
    }
  }, [campaign]);

  const loadFiles = useCallback(async (append = false) => {
    if (!campaign || !workspace?.folders.some((folder) => folder.key === activeFolder && folder.available)) return;
    setLoadingFiles(true);
    setFileError(null);
    try {
      const page = await listCampaignDriveFiles(campaign.id, activeFolder, fileStatus, append ? nextPageToken ?? undefined : undefined);
      setFiles((current) => append ? [...current, ...page.items] : page.items);
      setNextPageToken(page.nextPageToken);
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : 'Không thể tải danh sách file.');
    } finally {
      setLoadingFiles(false);
    }
  }, [activeFolder, campaign, fileStatus, nextPageToken, workspace?.folders]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => {
    setFiles([]);
    setNextPageToken(null);
    if (workspace?.syncStatus === 'READY' || workspace?.syncStatus === 'NEEDS_SYNC') void loadFiles(false);
  }, [activeFolder, fileStatus, workspace?.syncStatus]); // loadFiles intentionally follows the selected folder/status and stable workspace state.

  const runWorkspaceAction = async (action: 'ENSURE' | 'SYNC_NAME') => {
    if (!campaign || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = action === 'SYNC_NAME'
        ? await syncCampaignDriveWorkspaceName(campaign.id)
        : await ensureCampaignDriveWorkspace(campaign.id);
      setWorkspace(result);
      notify(action === 'SYNC_NAME' ? 'Đã cập nhật tên thư mục Google Drive.' : 'Đã kiểm tra Google Drive Workspace.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Thao tác Google Drive không hoàn tất.');
    } finally {
      setBusy(false);
    }
  };

  const previewFolder = async () => {
    if (!campaign || busy) return;
    setBusy(true);
    setError(null);
    try {
      setExistingFolderPreview(await previewExistingCampaignDriveFolder(campaign.id, existingFolderUrl.trim()));
    } catch (cause) {
      setExistingFolderPreview(null);
      setError(cause instanceof Error ? cause.message : 'Không thể kiểm tra link thư mục Google Drive.');
    } finally {
      setBusy(false);
    }
  };

  const adoptFolder = async () => {
    if (!campaign || !existingFolderPreview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await adoptExistingCampaignDriveFolder(campaign.id, existingFolderPreview);
      setWorkspace(updated);
      if (updated.syncStatus === 'READY') {
        setExistingFolderPreview(null);
        setExistingFolderUrl('');
        notify('Đã liên kết thư mục Google Drive với Chiến dịch và đồng bộ tên, cấu trúc.');
      } else {
        setError(updated.lastErrorMessage ?? 'Đã liên kết folder nhưng đồng bộ chưa hoàn tất. Hãy kiểm tra/đồng bộ lại.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể liên kết thư mục Google Drive.');
    } finally {
      setBusy(false);
    }
  };

  const beginUpload = (file: File, taskId: string = crypto.randomUUID()) => {
    if (!campaign || !workspace?.capabilities?.upload || campaign.isDeleted) return;
    setUploads((current) => {
      const next: UploadTask = { id: taskId, file, progress: 0, status: 'UPLOADING', error: null };
      const index = current.findIndex((task) => task.id === taskId);
      return index < 0 ? [...current, next] : current.map((task) => task.id === taskId ? next : task);
    });
    const operation = uploadCampaignDriveFile(campaign.id, activeFolder, file, (progress) => {
      setUploads((current) => current.map((task) => task.id === taskId ? { ...task, progress } : task));
    });
    setUploads((current) => current.map((task) => task.id === taskId ? { ...task, cancel: operation.cancel } : task));
    void operation.promise.then(() => {
      setUploads((current) => current.map((task) => {
        if (task.id !== taskId) return task;
        return { id: task.id, file: task.file, progress: 100, status: 'SUCCESS', error: null };
      }));
      void loadFiles(false);
    }).catch((cause: unknown) => {
      const cancelled = cause instanceof DOMException && cause.name === 'AbortError';
      setUploads((current) => current.map((task) => {
        if (task.id !== taskId) return task;
        return {
          id: task.id,
          file: task.file,
          progress: task.progress,
          status: cancelled ? 'CANCELLED' : 'ERROR',
          error: cancelled ? null : cause instanceof Error ? cause.message : 'Tải file không thành công.',
        };
      }));
    });
  };

  const chooseFiles = (list: FileList | null) => {
    if (!list) return;
    [...list].forEach((file) => beginUpload(file));
    if (inputRef.current) inputRef.current.value = '';
  };

  const renameFile = async (file: CampaignDriveFileItem) => {
    if (!campaign) return;
    const name = window.prompt('Tên file mới:', file.name)?.trim();
    if (!name || name === file.name) return;
    try {
      const updated = await renameCampaignDriveFile(campaign.id, file.id, name);
      setFiles((current) => current.map((item) => item.id === file.id ? updated : item));
      notify(`Đã đổi tên file thành “${updated.name}”.`);
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : 'Không thể đổi tên file.');
    }
  };

  const trashFile = async (file: CampaignDriveFileItem) => {
    if (!campaign || pendingFileId || !window.confirm('File sẽ được chuyển vào Thùng rác Google Drive và có thể bị xóa vĩnh viễn sau 30 ngày.')) return;
    setPendingFileId(file.id);
    setFileError(null);
    try {
      await trashCampaignDriveFile(campaign.id, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      notify(`Đã đưa “${file.name}” vào Thùng rác Google Drive.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể đưa file vào Thùng rác.';
      setFileError(message);
      notify(message);
    } finally {
      setPendingFileId(null);
    }
  };

  const restoreFile = async (file: CampaignDriveFileItem) => {
    if (!campaign || pendingFileId) return;
    setPendingFileId(file.id);
    setFileError(null);
    try {
      await restoreCampaignDriveFile(campaign.id, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      notify(`Đã phục hồi “${file.name}” về ${file.folderLabel}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể phục hồi file.';
      setFileError(message);
      notify(message);
    } finally {
      setPendingFileId(null);
    }
  };

  if (!campaign) {
    return <Card className="overflow-hidden"><DriveHeader /><div className="px-5 py-8 text-center lg:px-6"><CpmsIcon name="folder" className="mx-auto text-slate-400" size={30} /><p className="mt-3 font-semibold text-slate-800">Hãy lưu Chiến dịch trước để tạo thư mục Google Drive.</p><p className="mt-1 text-sm text-slate-500">Workspace chỉ được tạo sau khi hệ thống đã sinh mã Chiến dịch.</p></div></Card>;
  }

  if (loadingWorkspace) return <Card className="overflow-hidden"><DriveHeader /><div className="flex min-h-32 items-center justify-center gap-3 text-sm text-slate-600"><span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" />Đang tải Google Drive Workspace…</div></Card>;
  if (!workspace) return <Card className="overflow-hidden"><DriveHeader /><ErrorBlock message={error ?? 'Không thể tải Google Drive Workspace.'} onRetry={() => void loadWorkspace()} /></Card>;
  if (!workspace.canViewDriveWorkspace) return null;

  const fileWorkspaceReady = (workspace.syncStatus === 'READY' || workspace.syncStatus === 'NEEDS_SYNC') && workspace.folders.some((folder) => folder.available);
  const allowChanges = workspace.canManageDriveWorkspace && !campaign.isDeleted;

  return (
    <Card className="overflow-hidden">
      <DriveHeader />
      <div className="space-y-5 px-5 py-5 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLE[workspace.syncStatus]}`}>{STATUS_LABELS[workspace.syncStatus]}</span><StatusBadge>{workspace.lifecycleStatus === 'TRASHED' ? 'Đang ở Thùng rác' : workspace.accessMode}</StatusBadge></div>
            <p className="mt-3 truncate font-semibold text-slate-900" title={workspace.campaignFolderName ?? workspace.expectedFolderName}>{workspace.campaignFolderName ?? workspace.expectedFolderName}</p>
            <p className="mt-1 text-xs text-slate-500">Đồng bộ gần nhất: {formatDate(workspace.lastCheckedAt)}{workspace.googleAccountEmail ? ` · ${workspace.googleAccountEmail}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workspace.campaignFolderLink ? <a className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-vna-blue transition hover:border-vna-blue/40" href={workspace.campaignFolderLink} target="_blank" rel="noreferrer"><CpmsIcon name="externalLink" />Mở đầy đủ trên Google Drive</a> : null}
            <Button variant="secondary" className="gap-2" disabled={busy || !allowChanges || !workspace.capabilities?.ensure} onClick={() => void runWorkspaceAction('ENSURE')}><CpmsIcon name="refresh" />{busy ? 'Đang xử lý…' : 'Kiểm tra/đồng bộ'}</Button>
          </div>
        </div>

        {!workspace.configured ? <Notice tone="error" text="Google Drive Workspace chưa được cấu hình phía server." /> : null}
        {workspace.providerWritesEnabled === false && <Notice tone="warning" text="Thao tác ghi và kết nối Google đang tắt trong phiên demo này." />}
        {workspace.needsReconsent || !workspace.googleConnected ? <Notice tone="warning" text="Tài khoản Google Drive dùng chung chưa kết nối hoặc cần cấp lại quyền. Quản trị viên thiết lập trong Quản trị hệ thống → Google Drive." /> : null}
        {!workspace.campaignFolderLink && workspace.googleConnected && allowChanges && workspace.capabilities?.ensure ? <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4"><h3 className="font-semibold text-slate-900">Dùng thư mục Google Drive đã có</h3><p className="text-sm text-slate-600">Dành cho Chiến dịch cũ. Thư mục phải nằm trực tiếp trong thư mục cha của Chiến dịch trên Shared Drive; CPMS giữ nguyên các file bên trong.</p><div className="flex flex-wrap gap-2"><input aria-label="Link thư mục Google Drive có sẵn" type="url" value={existingFolderUrl} onChange={(event) => { setExistingFolderUrl(event.target.value); setExistingFolderPreview(null); }} placeholder="https://drive.google.com/drive/folders/…" className="min-w-64 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /><Button variant="secondary" disabled={busy || !existingFolderUrl.trim()} onClick={() => void previewFolder()}>Kiểm tra link</Button></div>{existingFolderPreview ? <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>Thư mục hiện tại: <strong>{existingFolderPreview.currentName}</strong></p><p>CPMS sẽ đổi tên thư mục thành: <strong>{existingFolderPreview.expectedName}</strong>. Các file bên trong được giữ nguyên.</p><Button disabled={busy} onClick={() => void adoptFolder()}>Xác nhận liên kết và đổi tên</Button></div> : null}</div> : null}
        {workspace.nameMismatch ? <Notice tone="warning" text={`Tên thư mục hiện tại chưa khớp. Tên đề xuất: “${workspace.expectedFolderName}”.`} action={<Button size="sm" variant="secondary" disabled={busy || !allowChanges || !workspace.capabilities?.rename} onClick={() => { if (window.confirm('Cập nhật tên thư mục theo tên Chiến dịch hiện tại?')) void runWorkspaceAction('SYNC_NAME'); }}><CpmsIcon name="edit" />Cập nhật tên thư mục</Button>} /> : null}
        {(workspace.lastErrorMessage || error) ? <Notice tone="error" text={`${workspace.lastErrorMessage ?? error}${workspace.lastErrorCode === 'FORBIDDEN' ? ' Hãy liên hệ quản trị viên nếu cần hỗ trợ quyền.' : ''}`} /> : null}
        {campaign.isDeleted ? <Notice tone="warning" text="Chiến dịch đang ở Thùng rác. Khôi phục Chiến dịch trước khi quản lý file Google Drive." /> : null}

        {fileWorkspaceReady ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-3 py-3">
              <div className="flex flex-wrap gap-1">{workspace.folders.map((folder) => <button key={folder.key} type="button" disabled={!folder.available} className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${activeFolder === folder.key ? 'bg-vna-blue text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-vna-blue disabled:opacity-40'}`} onClick={() => setActiveFolder(folder.key)}>{folder.label}</button>)}</div>
              <div className="flex gap-2"><Button size="sm" variant="secondary" className="gap-2" disabled={loadingFiles} onClick={() => void loadFiles(false)}><CpmsIcon name="refresh" />Làm mới</Button>{fileStatus === 'ACTIVE' ? <Button size="sm" className="gap-2" disabled={!allowChanges || !workspace.capabilities?.upload} onClick={() => inputRef.current?.click()}><CpmsIcon name="upload" />Tải file lên</Button> : null}<input ref={inputRef} className="sr-only" type="file" multiple onChange={(event) => chooseFiles(event.target.files)} /></div>
            </div>

            <div className="mx-3 mt-3 flex w-fit rounded-xl bg-slate-100 p-1" aria-label="Trạng thái file">{([{ value: 'ACTIVE', label: 'File đang sử dụng' }, { value: 'TRASHED', label: 'Thùng rác' }] as const).map((option) => <button key={option.value} type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${fileStatus === option.value ? 'bg-white text-vna-blue shadow-sm' : 'text-slate-600 hover:text-vna-blue'}`} onClick={() => setFileStatus(option.value)}>{option.label}</button>)}</div>

            {fileStatus === 'ACTIVE' ? <div className={`m-3 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${dragging ? 'border-vna-blue bg-cyan-50' : 'border-slate-200 bg-slate-50/40'}`} onDragEnter={(event) => { event.preventDefault(); if (allowChanges) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (allowChanges) chooseFiles(event.dataTransfer.files); }}>
              <CpmsIcon name="upload" className="mx-auto text-vna-blue" /><p className="mt-2 text-sm font-semibold text-slate-800">Kéo thả một hoặc nhiều file vào {workspace.folders.find((folder) => folder.key === activeFolder)?.label}</p><p className="mt-1 text-xs text-slate-500">Giới hạn kích thước và định dạng được kiểm tra an toàn phía server.</p>
            </div> : null}

            {fileStatus === 'ACTIVE' && uploads.length ? <div className="border-y border-slate-100 bg-slate-50/60 px-4 py-3"><div className="space-y-2">{uploads.map((task) => <div key={task.id} className="grid items-center gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_120px_auto]"><span className="truncate font-medium text-slate-700" title={task.file.name}>{task.file.name}</span><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full transition-all ${task.status === 'ERROR' ? 'bg-rose-500' : task.status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-vna-blue'}`} style={{ width: `${task.progress}%` }} /></div><div className="flex items-center gap-2"><span className={task.status === 'ERROR' ? 'text-rose-700' : task.status === 'SUCCESS' ? 'text-emerald-700' : 'text-slate-500'}>{task.status === 'UPLOADING' ? `${task.progress}%` : task.status === 'SUCCESS' ? 'Hoàn tất' : task.status === 'CANCELLED' ? 'Đã hủy' : task.error}</span>{task.status === 'UPLOADING' ? <button type="button" className="font-semibold text-slate-600 hover:text-rose-700" onClick={task.cancel}>Hủy</button> : task.status === 'ERROR' || task.status === 'CANCELLED' ? <button type="button" className="font-semibold text-vna-blue" onClick={() => beginUpload(task.file, task.id)}>Thử lại</button> : null}</div></div>)}</div></div> : null}

            {fileError ? <ErrorBlock message={fileError} onRetry={() => void loadFiles(false)} /> : loadingFiles && !files.length ? <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-slate-600"><span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" />Đang tải danh sách file…</div> : !files.length ? <div className="px-5 py-10 text-center"><CpmsIcon name={fileStatus === 'TRASHED' ? 'delete' : 'file'} className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-700">{fileStatus === 'TRASHED' ? 'Thùng rác của thư mục này đang trống.' : 'Folder này chưa có file.'}</p></div> : <FileTable files={files} status={fileStatus} pendingFileId={pendingFileId} onRename={renameFile} onTrash={trashFile} onRestore={restoreFile} />}
            {nextPageToken ? <div className="border-t border-slate-100 px-4 py-3 text-center"><Button size="sm" variant="secondary" disabled={loadingFiles} onClick={() => void loadFiles(true)}>{loadingFiles ? 'Đang tải…' : 'Tải thêm'}</Button></div> : null}
          </div>
        ) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center"><CpmsIcon name="folder" className="mx-auto text-slate-400" size={28} /><p className="mt-3 font-semibold text-slate-800">Chưa có thư mục Google Drive.</p><p className="mt-1 text-sm text-slate-500">Sau khi quản trị viên kết nối Google Drive dùng chung, chọn “Kiểm tra/đồng bộ” để tạo workspace.</p></div>}
      </div>
    </Card>
  );
}

function DriveHeader() {
  return <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name="folder" /></span><div><h2 className="font-semibold text-slate-950">Tài liệu Google Drive</h2><p className="mt-1 text-xs leading-5 text-slate-500">Quản lý ba thư mục tài liệu của Chiến dịch ngay trong CPMS.</p></div></div>;
}

function Notice({ tone, text, action }: { tone: 'warning' | 'error'; text: string; action?: ReactNode }) {
  return <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><span className="flex min-w-0 items-start gap-2"><CpmsIcon name={tone === 'error' ? 'error' : 'warning'} className="mt-0.5 shrink-0" /><span>{text}</span></span>{action}</div>;
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className="px-5 py-8 text-center"><CpmsIcon name="error" className="mx-auto text-rose-600" size={26} /><p className="mt-3 text-sm font-semibold text-rose-800">{message}</p><Button size="sm" variant="secondary" className="mt-4 gap-2" onClick={onRetry}><CpmsIcon name="refresh" />Thử lại</Button></div>;
}

function FileTable({ files, status, pendingFileId, onRename, onTrash, onRestore }: { files: CampaignDriveFileItem[]; status: CampaignDriveFileStatus; pendingFileId: string | null; onRename(file: CampaignDriveFileItem): void; onTrash(file: CampaignDriveFileItem): void; onRestore(file: CampaignDriveFileItem): void }) {
  const trashed = status === 'TRASHED';
  return <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Tên file</th>{trashed ? <><th className="px-4 py-3">Thư mục gốc</th><th className="px-4 py-3">Người xóa tạm</th><th className="px-4 py-3">Thời gian xóa</th></> : <><th className="px-4 py-3">Dung lượng</th><th className="px-4 py-3">Người cập nhật</th><th className="px-4 py-3">Cập nhật</th></>}<th className="px-4 py-3 text-right">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">{files.map((file) => {
    const pending = pendingFileId === file.id;
    const capabilityTitle = trashed ? 'Tài khoản Google hiện tại không có quyền phục hồi file này.' : 'Tài khoản Google hiện tại không có quyền đưa file này vào Thùng rác.';
    return <tr key={file.id} className="hover:bg-cyan-50/50"><td className="max-w-[360px] px-4 py-3"><span className="flex items-center gap-2"><CpmsIcon name="file" className="shrink-0 text-slate-400" /><span className="truncate font-semibold text-slate-800" title={file.name}>{file.name}</span></span><span className="mt-1 block truncate pl-6 text-xs text-slate-400" title={file.mimeType}>{file.mimeType}</span></td>{trashed ? <><td className="whitespace-nowrap px-4 py-3 text-slate-600">{file.folderLabel}</td><td className="max-w-[180px] truncate px-4 py-3 text-slate-600" title={file.trashedBy ?? ''}>{file.trashedBy ?? '—'}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(file.trashedAt)}</td></> : <><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBytes(file.size)}</td><td className="max-w-[180px] truncate px-4 py-3 text-slate-600" title={file.lastModifiedBy ?? ''}>{file.lastModifiedBy ?? '—'}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(file.modifiedTime)}</td></>}<td className="px-4 py-3"><div className="flex justify-end gap-1">{file.webViewLink || file.webContentLink ? <a className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-vna-blue hover:bg-cyan-50 ${pending ? 'pointer-events-none opacity-50' : ''}`} href={file.webViewLink ?? file.webContentLink ?? undefined} target="_blank" rel="noreferrer"><CpmsIcon name="externalLink" size={16} />Mở</a> : null}{!trashed && file.canEdit ? <button type="button" disabled={pending} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50" onClick={() => onRename(file)}><CpmsIcon name="edit" size={16} />Đổi tên</button> : null}{trashed ? <button type="button" disabled={pending || !file.canUntrash} title={!file.canUntrash ? capabilityTitle : undefined} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-vna-blue hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => onRestore(file)}><CpmsIcon name="restore" size={16} />{pending ? 'Đang phục hồi…' : 'Phục hồi'}</button> : <button type="button" disabled={pending || !file.canTrash} title={!file.canTrash ? capabilityTitle : undefined} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45" onClick={() => onTrash(file)}><CpmsIcon name="delete" size={16} />{pending ? 'Đang xử lý…' : 'Thùng rác'}</button>}</div></td></tr>;
  })}</tbody></table></div>;
}
