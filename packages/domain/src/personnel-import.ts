export interface DirectorySourceRow {
  sheetName: string;
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  email: string;
  organizationName: string;
  departmentName: string | null;
  displayGroup: string | null;
  jobTitle: string | null;
  sourceReference: string | null;
}
export interface PendingDirectoryContact {
  sheetName: string;
  rowNumber: number;
  email: string;
}
export interface DirectoryIssue {
  sheetName: string;
  rowNumber: number;
  code: string;
}
export interface ParsedDirectory {
  people: DirectorySourceRow[];
  pending: PendingDirectoryContact[];
  invalid: DirectoryIssue[];
  warnings: DirectoryIssue[];
  sheets: { name: string; rowCount: number; headerRow: number | null; kind: 'PERSONNEL' | 'PENDING' | 'UNRECOGNIZED' }[];
}
export interface DirectoryWorkbook {
  sheets: { name: string; rows: (string | number | boolean | null)[][] }[];
}
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
export const normalizeDirectorySearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
export const normalizeWorkEmail = (value: string) => value.trim().toLowerCase();
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Header driven and read-only; never evaluates formulas, infers privileges or imports extra PII. */
export function parsePersonnelDirectory(workbook: DirectoryWorkbook): ParsedDirectory {
  const output: ParsedDirectory = { people: [], pending: [], invalid: [], warnings: [], sheets: [] };
  for (const sheet of workbook.sheets) {
    let headerRow = -1;
    let headers: string[] = [];
    for (let index = 0; index < Math.min(50, sheet.rows.length); index++) {
      const normalized = sheet.rows[index]!.map((value) => normalizeDirectorySearch(clean(value)));
      if (normalized.includes('email')) { headerRow = index; headers = normalized; break; }
    }
    if (headerRow < 0) {
      output.sheets.push({ name: sheet.name, rowCount: sheet.rows.length, headerRow: null, kind: 'UNRECOGNIZED' });
      output.warnings.push({ sheetName: sheet.name, rowNumber: 0, code: 'HEADER_NOT_FOUND' });
      continue;
    }
    const required = ['ma nhan vien', 'ho va ten', 'ban', 'email'];
    const personnel = required.every((name) => headers.includes(name));
    const ambiguous = required.some((name) => headers.filter((header) => header === name).length > 1);
    const incompletePersonnelHeader = !personnel && ['ma nhan vien', 'ho va ten', 'ban'].some((name) => headers.includes(name));
    output.sheets.push({ name: sheet.name, rowCount: sheet.rows.length, headerRow: headerRow + 1, kind: personnel ? 'PERSONNEL' : 'PENDING' });
    if (ambiguous || incompletePersonnelHeader) {
      output.invalid.push({ sheetName: sheet.name, rowNumber: headerRow + 1, code: ambiguous ? 'DUPLICATE_HEADER' : 'INCOMPLETE_PERSONNEL_HEADER' });
      continue;
    }
    for (let index = headerRow + 1; index < sheet.rows.length; index++) {
      const row = sheet.rows[index]!;
      if (!row.some((value) => clean(value))) continue;
      const at = (header: string) => clean(row[headers.indexOf(header)]);
      const location = { sheetName: sheet.name, rowNumber: index + 1 };
      const email = normalizeWorkEmail(at('email'));
      if (!validEmail(email)) { output.invalid.push({ ...location, code: 'INVALID_EMAIL' }); continue; }
      if (!personnel) { output.pending.push({ ...location, email }); continue; }
      const employeeValue = row[headers.indexOf('ma nhan vien')];
      // Numeric employee identifiers may have lost leading zeroes in Excel; require source correction.
      if (typeof employeeValue !== 'string' || !employeeValue.trim() || !at('ho va ten') || !at('ban')) {
        output.invalid.push({ ...location, code: 'INCOMPLETE_IDENTITY_OR_NON_TEXT_CODE' }); continue;
      }
      const sourceDepartment = at('phong');
      const leadershipGroup = normalizeDirectorySearch(sourceDepartment) === 'lanh dao ban';
      output.people.push({
        ...location, employeeCode: employeeValue.trim(), fullName: at('ho va ten'), email,
        organizationName: at('ban'), departmentName: leadershipGroup ? null : sourceDepartment || null,
        displayGroup: leadershipGroup ? sourceDepartment : null,
        jobTitle: at('chuc danh cong viec') || null, sourceReference: at('nguon du lieu') || null,
      });
    }
  }
  if (!output.sheets.some((sheet) => sheet.kind === 'PENDING')) {
    output.warnings.push({ sheetName: '', rowNumber: 0, code: 'NO_PENDING_SHEET' });
  }
  return output;
}

export type DirectoryImportStatus = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'PENDING' | 'CONFLICT' | 'INVALID';
export interface ExistingDirectoryIdentity {
  employeeCode: string;
  actorId: string | null;
  email: string | null;
  recordVersion: number;
  profile: Pick<DirectorySourceRow, 'fullName' | 'organizationName' | 'departmentName' | 'displayGroup' | 'jobTitle' | 'sourceReference'>;
}
export interface DirectoryImportSnapshot {
  identities: ExistingDirectoryIdentity[];
  /** Include account emails even for actors not linked to a directory entry. */
  accounts: { actorId: string; employeeCode: string | null; email: string }[];
  pendingEmails: string[];
}
export interface DirectoryPreviewItem {
  sheetName: string;
  rowNumber: number;
  status: DirectoryImportStatus;
  reason: string;
  person: DirectorySourceRow | null;
  pending: PendingDirectoryContact | null;
  existingActorId: string | null;
  expectedVersion: number | null;
}
export interface DirectoryPreview {
  items: DirectoryPreviewItem[];
  counts: Record<DirectoryImportStatus, number>;
  warnings: DirectoryIssue[];
}

/** Reconciles stable employee codes with emails. Names never identify an actor. */
export function previewPersonnelImport(source: ParsedDirectory, snapshot: DirectoryImportSnapshot): DirectoryPreview {
  const counts: DirectoryPreview['counts'] = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, PENDING: 0, CONFLICT: 0, INVALID: 0 };
  const items: DirectoryPreviewItem[] = [];
  const emails = [...source.people, ...source.pending].map((row) => row.email);
  const codes = source.people.map((row) => row.employeeCode);
  const repeated = (values: string[]) => new Set(values.filter((value, index) => values.indexOf(value) !== index));
  const duplicateEmails = repeated(emails);
  const duplicateCodes = repeated(codes);
  const push = (item: DirectoryPreviewItem) => { items.push(item); counts[item.status]++; };
  for (const person of source.people) {
    const sameCode = snapshot.identities.filter((row) => row.employeeCode === person.employeeCode);
    const sameEmail = snapshot.identities.filter((row) => row.email && normalizeWorkEmail(row.email) === person.email);
    const accounts = snapshot.accounts.filter((row) => normalizeWorkEmail(row.email) === person.email || row.employeeCode === person.employeeCode);
    const actorIds = new Set([...sameCode.map((row) => row.actorId), ...sameEmail.map((row) => row.actorId), ...accounts.map((row) => row.actorId)].filter((id): id is string => id !== null));
    const existing = sameCode[0];
    const conflict = duplicateEmails.has(person.email) || duplicateCodes.has(person.employeeCode) ||
      sameCode.length > 1 || sameEmail.length > 1 || actorIds.size > 1 ||
      sameEmail.some((row) => row.employeeCode !== person.employeeCode) ||
      accounts.some((row) => row.employeeCode !== person.employeeCode);
    let status: DirectoryImportStatus;
    if (conflict) status = 'CONFLICT';
    else if (!existing) status = 'CREATE';
    else {
      const keys = ['fullName', 'organizationName', 'departmentName', 'displayGroup', 'jobTitle', 'sourceReference'] as const;
      status = existing.actorId && normalizeWorkEmail(existing.email ?? '') === person.email && keys.every((key) => existing.profile[key] === person[key]) ? 'UNCHANGED' : 'UPDATE';
    }
    push({ sheetName: person.sheetName, rowNumber: person.rowNumber, status,
      reason: conflict ? 'IDENTITY_CONFLICT_REQUIRES_REVIEW' : status,
      person, pending: null, existingActorId: existing?.actorId ?? null, expectedVersion: existing?.recordVersion ?? null });
  }
  for (const pending of source.pending) {
    const conflict = duplicateEmails.has(pending.email) || snapshot.identities.some((row) => normalizeWorkEmail(row.email ?? '') === pending.email) ||
      snapshot.accounts.some((row) => normalizeWorkEmail(row.email) === pending.email);
    const status = conflict ? 'CONFLICT' : snapshot.pendingEmails.some((email) => normalizeWorkEmail(email) === pending.email) ? 'UNCHANGED' : 'PENDING';
    push({ ...pending, status, reason: conflict ? 'PENDING_IDENTITY_CONFLICT' : status, person: null, pending, existingActorId: null, expectedVersion: null });
  }
  for (const invalid of source.invalid) push({ ...invalid, status: 'INVALID', reason: invalid.code, person: null, pending: null, existingActorId: null, expectedVersion: null });
  return { items, counts, warnings: source.warnings };
}
