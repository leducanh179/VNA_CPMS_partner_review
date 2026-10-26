import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { CloudDriveItem, CloudDrivePort } from '@cpms/integrations';

export const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export function driveFolderIdFromUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new BadRequestException('Link thư mục Google Drive không hợp lệ.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.hash) {
    throw new BadRequestException('Chỉ chấp nhận link https://drive.google.com/drive/folders/…');
  }
  const match = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?$/.exec(url.pathname);
  if (!match) throw new BadRequestException('Link phải trỏ trực tiếp tới một thư mục Google Drive.');
  return match[1]!;
}

export function driveFolderLink(id: string) { return `https://drive.google.com/drive/folders/${id}`; }

export function validDriveId(value: string) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(value)) throw new BadRequestException('Google Drive ID không hợp lệ.');
  return value;
}

/** Returns the folder chain from the selected item up to the permitted root, inclusive. */
export async function folderChainToRoot(drive: CloudDrivePort, accessToken: string, folderId: string,
  rootId: string, sharedDriveId: string, allowRoot = true): Promise<CloudDriveItem[]> {
  let id = validDriveId(folderId);
  const seen = new Set<string>();
  const chain: CloudDriveItem[] = [];
  for (let depth = 0; depth < 100; depth += 1) {
    if (id === sharedDriveId) throw new ForbiddenException('Thư mục nằm ngoài phạm vi Chiến dịch.');
    if (seen.has(id)) throw new ConflictException('Chuỗi thư mục Google Drive bị lặp.');
    seen.add(id);
    const folder = await drive.getItem(accessToken, id);
    if (folder.mimeType !== GOOGLE_FOLDER_MIME_TYPE || folder.trashed || folder.driveId !== sharedDriveId) {
      throw new ForbiddenException('Thư mục không hợp lệ hoặc không thuộc Shared Drive của Chiến dịch.');
    }
    chain.push(folder);
    if (id === rootId) {
      if (!allowRoot && chain.length === 1) throw new ForbiddenException('Không thể chọn chính thư mục gốc.');
      return chain;
    }
    if (folder.parents.length !== 1) throw new ForbiddenException('Không xác định được thư mục cha trên Google Drive.');
    id = folder.parents[0]!;
  }
  throw new ForbiddenException('Thư mục nằm quá sâu hoặc ngoài phạm vi Chiến dịch.');
}
