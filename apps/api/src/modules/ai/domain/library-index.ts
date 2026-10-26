import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TabularSheetData } from '@cpms/integrations';
import type { AiLibraryResult, AiWorkspacePolicy } from '@cpms/ai-contracts';
import { normalizeSearch } from './lookup-policy';
export type LibraryEntry = Omit<AiLibraryResult, 'matchedTerms'> & { sourceRow: number; status: string; type: string };
const photo = new Set(['JPG','JPEG','PNG','WEBP','HEIC','TIFF','TIF','GIF','AVIF']);
const video = new Set(['MP4','MOV','MXF','AVI','M4V','MKV','WEBM','GVID']);
export function safeLibraryLink(raw: string): string | null {
  try { const url = new URL(raw); return url.protocol === 'https:' && ['drive.google.com','docs.google.com'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; }
}
export function parseLibraryIndex(sheet: TabularSheetData, spreadsheetId: string): LibraryEntry[] {
  if (sheet.rows.length < 2 || sheet.rows.length > 10_001) throw new BadRequestException('DriveIndex cần 1–10.000 dòng; chỉ mục cũ được giữ nguyên.');
  const header = sheet.rows[0]!.map(v => normalizeSearch(String(v ?? '')));
  for (const [column, title] of [[1,'ten day du'],[8,'link'],[13,'root folder id'],[14,'item id'],[16,'scope key'],[17,'trang thai'],[25,'hieu luc su dung']] as const) {
    if (header[column] !== title) throw new BadRequestException(`Cấu trúc DriveIndex đã đổi ở cột ${column + 1}; chưa cập nhật chỉ mục.`);
  }
  const ids = new Set<string>(), entries: LibraryEntry[] = [];
  for (let index = 1; index < sheet.rows.length; index++) {
    const cells = sheet.rows[index]!, cell = (n: number) => String(cells[n] ?? '').trim();
    if (cells.every(v => !String(v ?? '').trim())) continue;
    const itemId = cell(14), rootId = cell(13), scope = cell(16), href = safeLibraryLink(cell(8));
    if (!itemId || !rootId || !scope || !cell(1) || !href) throw new BadRequestException(`DriveIndex dòng ${index + 1} thiếu ID/tên/link hợp lệ; chỉ mục cũ được giữ nguyên.`);
    const id = createHash('sha256').update(`${spreadsheetId}:${scope}`).digest('hex');
    if (ids.has(id)) throw new BadRequestException(`Scope Key trùng tại dòng ${index + 1}.`);
    ids.add(id);
    entries.push({ id, itemId, rootId, sourceRow: index + 1, href, name: cell(1).slice(0,500), path: cell(3).slice(0,1200),
      format: (cell(2).match(/\.([a-z0-9]+)\)/i)?.[1] ?? cell(2).replace(/^\./,'')).toUpperCase(), description: cell(6).slice(0,1200), rights: cell(25) || 'Chưa có thông tin',
      rightsNote: cell(26).slice(0,500), sourceUpdatedAt: cell(20) || cell(7), status: cell(17).toUpperCase(), type: normalizeSearch(cell(0)), contentRead: false });
  }
  return entries;
}
export function searchLibrary(entries: LibraryEntry[], query: string, mediaType: string, policy: AiWorkspacePolicy): AiLibraryResult[] {
  const terms = [...new Set(normalizeSearch(query).split(/\s+/).filter(Boolean))].slice(0,12);
  const results: (AiLibraryResult & { score: number })[] = [];
  for (const row of entries) {
    if (row.status !== 'ACTIVE' || policy.allowedRootIds.length && !policy.allowedRootIds.includes(row.rootId)) continue;
    const rights = normalizeSearch(row.rights);
    if (rights.includes('het hieu luc') || rights.includes('khong duoc su dung')) continue;
    if (!policy.includeUnknownRights && (!rights || rights.includes('chua') || rights.includes('khong ro'))) continue;
    const folder = row.type.includes('folder') || row.type.includes('thu muc');
    if (mediaType === 'FOLDER' ? !folder : folder || mediaType === 'PHOTO' && !photo.has(row.format) || mediaType === 'VIDEO' && !video.has(row.format)) continue;
    if (!folder && !photo.has(row.format) && !video.has(row.format) && !['PDF','AI','PSD','EPS','SVG','PPTX','INDD'].includes(row.format)) continue;
    const haystack = normalizeSearch(`${row.name} ${row.path} ${row.description}`);
    if (!terms.every(term => haystack.includes(term))) continue;
    const { sourceRow: _sourceRow, status: _status, type: _type, ...item } = row;
    void _sourceRow; void _status; void _type;
    results.push({ ...item, matchedTerms: terms, score: terms.reduce((sum,t) => sum + (normalizeSearch(row.name).includes(t) ? 3 : 1),0) });
  }
  const seen = new Set<string>();
  return results.sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).filter(row => { if (seen.has(row.itemId)) return false; seen.add(row.itemId); return true; })
    .slice(0,policy.maxResults).map(({ score: _score, ...item }) => item);
}

/** Compact model context; the UI and evidence retain the complete original index result. */
export function libraryModelItems(items: AiLibraryResult[]) {
  const bounded = (value: string, bytes: number) => {
    if (Buffer.byteLength(value, 'utf8') <= bytes) return value;
    let output = '';
    for (const char of value) { if (Buffer.byteLength(output + char, 'utf8') > bytes - 3) break; output += char; }
    return output + '…';
  };
  return items.map(item => ({
    name: bounded(item.name,256), href: item.href, format: item.format,
    path: bounded(item.path,256), description: bounded(item.description,256),
    rights: bounded(item.rights,192), rightsNote: bounded(item.rightsNote,128),
    sourceUpdatedAt: bounded(item.sourceUpdatedAt,64), contentRead: false,
    note: 'Metadata có thể rút gọn; thẻ tư liệu trên giao diện giữ bản đầy đủ.',
  }));
}
