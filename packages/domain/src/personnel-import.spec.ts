import { describe, expect, it } from 'vitest';
import { normalizeDirectorySearch, parsePersonnelDirectory, previewPersonnelImport, type DirectoryImportSnapshot, type DirectoryWorkbook, type ExistingDirectoryIdentity } from './personnel-import';

const headers = ['STT', 'Mã nhân viên', 'Họ và tên', 'Ban', 'Phòng', 'Chức danh công việc', 'Email', 'Điện thoại', 'Ngày sinh', 'Tuổi', 'Giới tính', 'Ghi chú', null, 'Nguồn dữ liệu'];
const person = ['1', '0012', 'Nhân vật thử nghiệm 62', 'Đơn vị thử A', 'Phòng thử', 'Chuyên viên', ' User@Example.test ', 'PRIVATE_PHONE', 'PRIVATE_BIRTH', 'PRIVATE_AGE', 'PRIVATE_GENDER', '', null, 'Synthetic fixture'];
const workbook = (rows: DirectoryWorkbook['sheets'][number]['rows'] = [person]): DirectoryWorkbook => ({ sheets: [{ name: 'Danh bạ', rows: [['Title'], [], ['other'], [], headers, ...rows] }, { name: 'Email chưa đủ thông tin', rows: [['Title'], ['Email'], ['pending@example.test']] }] });
const empty: DirectoryImportSnapshot = { identities: [], accounts: [], pendingEmails: [] };
const existingFrom = (row = person): ExistingDirectoryIdentity => {
  const data = parsePersonnelDirectory(workbook([row])).people[0]!;
  return { employeeCode: data.employeeCode, actorId: 'synthetic-actor', email: data.email, recordVersion: 2, profile: data };
};

describe('personnel source parsing and reconciliation', () => {
  it('finds headers independently of line numbers and keeps Unicode, text IDs and name suffixes', () => {
    const result = parsePersonnelDirectory(workbook());
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ employeeCode: '0012', fullName: 'Nhân vật thử nghiệm 62', email: 'user@example.test', rowNumber: 6 });
    expect(result.pending).toEqual([{ sheetName: 'Email chưa đủ thông tin', rowNumber: 3, email: 'pending@example.test' }]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_(PHONE|BIRTH|AGE|GENDER)/);
  });
  it('does not turn a leadership display group or missing division into a formal division', () => {
    const leadership = [...person]; leadership[4] = 'Lãnh đạo Ban';
    expect(parsePersonnelDirectory(workbook([leadership])).people[0]).toMatchObject({ departmentName: null, displayGroup: 'Lãnh đạo Ban' });
    leadership[4] = '';
    expect(parsePersonnelDirectory(workbook([leadership])).people[0]).toMatchObject({ departmentName: null, organizationName: 'Đơn vị thử A' });
  });
  it('reports actual source population and never invents a missing pending sheet', () => {
    const input = workbook(); input.sheets.pop();
    const parsed = parsePersonnelDirectory(input);
    expect(parsed.pending).toHaveLength(0);
    expect(parsed.warnings).toContainEqual({ sheetName: '', rowNumber: 0, code: 'NO_PENDING_SHEET' });
  });
  it('rejects incomplete/duplicate personnel headers instead of demoting people into contacts', () => {
    const input = workbook(); input.sheets[0]!.rows[4] = ['Mã nhân viên', 'Email'];
    expect(parsePersonnelDirectory(input).invalid[0]?.code).toBe('INCOMPLETE_PERSONNEL_HEADER');
    input.sheets[0]!.rows[4] = [...headers, 'Email'];
    expect(parsePersonnelDirectory(input).invalid[0]?.code).toBe('DUPLICATE_HEADER');
  });
  it('rejects numeric employee identifiers, invalid email and incomplete identities', () => {
    const badCode = [...person]; badCode[1] = 12 as never;
    const badEmail = [...person]; badEmail[6] = 'bad';
    const badName = [...person]; badName[2] = '';
    expect(parsePersonnelDirectory(workbook([badCode, badEmail, badName])).invalid).toHaveLength(3);
  });
  it('classifies CREATE/PENDING, then UNCHANGED on reimport without creating actors for contacts', () => {
    const source = parsePersonnelDirectory(workbook());
    expect(previewPersonnelImport(source, empty).counts).toEqual({ CREATE: 1, PENDING: 1, UPDATE: 0, UNCHANGED: 0, CONFLICT: 0, INVALID: 0 });
    const current = { identities: [existingFrom()], accounts: [], pendingEmails: ['PENDING@example.test'] };
    const result = previewPersonnelImport(source, current);
    expect(result.counts.UNCHANGED).toBe(2);
    expect(result.items[1]!.existingActorId).toBeNull();
  });
  it('preserves actor identity when only email/profile changes; never proposes role or credential changes', () => {
    const source = parsePersonnelDirectory(workbook());
    const previous = existingFrom(); previous.email = 'previous@example.test';
    const result = previewPersonnelImport(source, { ...empty, identities: [previous] });
    expect(result.items[0]).toMatchObject({ status: 'UPDATE', existingActorId: 'synthetic-actor', expectedVersion: 2 });
    expect(result.items[0]).not.toHaveProperty('roles');
    expect(result.items[0]).not.toHaveProperty('credential');
  });
  it('provisions the account link for an otherwise unchanged legacy directory profile', () => {
    const previous = existingFrom(); previous.actorId = null;
    const result = previewPersonnelImport(parsePersonnelDirectory(workbook()), { ...empty, identities: [previous] });
    expect(result.items[0]?.status).toBe('UPDATE');
  });
  it('does not merge same-name people or actors linked by conflicting employee code/email', () => {
    const source = parsePersonnelDirectory(workbook());
    const previous = existingFrom();
    const snapshot = { ...empty, identities: [previous], accounts: [{ actorId: 'different-actor', employeeCode: '9999', email: 'user@example.test' }] };
    expect(previewPersonnelImport(source, snapshot).items[0]?.status).toBe('CONFLICT');
    previous.employeeCode = 'different-code'; previous.email = 'different@example.test';
    expect(previewPersonnelImport(source, { ...empty, identities: [previous] }).items[0]?.status).toBe('CREATE');
  });
  it('flags every duplicate source identity, including duplicates across complete/pending sheets', () => {
    const input = workbook([person, [...person]]);
    input.sheets[1]!.rows.push(['user@example.test']);
    const result = previewPersonnelImport(parsePersonnelDirectory(input), empty);
    expect(result.counts.CONFLICT).toBe(3);
    expect(result.counts.CREATE).toBe(0);
  });
  it('does not deactivate people missing from a new source and supports accent-insensitive search', () => {
    expect(previewPersonnelImport(parsePersonnelDirectory(workbook([])), { ...empty, identities: [existingFrom()] }).items).toHaveLength(1);
    expect(normalizeDirectorySearch(' Đơn Vị thử ')).toBe('don vi thu');
  });
});
