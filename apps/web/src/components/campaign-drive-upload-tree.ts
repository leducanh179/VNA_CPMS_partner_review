export interface UploadTree {
  directories: string[];
  files: Array<{ path: string; file: File }>;
}

const MAX_ITEMS = 200;
const MAX_DEPTH = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

function segments(path: string) {
  const parts = path.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Tên thư mục không hợp lệ.');
  }
  if (parts.length > MAX_DEPTH + 1) throw new Error(`Thư mục lồng quá ${MAX_DEPTH} cấp.`);
  return parts;
}

function validate(tree: UploadTree): UploadTree {
  if (tree.directories.length + tree.files.length > MAX_ITEMS) throw new Error(`Mỗi lượt tải tối đa ${MAX_ITEMS} tệp và thư mục.`);
  let total = 0;
  const paths = new Set<string>();
  for (const directory of tree.directories) segments(directory);
  for (const { path, file } of tree.files) {
    segments(path);
    if (paths.has(path)) throw new Error(`Có hai tệp cùng đường dẫn “${path}”.`);
    paths.add(path);
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error(`“${path}” rỗng hoặc vượt giới hạn 50 MB/tệp.`);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('Tổng dung lượng vượt giới hạn 500 MB/lượt.');
  return { directories: [...new Set(tree.directories)].sort((a, b) => segments(a).length - segments(b).length || a.localeCompare(b)), files: tree.files };
}

export function treeFromFolderSelection(files: File[]): UploadTree {
  if (!files.length) throw new Error('Trình duyệt không gửi thư mục rỗng qua hộp chọn. Hãy kéo thả thư mục để giữ cấu trúc rỗng, hoặc thêm tệp trước khi chọn.');
  const directories = new Set<string>();
  const planned = files.map((file) => {
    const path = file.webkitRelativePath;
    if (!path || path === file.name) throw new Error('Trình duyệt không cung cấp cấu trúc thư mục. Hãy kéo thả thư mục hoặc dùng trình duyệt hỗ trợ tải thư mục.');
    const parts = segments(path);
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
    return { path, file };
  });
  return validate({ directories: [...directories], files: planned });
}

type FolderEntry = FileSystemDirectoryEntry | FileSystemFileEntry;
async function readDirectory(entry: FileSystemDirectoryEntry): Promise<FolderEntry[]> {
  const reader = entry.createReader();
  const entries: FolderEntry[] = [];
  while (true) {
    const batch = await new Promise<FolderEntry[]>((resolve, reject) => reader.readEntries(
      (items) => resolve(items as FolderEntry[]), reject));
    if (!batch.length) break;
    entries.push(...batch);
    if (entries.length > MAX_ITEMS) throw new Error(`Mỗi lượt tải tối đa ${MAX_ITEMS} tệp và thư mục.`);
  }
  return entries;
}

async function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

export async function treeFromDrop(items: DataTransferItemList): Promise<UploadTree> {
  const directories: string[] = [];
  const files: UploadTree['files'] = [];
  const visit = async (entry: FolderEntry, parent: string) => {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    segments(path);
    if (directories.length + files.length >= MAX_ITEMS) throw new Error(`Mỗi lượt tải tối đa ${MAX_ITEMS} tệp và thư mục.`);
    if (entry.isDirectory) {
      directories.push(path);
      for (const child of await readDirectory(entry as FileSystemDirectoryEntry)) await visit(child, path);
    } else files.push({ path, file: await readFile(entry as FileSystemFileEntry) });
  };
  const sources = Array.from(items).filter((item) => item.kind === 'file').map((item) => ({
    entry: item.webkitGetAsEntry() as FolderEntry | null, file: item.getAsFile(),
  }));
  for (const { entry, file } of sources) {
    if (entry) await visit(entry, '');
    else if (file) files.push({ path: file.name, file });
  }
  if (!directories.length && !files.length) throw new Error('Không tìm thấy tệp hoặc thư mục để tải lên.');
  return validate({ directories, files });
}
