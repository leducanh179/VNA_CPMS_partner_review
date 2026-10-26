import { describe,expect,it } from 'vitest';
import { libraryModelItems,parseLibraryIndex,safeLibraryLink,searchLibrary } from './library-index';
import { DEFAULT_AI_POLICY } from './workspace-policy';
const header = Array.from({length:27},()=> '');
for(const [i,label] of [[1,'Tên đầy đủ'],[8,'Link'],[13,'Root Folder ID'],[14,'Item ID'],[16,'Scope Key'],[17,'Trạng thái'],[25,'Hiệu lực sử dụng']] as const) header[i]=label;
function row(id:string,rights='Chưa có thông tin',root='synthetic-root') {
  const cells=Array.from({length:27},()=> '');
  Object.assign(cells,{0:'File',1:'Ảnh Đà Nẵng máy bay.jpg',2:'jpg',3:'Bộ ảnh/Đà Nẵng',8:`https://drive.google.com/file/d/${id}/view`,13:root,14:id,16:`${root}|${id}`,17:'ACTIVE',20:'21/08/2026',25:rights});return cells;
}
describe('QCTT metadata index',()=>{
  it('combines a topic in the folder path with language, duration and format in the filename',()=>{
    const target=row('fake-topic');Object.assign(target,{1:'CLIP_30s_ENG.mp4',2:'mp4',3:'Bộ phim Hoa Sen/Bản rút gọn/CLIP_30s_ENG.mp4'});
    const other=row('fake-other');Object.assign(other,{1:'Hoa Biển_30s_ENG.mp4',2:'mp4',3:'Bộ phim Hoa Biển/30s_ENG.mp4'});
    const wrongLanguage=row('fake-language');Object.assign(wrongLanguage,{1:'CLIP_30s_RU.mp4',2:'mp4',3:'Bộ phim Hoa Sen/CLIP_30s_RU.mp4'});
    const entries=parseLibraryIndex({name:'DriveIndex',rows:[header,target,other,wrongLanguage]},'fake-sheet');
    expect(searchLibrary(entries,'hoa sen 30s eng mp4','VIDEO',DEFAULT_AI_POLICY).map(item=>item.itemId)).toEqual(['fake-topic']);
  });
  it('bounds model metadata by UTF-8 bytes without changing exact links or full UI results',()=>{
    const source=searchLibrary(parseLibraryIndex({name:'DriveIndex',rows:[header,row('fake-a')]},'fake-sheet'),'','PHOTO',DEFAULT_AI_POLICY);
    source[0]!.description='Thông tin rất dài có dấu '.repeat(100);
    const before=structuredClone(source), model=libraryModelItems(source);
    expect(source).toEqual(before);
    expect(model[0]!.href).toBe(source[0]!.href);
    expect(model[0]!.rights).toBe('Chưa có thông tin');
    expect(Buffer.byteLength(model[0]!.description)).toBeLessThanOrEqual(256);
    expect(model[0]!.description).not.toContain('�');
    expect(model[0]!.description).toMatch(/…$/);
  });
  it('validates the schema and refuses malformed or duplicate snapshots atomically',()=>{
    expect(()=>parseLibraryIndex({name:'DriveIndex',rows:[[],row('fake-a')]},'fake-sheet')).toThrow();
    expect(()=>parseLibraryIndex({name:'DriveIndex',rows:[header,row('fake-a'),row('fake-a')]},'fake-sheet')).toThrow();
    const invalid=row('fake-a');invalid[8]='http://127.0.0.1/private';expect(()=>parseLibraryIndex({name:'DriveIndex',rows:[header,invalid]},'fake-sheet')).toThrow();
    expect(safeLibraryLink('https://drive.google.com.evil.test/file')).toBeNull();
    expect(safeLibraryLink('https://attacker@drive.google.com/file')).toBeNull();
  });
  it('searches without accents, deduplicates files, filters roots/expired rights and labels metadata honestly',()=>{
    const rows=parseLibraryIndex({name:'DriveIndex',rows:[header,row('fake-a'),row('fake-a','Chưa có thông tin','root-two'),row('fake-expired','Hết hiệu lực'),row('fake-valid','Còn hiệu lực')]},'fake-sheet');
    const found=searchLibrary(rows,'da nang','PHOTO',DEFAULT_AI_POLICY);
    expect(found).toHaveLength(2);expect(found.every(x=>x.contentRead===false)).toBe(true);
    expect(found.map(x=>x.itemId)).not.toContain('fake-expired');
    expect(searchLibrary(rows,'da nang','PHOTO',{...DEFAULT_AI_POLICY,includeUnknownRights:false})).toHaveLength(1);
    expect(searchLibrary(rows,'da nang','PHOTO',{...DEFAULT_AI_POLICY,allowedRootIds:['missing']})).toHaveLength(0);
    expect(searchLibrary(rows,'ha noi','PHOTO',DEFAULT_AI_POLICY)).toHaveLength(0);
    expect(searchLibrary(rows,'da nang','VIDEO',DEFAULT_AI_POLICY)).toHaveLength(0);
  });
});
