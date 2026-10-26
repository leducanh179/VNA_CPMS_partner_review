import { describe, expect, it } from 'vitest';
import { treeFromDrop, treeFromFolderSelection } from './campaign-drive-upload-tree';

function file(name: string, path: string): File {
  return { name, size: 3, webkitRelativePath: path } as File;
}

describe('campaign folder upload planning', () => {
  it('preserves a selected folder and its nested children in parent-first order', () => {
    const tree = treeFromFolderSelection([file('logo.png', 'APP6/Thiết kế/Logo/logo.png'), file('brief.pdf', 'APP6/brief.pdf')]);
    expect(tree.directories).toEqual(['APP6', 'APP6/Thiết kế', 'APP6/Thiết kế/Logo']);
    expect(tree.files.map((item) => item.path)).toEqual(['APP6/Thiết kế/Logo/logo.png', 'APP6/brief.pdf']);
  });

  it('rejects a folder picker that omits relative paths instead of flattening the files', () => {
    expect(() => treeFromFolderSelection([file('brief.pdf', '')])).toThrow('không cung cấp cấu trúc thư mục');
  });

  it('retains multiple dropped folders including an empty nested folder', async () => {
    const leaf = { name: 'Trống', isDirectory: true, isFile: false,
      createReader: () => ({ readEntries: (resolve: (items: unknown[]) => void) => resolve([]) }) };
    const nested = { name: 'Con', isDirectory: true, isFile: false,
      createReader: () => { let read = false; return { readEntries: (resolve: (items: unknown[]) => void) => {
        resolve(read ? [] : [leaf]); read = true;
      } }; } };
    const root = { name: 'Một', isDirectory: true, isFile: false,
      createReader: () => { let read = false; return { readEntries: (resolve: (items: unknown[]) => void) => {
        resolve(read ? [] : [nested]); read = true;
      } }; } };
    const another = { name: 'Hai', isDirectory: true, isFile: false,
      createReader: () => ({ readEntries: (resolve: (items: unknown[]) => void) => resolve([]) }) };
    const items = [root, another].map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })) as unknown as DataTransferItemList;
    expect((await treeFromDrop(items)).directories).toEqual(['Hai', 'Một', 'Một/Con', 'Một/Con/Trống']);
  });
});
