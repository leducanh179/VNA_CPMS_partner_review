import type {
  CampaignDriveEntryItem,
  CampaignDriveFileStatus,
  CampaignDriveFolderPage,
  CampaignDriveShortcutTargetStatus,
  CampaignDriveRelinkRequestView,
  CampaignDriveSyncStatus,
  CampaignDriveWorkspaceView,
  CampaignSummary,
} from '@cpms/domain';
import { Button, Card, CpmsIcon, StatusBadge } from '@cpms/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addCampaignDriveFolderPermission,
  browseCampaignDriveFolder,
  createCampaignDriveFolder,
  decideCampaignDriveRelink,
  downloadCampaignDriveEntries,
  ensureCampaignDriveWorkspace,
  getCampaignDriveWorkspace,
  getCampaignDriveShortcutTargetStatus,
  getCampaignDriveFolderSharing,
  getCampaignDriveUploadStatus,
  listCampaignDriveRelinks,
  previewCampaignDriveRelink,
  renameCampaignDriveEntry,
  removeCampaignDriveFolderPermission,
  requestCampaignDriveRelink,
  restoreCampaignDriveEntry,
  setCampaignDriveGeneralAccess,
  retryCampaignDriveRelink,
  syncCampaignDriveWorkspaceName,
  trashCampaignDriveEntry,
  uploadCampaignDriveFile,
  CampaignDriveUploadError,
  updateCampaignDriveFolderPermission,
  withdrawCampaignDriveRelink,
  type CampaignDriveFolderSharing,
  type CampaignDriveRelinkPreview,
} from '../lib/api';
import { treeFromDrop, treeFromFolderSelection, type UploadTree } from './campaign-drive-upload-tree';

interface Props { campaign: CampaignSummary | undefined; notify(message: string): void }
interface UploadTask { id: string; folderId: string; file: File; progress: number; status: 'QUEUED' | 'UPLOADING' | 'VERIFYING' | 'SUCCESS' | 'ERROR' | 'UNKNOWN'; error: string | null; cancel?: (() => void) | undefined }

const STATUS_LABELS: Record<CampaignDriveSyncStatus, string> = {
  NOT_CREATED: 'Chưa tạo', CREATING: 'Đang tạo', READY: 'Đã sẵn sàng', NEEDS_SYNC: 'Cần đồng bộ',
  CONFLICT: 'Xung đột', PERMISSION_SETUP_REQUIRED: 'Cần cấp quyền', OUT_OF_SYNC: 'Chưa đồng bộ', ERROR: 'Lỗi Google Drive',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatBytes(value: number | null) {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

const PUBLIC_ROLE_RANK: Record<string, number> = { reader: 1, commenter: 2, writer: 3 };
function publicAccess(sharing: CampaignDriveFolderSharing): { access: 'RESTRICTED' | 'ANYONE'; role: 'reader' | 'commenter' | 'writer'; inheritedRank: number } {
  const publicPermissions = sharing.permissions.filter((permission) => permission.type === 'anyone');
  const inheritedRank = sharing.limitedAccess ? 0 : Math.max(0, ...publicPermissions.map((permission) => PUBLIC_ROLE_RANK[permission.inheritedRole ?? ''] ?? 0));
  const effectiveRank = Math.max(inheritedRank, ...publicPermissions.map((permission) => PUBLIC_ROLE_RANK[permission.directRole ?? (permission.inherited ? '' : permission.role)] ?? 0));
  return { access: effectiveRank ? 'ANYONE' : 'RESTRICTED', role: effectiveRank === 3 ? 'writer' : effectiveRank === 2 ? 'commenter' : 'reader', inheritedRank };
}

export function CampaignDriveWorkspaceCard({ campaign, notify }: Props) {
  const [workspace, setWorkspace] = useState<CampaignDriveWorkspaceView | null>(null);
  const [history, setHistory] = useState<CampaignDriveRelinkRequestView[]>([]);
  const [canRequest, setCanRequest] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [actorId, setActorId] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [page, setPage] = useState<CampaignDriveFolderPage | null>(null);
  const [status, setStatus] = useState<CampaignDriveFileStatus>('ACTIVE');
  const [sortBy, setSortBy] = useState<'NAME' | 'UPDATED' | 'SIZE'>('NAME');
  const [direction, setDirection] = useState<'ASC' | 'DESC'>('ASC');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [shortcutStatuses, setShortcutStatuses] = useState<Record<string, CampaignDriveShortcutTargetStatus>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entryId: string | null } | null>(null);
  const [sharing, setSharing] = useState<CampaignDriveFolderSharing | null>(null);
  const [sharingFolderId, setSharingFolderId] = useState<string | null>(null);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingEmail, setSharingEmail] = useState('');
  const [sharingRole, setSharingRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [generalAccess, setGeneralAccess] = useState<'RESTRICTED' | 'ANYONE'>('RESTRICTED');
  const [generalRole, setGeneralRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [loading, setLoading] = useState(Boolean(campaign));
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [showRelinkForm, setShowRelinkForm] = useState(false);
  const [relinkUrl, setRelinkUrl] = useState('');
  const [preview, setPreview] = useState<CampaignDriveRelinkPreview | null>(null);
  const [relinkReason, setRelinkReason] = useState('');
  const [confirmRename, setConfirmRename] = useState(false);
  const [decisionReason, setDecisionReason] = useState('');
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [folderBatchStatus, setFolderBatchStatus] = useState<string | null>(null);
  const [folderBatchBusy, setFolderBatchBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const selectionAnchor = useRef<number | null>(null);
  const dragStart = useRef<number | null>(null);
  const dragBase = useRef<string[]>([]);

  const loadWorkspace = useCallback(async () => {
    if (!campaign) return;
    setLoading(true);
    setError(null);
    try {
      const [nextWorkspace, relinks] = await Promise.all([getCampaignDriveWorkspace(campaign.id), listCampaignDriveRelinks(campaign.id)]);
      setWorkspace(nextWorkspace);
      setHistory(relinks.requests);
      setCanRequest(relinks.canRequest);
      setCanDecide(relinks.canDecide);
      setActorId(relinks.actorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải Google Drive của Chiến dịch.');
    } finally { setLoading(false); }
  }, [campaign?.id]);

  const loadFolder = useCallback(async (nextToken?: string) => {
    if (!campaign) return;
    setLoadingFolder(true);
    setFolderError(null);
    if (!nextToken) setShortcutStatuses({});
    try {
      const result = await browseCampaignDriveFolder(campaign.id, folderId, status, nextToken, sortBy, direction);
      setPage((previous) => nextToken && previous ? { ...result, items: [...previous.items, ...result.items] } : result);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : 'Không thể tải nội dung thư mục.');
      if (!nextToken) setPage(null);
    } finally { setLoadingFolder(false); }
  }, [campaign?.id, folderId, status, sortBy, direction]);

  useEffect(() => { setWorkspace(null); setFolderId(null); setPage(null); setUploads([]); setSharing(null); setSharingFolderId(null); void loadWorkspace(); }, [campaign?.id, loadWorkspace]);
  useEffect(() => {
    setPage(null);
    if (workspace?.campaignFolderId && ['READY', 'NEEDS_SYNC'].includes(workspace.syncStatus)) void loadFolder();
  }, [loadFolder, workspace?.campaignFolderId, workspace?.syncStatus]);
  useEffect(() => { setFolderId(null); setPage(null); }, [workspace?.campaignFolderId]);
  useEffect(() => { setSelectedIds([]); selectionAnchor.current = null; dragStart.current = null; setContextMenu(null); }, [campaign?.id, folderId, status, sortBy, direction]);
  useEffect(() => { setShortcutStatuses({}); }, [campaign?.id, folderId]);
  useEffect(() => {
    if (!campaign || !page || status !== 'ACTIVE') return;
    let cancelled = false;
    // Check only actual shortcuts, sequentially, without delaying the folder list or flooding Google.
    void (async () => {
      for (const entry of page.items) {
        if (cancelled) break;
        if (!entry.isShortcut || shortcutStatuses[entry.id]) continue;
        try {
          const result = await getCampaignDriveShortcutTargetStatus(campaign.id, entry.id);
          if (!cancelled) setShortcutStatuses((current) => ({ ...current, [entry.id]: result.status }));
        } catch { /* Keep the shortcut usable; a transient status-check failure is not proof the target is gone. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [campaign?.id, page, status]);
  useEffect(() => {
    const finishDrag = () => { dragStart.current = null; };
    window.addEventListener('mouseup', finishDrag);
    return () => window.removeEventListener('mouseup', finishDrag);
  }, []);

  const changeSort = (column: 'NAME' | 'UPDATED' | 'SIZE', requestedDirection?: 'ASC' | 'DESC') => {
    setDirection(requestedDirection ?? (sortBy === column && direction === 'ASC' ? 'DESC' : 'ASC'));
    setSortBy(column);
    setContextMenu(null);
  };

  const selectEntry = (index: number, additive: boolean, range: boolean) => {
    const items = page?.items ?? [];
    const entry = items[index];
    if (!entry) return;
    if (range && selectionAnchor.current !== null) {
      const from = Math.min(selectionAnchor.current, index);
      const to = Math.max(selectionAnchor.current, index);
      setSelectedIds((old) => [...new Set([...(additive ? old : []), ...items.slice(from, to + 1).map((item) => item.id)])]);
    } else {
      setSelectedIds((old) => additive ? old.includes(entry.id) ? old.filter((id) => id !== entry.id) : [...old, entry.id] : [entry.id]);
      selectionAnchor.current = index;
    }
  };

  const downloadSelection = async (ids: string[]) => {
    if (!campaign || !page || !ids.length || busy) return;
    if (page.items.some((entry) => ids.includes(entry.id) && entry.isShortcut)) { setFolderError('Không thể tải lối tắt. Hãy mở mục gốc trên Google Drive.'); return; }
    if (ids.length > 25) { setFolderError('Mỗi lượt tải tối đa 25 mục đã chọn.'); return; }
    setBusy(true); setFolderError(null); setContextMenu(null);
    try {
      const result = await downloadCampaignDriveEntries(campaign.id, page.folder.id, ids);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      notify(ids.length === 1 ? 'Đã chuẩn bị tệp tải xuống.' : 'Đã chuẩn bị gói ZIP tải xuống.');
    } catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Không thể tải xuống.'); }
    finally { setBusy(false); }
  };

  const trashSelection = async (ids: string[]) => {
    if (!campaign || !ids.length || busy) return;
    const shortcutCount = page?.items.filter((entry) => ids.includes(entry.id) && entry.isShortcut).length ?? 0;
    const confirmation = shortcutCount === ids.length
      ? `Đưa ${shortcutCount} lối tắt vào Thùng rác Google Drive? Mục gốc không bị xóa.`
      : `Đưa ${ids.length} mục đã chọn cùng nội dung trong các thư mục vào Thùng rác Google Drive?${shortcutCount ? ' Các mục gốc của lối tắt không bị xóa.' : ''}`;
    if (!window.confirm(confirmation)) return;
    setBusy(true); setFolderError(null); setContextMenu(null);
    let completed = 0;
    try {
      for (const id of ids) { await trashCampaignDriveEntry(campaign.id, id); completed += 1; }
      notify(`Đã đưa ${completed} mục vào Thùng rác.`);
    } catch (cause) {
      setFolderError(`Đã xử lý ${completed}/${ids.length} mục. ${cause instanceof Error ? cause.message : 'Các mục còn lại chưa được xử lý.'}`);
    } finally { setSelectedIds([]); await loadFolder(); setBusy(false); }
  };

  const runWorkspaceAction = async (syncName: boolean) => {
    if (!campaign || busy) return;
    setBusy(true); setError(null);
    try {
      const result = syncName ? await syncCampaignDriveWorkspaceName(campaign.id) : await ensureCampaignDriveWorkspace(campaign.id);
      setWorkspace(result);
      notify(syncName ? 'Đã cập nhật tên thư mục Google Drive.' : 'Đã kiểm tra thư mục Google Drive.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đồng bộ Google Drive.'); }
    finally { setBusy(false); }
  };

  const sendRelinkRequest = async () => {
    if (!campaign || !preview || !confirmRename || busy) return;
    setBusy(true); setError(null);
    try {
      await requestCampaignDriveRelink(campaign.id, preview, relinkReason.trim());
      setShowRelinkForm(false); setPreview(null); setRelinkUrl(''); setRelinkReason(''); setConfirmRename(false);
      await loadWorkspace();
      notify('Đã gửi yêu cầu thay đổi thư mục Google Drive để phê duyệt. Liên kết hiện tại chưa đổi.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể gửi yêu cầu đổi thư mục.'); }
    finally { setBusy(false); }
  };

  const decide = async (request: CampaignDriveRelinkRequestView, approve: boolean) => {
    if (!campaign || busy) return;
    if (!approve && !decisionReason.trim()) { setError('Hãy nhập lý do từ chối.'); return; }
    if (approve && !window.confirm('Phê duyệt đổi thư mục? CPMS sẽ đổi tên cả thư mục mới và thư mục cũ, rồi chuyển liên kết hiện tại.')) return;
    setBusy(true); setError(null);
    try {
      await decideCampaignDriveRelink(campaign.id, request.id, approve, decisionReason.trim(), request.recordVersion);
      setDecisionReason(''); await loadWorkspace(); setFolderId(null);
      notify(approve ? 'Đã duyệt và thay đổi thư mục Google Drive.' : 'Đã từ chối yêu cầu đổi thư mục.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xử lý yêu cầu. Hãy xem trạng thái và thử lại nếu cần.'); await loadWorkspace(); }
    finally { setBusy(false); }
  };

  const retry = async (request: CampaignDriveRelinkRequestView) => {
    if (!campaign || busy) return;
    setBusy(true); setError(null);
    try { await retryCampaignDriveRelink(campaign.id, request.id); await loadWorkspace(); setFolderId(null); notify('Đã hoàn tất đổi thư mục Google Drive.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể áp dụng lại.'); await loadWorkspace(); }
    finally { setBusy(false); }
  };

  const runEntryAction = async (entry: CampaignDriveEntryItem, action: 'RENAME' | 'TRASH' | 'RESTORE') => {
    if (!campaign || pendingItemId) return;
    const name = action === 'RENAME' ? window.prompt('Tên mới:', entry.name)?.trim() : null;
    if (action === 'RENAME' && (!name || name === entry.name)) return;
    if (action === 'TRASH' && !window.confirm(entry.isShortcut
      ? 'Xóa lối tắt này khỏi thư mục Chiến dịch? Chỉ lối tắt vào Thùng rác; mục gốc không bị xóa.'
      : entry.isFolder ? 'Đưa thư mục này cùng toàn bộ nội dung bên trong vào Thùng rác Google Drive?'
        : 'Đưa tệp này vào Thùng rác Google Drive?')) return;
    setPendingItemId(entry.id); setFolderError(null);
    try {
      if (action === 'RENAME') await renameCampaignDriveEntry(campaign.id, entry.id, name!);
      else if (action === 'TRASH') await trashCampaignDriveEntry(campaign.id, entry.id);
      else await restoreCampaignDriveEntry(campaign.id, entry.id);
      await loadFolder();
      notify(action === 'RENAME' ? 'Đã đổi tên.' : action === 'TRASH' ? entry.isShortcut ? 'Đã xóa lối tắt; mục gốc không thay đổi.' : 'Đã đưa vào Thùng rác.' : 'Đã phục hồi.');
    } catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Thao tác Google Drive không thành công.'); }
    finally { setPendingItemId(null); }
  };

  const addFolder = async () => {
    if (!campaign || !page || busy) return;
    const name = window.prompt('Tên thư mục mới:')?.trim();
    if (!name) return;
    setBusy(true); setFolderError(null);
    try { await createCampaignDriveFolder(campaign.id, page.folder.id, name); await loadFolder(); notify(`Đã tạo thư mục “${name}”.`); }
    catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Không thể tạo thư mục.'); }
    finally { setBusy(false); }
  };

  const openSharing = async (entry: CampaignDriveEntryItem) => {
    if (!campaign || !entry.isFolder || entry.isShortcut) return;
    setContextMenu(null); setSharingFolderId(entry.id); setSharing(null); setSharingError(null); setSharingEmail(''); setSharingLoading(true);
    try { const result = await getCampaignDriveFolderSharing(campaign.id, entry.id); setSharing(result); const current = publicAccess(result); setGeneralAccess(current.access); setGeneralRole(current.role); }
    catch (cause) { setSharingError(cause instanceof Error ? cause.message : 'Không tải được quyền chia sẻ.'); }
    finally { setSharingLoading(false); }
  };

  const addSharing = async (type: 'user' | 'anyone', role: 'reader' | 'commenter' | 'writer') => {
    if (!campaign || !sharingFolderId || sharingBusy) return;
    setSharingBusy(true); setSharingError(null);
    try {
      const next = await addCampaignDriveFolderPermission(campaign.id, sharingFolderId,
        { type, role, ...(type === 'user' ? { emailAddress: sharingEmail.trim() } : {}) });
      setSharing(next); setSharingEmail(''); notify('Đã cập nhật quyền chia sẻ trên Google Drive.');
    } catch (cause) { setSharingError(cause instanceof Error ? cause.message : 'Google Drive chưa cập nhật quyền.'); }
    finally { setSharingBusy(false); }
  };

  const changeSharing = async (permissionId: string, role: 'reader' | 'commenter' | 'writer' | null) => {
    if (!campaign || !sharingFolderId || sharingBusy) return;
    if (!role && !window.confirm('Gỡ quyền chia sẻ trực tiếp này khỏi thư mục?')) return;
    setSharingBusy(true); setSharingError(null);
    try {
      setSharing(role ? await updateCampaignDriveFolderPermission(campaign.id, sharingFolderId, permissionId, role)
        : await removeCampaignDriveFolderPermission(campaign.id, sharingFolderId, permissionId));
      notify('Đã cập nhật quyền chia sẻ trên Google Drive.');
    } catch (cause) { setSharingError(cause instanceof Error ? cause.message : 'Google Drive chưa cập nhật quyền.'); }
    finally { setSharingBusy(false); }
  };

  const saveGeneralAccess = async () => {
    if (!campaign || !sharingFolderId || !sharing || sharingBusy) return;
    const current = publicAccess(sharing);
    const needsLimit = !sharing.limitedAccess && current.inheritedRank > (generalAccess === 'RESTRICTED' ? 0 : PUBLIC_ROLE_RANK[generalRole] ?? 0);
    if (needsLimit && !sharing.canLimitAccess) {
      setSharingError('Quyền link đang kế thừa từ thư mục cha. Cần quyền Manager của Shared Drive để giới hạn quyền riêng cho thư mục này.'); return;
    }
    if (needsLimit && !window.confirm('Giới hạn quyền kế thừa cho riêng thư mục này? Những người đang có quyền nhờ thư mục cha có thể không mở được thư mục này.')) return;
    setSharingBusy(true); setSharingError(null);
    try {
      const next = await setCampaignDriveGeneralAccess(campaign.id, sharingFolderId, generalAccess, generalRole, needsLimit);
      setSharing(next); const effective = publicAccess(next); setGeneralAccess(effective.access); setGeneralRole(effective.role);
      notify('Đã cập nhật quyền truy cập chung trên Google Drive.');
    } catch (cause) {
      setSharingError(cause instanceof Error ? cause.message : 'Google Drive chưa cập nhật quyền truy cập chung.');
      try { const actual = await getCampaignDriveFolderSharing(campaign.id, sharingFolderId); setSharing(actual); const effective = publicAccess(actual); setGeneralAccess(effective.access); setGeneralRole(effective.role); } catch { /* Keep the reported error. */ }
    } finally { setSharingBusy(false); }
  };

  const verifyUpload = async (destination: string, uploadId: string) => {
    if (!campaign) return false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await getCampaignDriveUploadStatus(campaign.id, destination, uploadId);
        if (result.completed) return true;
      } catch { /* A failed status check does not prove the Google upload failed. */ }
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    return false;
  };

  const uploadOne = async (file: File, destination: string, id: string): Promise<boolean> => {
    if (!campaign) return false;
    setUploads((items) => items.map((item) => item.id === id ? { ...item, status: 'UPLOADING', progress: 0, error: null } : item));
    const operation = uploadCampaignDriveFile(campaign.id, destination, file, (progress) => setUploads((items) =>
      items.map((item) => item.id === id ? { ...item, progress: Math.min(progress, 99), status: progress >= 100 ? 'VERIFYING' : 'UPLOADING' } : item)), id);
    setUploads((items) => items.map((item) => item.id === id ? { ...item, cancel: operation.cancel } : item));
    try {
      await operation.promise;
      setUploads((items) => items.map((item) => item.id === id ? { ...item, progress: 100, status: 'SUCCESS', error: null, cancel: undefined } : item));
      if (page?.folder.id === destination) void loadFolder();
      return true;
    } catch (cause) {
      const uncertain = cause instanceof DOMException && cause.name === 'AbortError' || cause instanceof CampaignDriveUploadError && cause.uncertain;
      if (uncertain) {
        setUploads((items) => items.map((item) => item.id === id ? { ...item, status: 'VERIFYING', cancel: undefined } : item));
        if (await verifyUpload(destination, id)) {
          setUploads((items) => items.map((item) => item.id === id ? { ...item, progress: 100, status: 'SUCCESS', error: null } : item));
          if (page?.folder.id === destination) void loadFolder();
          return true;
        }
      }
      setUploads((items) => items.map((item) => item.id === id ? { ...item, status: uncertain ? 'UNKNOWN' : 'ERROR',
        error: uncertain ? 'Chưa xác định kết quả trên Google Drive. Kiểm tra trạng thái trước khi tải lại.'
          : cause instanceof Error ? cause.message : 'Không thể tải tệp.', cancel: undefined } : item));
      return false;
    }
  };

  const beginUpload = (file: File, id: string = crypto.randomUUID()) => {
    if (!campaign || !page || !workspace?.capabilities?.upload || campaign.isDeleted) return;
    const destination = page.folder.id;
    setUploads((items) => [...items.filter((item) => item.id !== id), { id, folderId: destination, file, progress: 0, status: 'QUEUED', error: null }]);
    const next = uploadQueue.current.then(() => uploadOne(file, destination, id));
    uploadQueue.current = next.then(() => undefined, () => undefined);
  };

  const uploadTree = (tree: UploadTree) => {
    if (!campaign || !page || !workspace?.capabilities?.upload || campaign.isDeleted || workspace.providerWritesEnabled === false || folderBatchBusy) return;
    const destination = page.folder.id;
    setFolderBatchBusy(true);
    setFolderBatchStatus(`Đang chuẩn bị ${tree.directories.length} thư mục và ${tree.files.length} tệp…`);
    const next = uploadQueue.current.then(async () => {
      const folderIds = new Map<string, string>();
      let created = 0; let uploaded = 0;
      try {
        for (const path of tree.directories) {
          const parts = path.split('/');
          const parentPath = parts.slice(0, -1).join('/');
          const parentId = parentPath ? folderIds.get(parentPath) : destination;
          if (!parentId) throw new Error(`Không tìm thấy thư mục cha của “${path}”.`);
          setFolderBatchStatus(`Đang tạo thư mục ${created + 1}/${tree.directories.length}: ${path}`);
          const folder = await createCampaignDriveFolder(campaign.id, parentId, parts.at(-1)!);
          folderIds.set(path, folder.id); created += 1;
        }
        for (const { path, file } of tree.files) {
          const parentPath = path.split('/').slice(0, -1).join('/');
          const folderId = parentPath ? folderIds.get(parentPath) : destination;
          if (!folderId) throw new Error(`Không tìm thấy thư mục chứa “${path}”.`);
          setFolderBatchStatus(`Đang tải tệp ${uploaded + 1}/${tree.files.length}: ${path}`);
          const id = crypto.randomUUID();
          setUploads((items) => [...items, { id, folderId, file, progress: 0, status: 'QUEUED', error: null }]);
          if (!await uploadOne(file, folderId, id)) throw new Error(`Tệp “${path}” chưa hoàn tất. Kiểm tra trạng thái trước khi tải lại.`);
          uploaded += 1;
        }
        setFolderBatchStatus(`Hoàn tất: ${created} thư mục, ${uploaded} tệp.`);
        await loadFolder();
      } catch (cause) {
        setFolderBatchStatus(`Đã tạo ${created}/${tree.directories.length} thư mục và tải ${uploaded}/${tree.files.length} tệp. ${cause instanceof Error ? cause.message : 'Quá trình bị gián đoạn.'} Không tự chạy lại toàn bộ để tránh tạo mục trùng.`);
        await loadFolder();
      } finally { setFolderBatchBusy(false); }
    });
    uploadQueue.current = next.then(() => undefined, () => undefined);
  };

  if (!campaign) return <Card className="overflow-hidden"><DriveHeader /><div className="px-5 py-8 text-center"><CpmsIcon name="folder" className="mx-auto text-slate-400" size={30} /><p className="mt-3 font-semibold">Hãy lưu Chiến dịch trước để tạo thư mục Google Drive.</p></div></Card>;
  if (loading && !workspace) return <Card className="overflow-hidden"><DriveHeader /><p className="p-5 text-sm">Đang tải Google Drive…</p></Card>;
  if (!workspace) return <Card className="overflow-hidden"><DriveHeader /><p className="p-5 text-sm text-rose-700">{error ?? 'Không thể tải Google Drive.'} <button type="button" className="font-semibold underline" onClick={() => void loadWorkspace()}>Thử lại</button></p></Card>;
  if (!workspace.canViewDriveWorkspace) return null;

  const ready = Boolean(workspace.campaignFolderId && ['READY', 'NEEDS_SYNC'].includes(workspace.syncStatus));
  const canChange = !campaign.isDeleted && workspace.providerWritesEnabled !== false;
  const openRequest = history.find((item) => ['PENDING', 'APPLYING', 'FAILED'].includes(item.status));
  const selectedEntries = page?.items.filter((entry) => selectedIds.includes(entry.id)) ?? [];
  const selectedHasShortcut = selectedEntries.some((entry) => entry.isShortcut);
  const canTrashSelected = canChange && selectedEntries.length > 0 && selectedEntries.every((entry) => entry.canTrash);
  const contextEntry = page?.items.find((entry) => entry.id === contextMenu?.entryId);
  const openEntry = (entry: CampaignDriveEntryItem) => {
    setContextMenu(null);
    if (entry.isFolder && status === 'ACTIVE') { setFolderId(entry.id); setStatus('ACTIVE'); return; }
    if (!entry.isFolder) window.open(entry.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(entry.id)}`, '_blank', 'noopener,noreferrer');
  };

  return <Card className="overflow-hidden">
    <DriveHeader />
    <div className="space-y-5 px-5 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><StatusBadge>{STATUS_LABELS[workspace.syncStatus]}</StatusBadge><span className="text-xs text-slate-500">{workspace.accessMode}</span></div>
          <p className="mt-2 font-semibold text-slate-900">{workspace.campaignFolderName ?? workspace.expectedFolderName}</p>
          <p className="mt-1 text-xs text-slate-500">Đồng bộ gần nhất: {formatDate(workspace.lastCheckedAt)}{workspace.googleAccountEmail ? ` · ${workspace.googleAccountEmail}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace.campaignFolderLink && <a href={workspace.campaignFolderLink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-vna-blue"><CpmsIcon name="externalLink" />Mở trên Google Drive</a>}
          <Button size="sm" variant="secondary" disabled={busy || !canChange || !workspace.capabilities?.ensure} onClick={() => void runWorkspaceAction(false)}><CpmsIcon name="refresh" />Kiểm tra/đồng bộ</Button>
          {canRequest && ready && <Button size="sm" variant="secondary" disabled={busy || !canChange || Boolean(openRequest)} onClick={() => setShowRelinkForm((value) => !value)}><CpmsIcon name={showRelinkForm ? 'windowClose' : 'edit'} />{showRelinkForm ? 'Đóng thay đổi Thư mục' : 'Thay đổi Thư mục Google Drive'}</Button>}
        </div>
      </div>

      {workspace.needsReconsent || !workspace.googleConnected ? <Notice text="Tài khoản Google dùng chung chưa kết nối hoặc cần cấp lại quyền. Quản trị viên thiết lập trong Quản trị hệ thống → Google Drive." /> : null}
      {workspace.nameMismatch && <Notice text={`Tên thư mục hiện tại chưa khớp. Tên đề xuất: “${workspace.expectedFolderName}”.`} action={<Button size="sm" variant="secondary" disabled={!canChange || !workspace.capabilities?.rename || busy} onClick={() => void runWorkspaceAction(true)}>Cập nhật tên thư mục</Button>} />}
      {workspace.lastErrorMessage && <Notice text={workspace.lastErrorMessage} />}
      {error && <Notice text={error} />}
      {campaign.isDeleted && <Notice text="Chiến dịch đang ở Thùng rác. Hãy khôi phục trước khi quản lý thư mục." />}

      {showRelinkForm && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Yêu cầu thay đổi Thư mục Google Drive</h3><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setShowRelinkForm(false); setError(null); }}><CpmsIcon name="windowClose" />Đóng</Button></div>
        <p>Liên kết chỉ thay đổi sau khi Lãnh đạo Phòng phụ trách hoặc superadmin phê duyệt. Thư mục mới phải nằm trong DATABASE_CAMPAIGNS và không thuộc Chiến dịch khác.</p>
        <div className="flex flex-wrap gap-2"><input aria-label="Link thư mục Google Drive mới" type="url" value={relinkUrl} onChange={(event) => { setRelinkUrl(event.target.value); setPreview(null); setConfirmRename(false); }} placeholder="https://drive.google.com/drive/folders/…" className="min-w-64 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2" />
          <Button size="sm" variant="secondary" disabled={!relinkUrl.trim() || busy} onClick={() => { if (!campaign) return; setBusy(true); setError(null); void previewCampaignDriveRelink(campaign.id, relinkUrl).then(setPreview).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Link không hợp lệ.')).finally(() => setBusy(false)); }}>Kiểm tra link</Button></div>
        {preview && <div className="space-y-2 rounded-lg bg-white p-3">
          <p>Thư mục mới: <strong>{preview.currentName}</strong></p>
          <p>Sau khi duyệt, tên sẽ là: <strong>{preview.expectedName}</strong>.</p>
          <p>Thư mục cũ được giữ lại, thêm “[Hết hiệu lực]” trước tên và lưu link trong lịch sử.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmRename} onChange={(event) => setConfirmRename(event.target.checked)} className="mt-1" />Tôi đồng ý để CPMS đổi tên thư mục mới theo mã và tên Chiến dịch khi được phê duyệt.</label>
          <label className="block">Lý do thay đổi<textarea value={relinkReason} onChange={(event) => setRelinkReason(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
          <Button size="sm" disabled={busy || !confirmRename || !relinkReason.trim()} onClick={() => void sendRelinkRequest()}><CpmsIcon name="approve" />Gửi yêu cầu phê duyệt</Button>
        </div>}
      </div>}

      {openRequest && <div className="space-y-2 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm">
        <p className="font-semibold">Yêu cầu đổi thư mục: {openRequest.status === 'PENDING' ? 'Chờ phê duyệt' : openRequest.status === 'APPLYING' ? 'Đang áp dụng' : 'Áp dụng lỗi'}</p>
        <p><a href={openRequest.targetFolderLink} target="_blank" rel="noreferrer" className="font-semibold text-vna-blue underline">{openRequest.targetFolderName}</a> → {openRequest.expectedFolderName}</p>
        <p>Lý do: {openRequest.reason}</p>
        {openRequest.lastError && <p className="text-rose-700">{openRequest.lastError}</p>}
        {canDecide && openRequest.status === 'PENDING' && <><textarea aria-label="Ý kiến phê duyệt thư mục" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} maxLength={2000} rows={2} placeholder="Ý kiến xử lý (bắt buộc nếu từ chối)" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2" /><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void decide(openRequest, true)}><CpmsIcon name="approve" />Phê duyệt</Button><Button size="sm" variant="secondary" disabled={busy || !decisionReason.trim()} onClick={() => void decide(openRequest, false)}>Từ chối</Button></div></>}
        {canDecide && (openRequest.status === 'FAILED' || openRequest.status === 'APPLYING' && openRequest.decidedAt && Date.now() - new Date(openRequest.decidedAt).getTime() > 15 * 60_000) && <Button size="sm" disabled={busy} onClick={() => void retry(openRequest)}><CpmsIcon name="refresh" />Thử lại áp dụng</Button>}
        {openRequest.requestedByActorId === actorId && ['PENDING', 'FAILED'].includes(openRequest.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (!campaign) return; setBusy(true); setError(null); void withdrawCampaignDriveRelink(campaign.id, openRequest.id).then(() => loadWorkspace()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Không thể rút yêu cầu.')).finally(() => setBusy(false)); }}>Rút yêu cầu</Button>}
      </div>}

      {history.length > 0 && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">Lịch sử liên kết thư mục Google Drive ({history.length})</summary>
        <div className="mt-3 space-y-3">{history.map((item) => <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{item.status === 'APPLIED' ? 'Đã thay đổi' : item.status === 'REJECTED' ? 'Đã từ chối' : item.status === 'WITHDRAWN' ? 'Đã rút' : item.status === 'FAILED' ? 'Áp dụng lỗi' : item.status === 'APPLYING' ? 'Đang áp dụng' : 'Chờ duyệt'} · {formatDate(item.appliedAt ?? item.requestedAt)}</p>
          <p className="mt-1">Cũ: <a href={item.sourceFolderLink} target="_blank" rel="noreferrer" className="text-vna-blue underline">{item.sourceFolderName}</a></p>
          <p>Mới: <a href={item.targetFolderLink} target="_blank" rel="noreferrer" className="text-vna-blue underline">{item.expectedFolderName}</a></p>
          <p>Lý do: {item.reason}</p><p className="text-xs text-slate-500">Người gửi: {item.requestedByActorId} · Người duyệt: {item.decidedByActorId ?? '—'}</p>
        </div>)}</div></details>}

      {ready ? <div className="overflow-hidden rounded-xl border border-slate-200" onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('button,a,input,select,textarea,[role="menu"],tr')) return;
        event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, entryId: null });
      }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-3">
          <nav aria-label="Đường dẫn thư mục Google Drive" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">{page?.breadcrumbs.map((crumb, index) => <span key={crumb.id} className="flex items-center gap-1">{index > 0 && <span className="text-slate-400">/</span>}<button type="button" className={`max-w-64 truncate rounded px-1 py-1 hover:bg-cyan-50 ${index === page.breadcrumbs.length - 1 ? 'font-semibold text-slate-900' : 'text-vna-blue'}`} onClick={() => { setFolderId(crumb.id); setStatus('ACTIVE'); }}>{crumb.name}</button></span>) ?? <span className="font-semibold">{workspace.expectedFolderName}</span>}</nav>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={loadingFolder} onClick={() => void loadFolder()}><CpmsIcon name="refresh" />Làm mới</Button>
            <Button size="sm" variant="secondary" disabled={!page || !canChange || !workspace.capabilities?.ensure || busy} onClick={() => void addFolder()}><CpmsIcon name="add" />Tạo thư mục</Button>
            <Button size="sm" disabled={!page || !canChange || !workspace.capabilities?.upload} onClick={() => fileInput.current?.click()}><CpmsIcon name="upload" />Tải tệp lên</Button>
            <Button size="sm" variant="secondary" disabled={!page || !canChange || !workspace.capabilities?.upload || folderBatchBusy} onClick={() => folderInput.current?.click()}><CpmsIcon name="folder" />Tải thư mục lên</Button>
            <input ref={fileInput} className="sr-only" type="file" multiple onChange={(event) => { [...(event.target.files ?? [])].forEach((file) => beginUpload(file)); event.target.value = ''; }} />
            <input ref={(element) => { folderInput.current = element; element?.setAttribute('webkitdirectory', ''); }} className="sr-only" type="file" multiple onChange={(event) => {
              try { uploadTree(treeFromFolderSelection([...(event.target.files ?? [])])); }
              catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Không thể đọc cấu trúc thư mục.'); }
              event.target.value = '';
            }} /></div>
        </div>
        <div className="flex gap-1 border-b border-slate-100 p-2 text-sm">{([{ value: 'ACTIVE', label: 'Đang sử dụng' }, { value: 'TRASHED', label: 'Thùng rác' }] as const).map((option) => <button key={option.value} type="button" className={`rounded-lg px-3 py-2 ${status === option.value ? 'bg-vna-blue font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
        {status === 'ACTIVE' && <div className={`m-3 rounded-xl border-2 border-dashed p-4 text-center text-sm ${dragging ? 'border-vna-blue bg-cyan-50' : 'border-slate-200'}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => {
          event.preventDefault(); setDragging(false);
          if (canChange) void treeFromDrop(event.dataTransfer.items).then((tree) => tree.directories.length ? uploadTree(tree) : tree.files.forEach(({ file }) => beginUpload(file)))
            .catch((cause: unknown) => setFolderError(cause instanceof Error ? cause.message : 'Không thể đọc tệp hoặc thư mục được thả.'));
        }}>Kéo thả tệp hoặc nhiều thư mục con vào thư mục đang mở để tải lên</div>}
        {folderBatchStatus && <p role="status" className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600">{folderBatchStatus}</p>}
        {uploads.length > 0 && <div className="space-y-1 border-b border-slate-100 px-4 py-2 text-xs">{uploads.map((task) => <div key={task.id} className="flex flex-wrap items-center gap-2"><span>{task.file.name}</span><span>{task.status === 'QUEUED' ? 'Đang chờ' : task.status === 'UPLOADING' ? `${task.progress}%` : task.status === 'VERIFYING' ? 'Đang xác nhận trên Google Drive…' : task.status === 'SUCCESS' ? 'Hoàn tất' : task.error}</span>{task.cancel && <button type="button" className="text-rose-700 underline" onClick={task.cancel}>Ngừng chờ</button>}{task.status === 'ERROR' && <button type="button" className="text-vna-blue underline" onClick={() => beginUpload(task.file, task.id)}>Thử lại</button>}{task.status === 'UNKNOWN' && <button type="button" className="text-vna-blue underline" onClick={() => { void verifyUpload(task.folderId, task.id).then((found) => { if (found) { setUploads((items) => items.map((item) => item.id === task.id ? { ...item, status: 'SUCCESS', error: null, progress: 100 } : item)); void loadFolder(); } else setFolderError('Google Drive chưa xác nhận lượt tải này. Hãy kiểm tra thư mục trước khi chọn tải lại.'); }); }}>Kiểm tra trạng thái</button>}</div>)}</div>}
        {folderError && <p className="p-4 text-sm text-rose-700">{folderError}</p>}
        {selectedEntries.length > 0 && status === 'ACTIVE' && <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-cyan-50 px-4 py-2 text-sm">
          <span className="font-semibold">Đã chọn {selectedEntries.length} mục</span>
          <Button size="sm" variant="secondary" disabled={busy || selectedEntries.length > 25 || selectedHasShortcut} title={selectedHasShortcut ? 'Lối tắt không thể tải trực tiếp; hãy mở mục gốc trên Google Drive.' : undefined} onClick={() => void downloadSelection(selectedEntries.map((entry) => entry.id))}><CpmsIcon name="download" />Tải xuống{selectedEntries.length > 1 ? ' ZIP' : ''}</Button>
          <Button size="sm" variant="secondary" disabled={busy || !canTrashSelected} onClick={() => void trashSelection(selectedEntries.map((entry) => entry.id))}><CpmsIcon name="delete" />Xóa đã chọn</Button>
          <button type="button" className="text-vna-blue underline" onClick={() => setSelectedIds([])}>Bỏ chọn</button>
          <span className="text-xs text-slate-500">Kéo qua các dòng hoặc dùng Shift/Ctrl để chọn nhiều mục. Tải tối đa 25 mục, 50 MB/lượt.</span>
        </div>}
        {loadingFolder && !page ? <p className="p-5 text-sm">Đang tải nội dung thư mục…</p> : page?.items.length ? <div className="max-h-[500px] overflow-auto">
          <table className="w-full min-w-[750px] text-left text-sm" onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, entryId: null }); }}>
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr>
              <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="Chọn tất cả mục đang hiển thị" checked={page.items.every((entry) => selectedIds.includes(entry.id))} onChange={(event) => setSelectedIds(event.target.checked ? page.items.map((entry) => entry.id) : [])} /></th>
              {([{ key: 'NAME', label: 'Tên' }, { key: 'SIZE', label: 'Dung lượng' }, { key: 'UPDATED', label: 'Cập nhật' }] as const).map((column) => <th key={column.key} className="px-4 py-3">
                <button type="button" className="inline-flex items-center gap-1 hover:text-vna-blue" aria-label={`Sắp xếp theo ${column.label}`} onClick={() => changeSort(column.key)}>{column.label}<CpmsIcon name={sortBy === column.key ? direction === 'ASC' ? 'sortAscending' : 'sortDescending' : 'sort'} size={15} /></button>
              </th>)}
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{page.items.map((entry, index) => <tr key={entry.id}
              className={selectedIds.includes(entry.id) ? 'bg-cyan-100' : 'hover:bg-cyan-50/50'}
              onMouseDown={(event) => { if (event.button !== 0 || (event.target as HTMLElement).closest('button,a,input')) return;
                event.preventDefault(); dragStart.current = index; dragBase.current = event.ctrlKey || event.metaKey ? selectedIds : []; selectEntry(index, event.ctrlKey || event.metaKey, event.shiftKey); }}
              onMouseEnter={(event) => { if (dragStart.current === null || event.buttons !== 1) return;
                const from = Math.min(dragStart.current, index); const to = Math.max(dragStart.current, index);
                setSelectedIds([...new Set([...dragBase.current, ...page.items.slice(from, to + 1).map((item) => item.id)])]); }}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation();
                if (!selectedIds.includes(entry.id)) setSelectedIds([entry.id]);
                setContextMenu({ x: event.clientX, y: event.clientY, entryId: entry.id }); }}>
              <td className="px-3 py-3"><input type="checkbox" aria-label={`Chọn ${entry.name}`} checked={selectedIds.includes(entry.id)} onClick={(event) => selectEntry(index, true, event.shiftKey)} onChange={() => undefined} /></td>
              <td className="px-4 py-3"><span className="flex items-center gap-2"><span className="relative shrink-0"><CpmsIcon name={entry.isFolder || entry.isShortcut && entry.shortcutTargetMimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'} className="text-slate-500" />{entry.isShortcut && <CpmsIcon name="shortcut" size={12} className="absolute -bottom-1 -left-1 rounded bg-white text-vna-blue" />}</span>
                {entry.isFolder && status === 'ACTIVE' ? <button type="button" className="max-w-[420px] truncate font-semibold text-vna-blue hover:underline" onClick={() => openEntry(entry)}>{entry.name}</button>
                  : !entry.isFolder ? <a href={entry.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(entry.id)}`} target="_blank" rel="noreferrer" className="max-w-[420px] truncate font-semibold text-vna-blue hover:underline">{entry.name}</a>
                    : <span className="max-w-[420px] truncate font-medium">{entry.name}</span>}</span>
                {entry.isShortcut && <span className={`mt-1 block text-xs ${shortcutStatuses[entry.id] === 'ACTIVE' ? 'text-slate-500' : 'text-amber-700'}`}>
                  {shortcutStatuses[entry.id] === 'TRASHED' ? 'Mục gốc đã ở Thùng rác' : shortcutStatuses[entry.id] === 'UNAVAILABLE' ? 'Không truy cập được mục gốc (có thể đã xóa hoặc đổi quyền)' : 'Lối tắt'}</span>}</td>
              <td className="px-4 py-3">{entry.isFolder || entry.isShortcut ? '—' : formatBytes(entry.size)}</td>
              <td className="px-4 py-3">{formatDate(entry.modifiedTime)}</td>
              <td className="px-4 py-3"><div className="flex justify-end gap-2">
                {status === 'ACTIVE' && !entry.isShortcut && entry.canDownload && <button type="button" disabled={busy} className="text-vna-blue hover:underline" onClick={() => void downloadSelection([entry.id])}>Tải xuống</button>}
                {status === 'ACTIVE' && entry.canEdit && <button type="button" disabled={busy || pendingItemId === entry.id} className="text-vna-blue hover:underline" onClick={() => void runEntryAction(entry, 'RENAME')}>Đổi tên</button>}
                {status === 'ACTIVE' && entry.canTrash && <button type="button" disabled={busy || pendingItemId === entry.id} className="text-rose-700 hover:underline" onClick={() => void runEntryAction(entry, 'TRASH')}>{entry.isShortcut ? 'Xóa lối tắt' : 'Xóa'}</button>}
                {status === 'TRASHED' && entry.canUntrash && <button type="button" disabled={busy || pendingItemId === entry.id} className="text-vna-blue hover:underline" onClick={() => void runEntryAction(entry, 'RESTORE')}>{entry.isShortcut ? 'Phục hồi lối tắt' : 'Phục hồi'}</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="p-6 text-center text-sm text-slate-500">{status === 'ACTIVE' ? 'Thư mục này chưa có tệp hoặc thư mục con.' : 'Thùng rác của thư mục này đang trống.'}</p>}
        {contextMenu && <div className="fixed inset-0 z-[80]" onClick={() => setContextMenu(null)} onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }}>
          <div role="menu" aria-label="Thao tác Google Drive" className="fixed min-w-56 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl" style={{ left: Math.min(contextMenu.x, window.innerWidth - 235), top: Math.min(contextMenu.y, window.innerHeight - 220) }} onClick={(event) => event.stopPropagation()}>
            {contextEntry && <>
              {status === 'ACTIVE' && !contextEntry.isShortcut && !selectedHasShortcut && <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-50" onClick={() => void downloadSelection(selectedIds.includes(contextEntry.id) ? selectedIds : [contextEntry.id])}>Tải xuống{selectedIds.length > 1 ? ' ZIP' : ''}</button>}
              {status === 'ACTIVE' && contextEntry.canEdit && selectedIds.length === 1 && <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-50" onClick={() => { setContextMenu(null); void runEntryAction(contextEntry, 'RENAME'); }}>Đổi tên</button>}
              {status === 'ACTIVE' && contextEntry.isFolder && selectedIds.length === 1 && <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-50" onClick={() => void openSharing(contextEntry)}>Chia sẻ</button>}
              {status === 'ACTIVE' && canTrashSelected && <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left text-rose-700 hover:bg-rose-50" onClick={() => void trashSelection(selectedIds)}>{selectedIds.length === 1 && contextEntry.isShortcut ? 'Xóa lối tắt' : `Đưa ${selectedIds.length} mục vào Thùng rác`}</button>}
            </>}
            {!contextEntry && status === 'ACTIVE' && <>
              {page && canChange && workspace.capabilities?.ensure && <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-50" onClick={() => { setContextMenu(null); void addFolder(); }}>Tạo thư mục</button>}
              <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-50" onClick={() => { setContextMenu(null); void loadFolder(); }}>Làm mới</button>
            </>}
          </div>
        </div>}
        {sharingFolderId && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !sharingBusy) { setSharingFolderId(null); setSharing(null); } }}>
          <div role="dialog" aria-modal="true" aria-label="Chia sẻ thư mục Google Drive" className="w-full max-w-[580px] rounded-3xl bg-white px-7 py-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-xl font-semibold text-slate-900">Chia sẻ “{sharing?.folderName ?? 'thư mục'}”</h3><button type="button" aria-label="Đóng chia sẻ" title="Đóng" disabled={sharingBusy} className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => { setSharingFolderId(null); setSharing(null); }}><CpmsIcon name="windowClose" /></button></div>
            {sharingLoading && <p className="mt-5 text-sm">Đang tải quyền chia sẻ…</p>}
            {sharingError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{sharingError}</p>}
            {sharing && <div className="mt-5 space-y-6 text-sm">
              {sharing.canManage && <div className="space-y-2"><label htmlFor="campaign-drive-sharing-email" className="sr-only">Thêm người bằng email</label><input id="campaign-drive-sharing-email" type="email" value={sharingEmail} onChange={(event) => setSharingEmail(event.target.value)} placeholder="Thêm người bằng email" className="w-full rounded-lg border border-slate-300 px-4 py-3 focus:border-vna-blue focus:outline-none" /><div className="flex items-center justify-end gap-2"><select aria-label="Quyền mới" value={sharingRole} onChange={(event) => setSharingRole(event.target.value as 'reader' | 'commenter' | 'writer')} className="rounded-lg border border-slate-200 px-3 py-2"><option value="reader">Người xem</option><option value="commenter">Người nhận xét</option><option value="writer">Người chỉnh sửa</option></select><Button size="sm" disabled={!sharingEmail.trim() || sharingBusy} onClick={() => void addSharing('user', sharingRole)}>Chia sẻ</Button></div></div>}
              <section><h4 className="text-base font-semibold text-slate-900">Những người có quyền truy cập</h4><div className="mt-3 max-h-56 space-y-1 overflow-auto">{sharing.permissions.filter((permission) => permission.type !== 'anyone').map((permission) => <div key={permission.id} className="flex items-center gap-3 rounded-lg px-1 py-2"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-slate-600">{(permission.displayName || permission.emailAddress || '?').trim().charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{permission.displayName || permission.emailAddress || permission.type}</span>{permission.displayName && permission.emailAddress && <span className="block truncate text-xs text-slate-500">{permission.emailAddress}</span>}{permission.inherited && <span className="block text-xs text-slate-500">Kế thừa từ thư mục cha</span>}</span>{sharing.canManage && !permission.inherited && ['reader','commenter','writer'].includes(permission.role) && permission.type === 'user' ? <div className="flex shrink-0 items-center gap-2"><select aria-label={`Quyền của ${permission.emailAddress ?? permission.id}`} className="rounded border border-slate-200 p-1" disabled={sharingBusy} value={permission.role} onChange={(event) => void changeSharing(permission.id, event.target.value as 'reader' | 'commenter' | 'writer')}><option value="reader">Người xem</option><option value="commenter">Người nhận xét</option><option value="writer">Người chỉnh sửa</option></select><button type="button" disabled={sharingBusy} className="text-rose-700 underline" onClick={() => void changeSharing(permission.id, null)}>Gỡ</button></div> : <span className="shrink-0 text-slate-500">{permission.role === 'organizer' ? 'Quản lý' : permission.role === 'fileOrganizer' ? 'Quản lý nội dung' : permission.role === 'writer' ? 'Người chỉnh sửa' : permission.role === 'commenter' ? 'Người nhận xét' : permission.role === 'reader' ? 'Người xem' : permission.role}</span>}</div>)}</div></section>
              <section>
                <h4 className="text-base font-semibold text-slate-900">Quyền truy cập chung</h4>
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-700"><CpmsIcon name="locked" /></span>
                  <select aria-label="Quyền truy cập bằng đường liên kết" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" disabled={sharingBusy || !sharing.canManage || !sharing.googleCanShare} value={generalAccess} onChange={(event) => setGeneralAccess(event.target.value as 'RESTRICTED' | 'ANYONE')}>
                    <option value="RESTRICTED">Bị giới hạn</option><option value="ANYONE">Bất kỳ ai có đường liên kết</option>
                  </select>
                  {generalAccess === 'ANYONE' && <select aria-label="Vai trò của người có đường liên kết" className="rounded-lg border border-slate-300 bg-white px-3 py-2" disabled={sharingBusy || !sharing.canManage || !sharing.googleCanShare} value={generalRole} onChange={(event) => setGeneralRole(event.target.value as 'reader' | 'commenter' | 'writer')}>
                    <option value="reader">Người xem</option><option value="commenter">Người nhận xét</option><option value="writer">Người chỉnh sửa</option>
                  </select>}
                </div>
                {publicAccess(sharing).inheritedRank > 0 && !sharing.limitedAccess && <p className="mt-2 text-xs text-slate-600">Quyền hiện tại kế thừa từ thư mục cha. Muốn giảm hoặc bỏ quyền link cho riêng thư mục này cần quyền Manager của Shared Drive và bật quyền truy cập giới hạn.</p>}
                {publicAccess(sharing).inheritedRank > 0 && !sharing.limitedAccess && !sharing.canLimitAccess && <p className="mt-1 text-xs text-amber-800">Tài khoản Google hiện tại chưa có quyền Manager để giảm quyền kế thừa trên thư mục này.</p>}
                {sharing.canManage && sharing.googleCanShare && <div className="mt-3 flex justify-end"><Button size="sm" disabled={sharingBusy || (generalAccess === publicAccess(sharing).access && (generalAccess === 'RESTRICTED' || generalRole === publicAccess(sharing).role))} onClick={() => void saveGeneralAccess()}>Lưu quyền truy cập chung</Button></div>}
              </section>
              <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 font-semibold text-vna-blue hover:bg-cyan-50" onClick={() => void navigator.clipboard.writeText(sharing.link).then(() => notify('Đã sao chép link thư mục.')).catch(() => setSharingError('Không sao chép được link. Hãy mở thư mục trên Google Drive.'))}><CpmsIcon name="link" />Sao chép đường liên kết</button><Button size="sm" disabled={sharingBusy} onClick={() => { setSharingFolderId(null); setSharing(null); }}>Xong</Button></div>
            </div>}
          </div>
        </div>}
        {page?.nextPageToken && <div className="border-t border-slate-100 p-3 text-center"><Button size="sm" variant="secondary" disabled={loadingFolder} onClick={() => void loadFolder(page.nextPageToken!)}>Tải thêm</Button></div>}
      </div> : <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm">Chưa có thư mục Google Drive sẵn sàng. Chọn “Kiểm tra/đồng bộ” sau khi tài khoản Google dùng chung đã kết nối.</div>}
    </div>
  </Card>;
}

function DriveHeader() {
  return <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 lg:px-6"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-50 text-vna-blue"><CpmsIcon name="folder" /></span><div><h2 className="font-semibold text-slate-950">Tài liệu Google Drive</h2><p className="mt-1 text-xs leading-5 text-slate-500">Duyệt và quản lý tài liệu trong thư mục Google Drive của Chiến dịch.</p></div></div>;
}

function Notice({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span className="flex items-start gap-2"><CpmsIcon name="warning" className="mt-0.5 shrink-0" />{text}</span>{action}</div>;
}
