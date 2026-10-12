import { describe, expect, it, vi } from 'vitest';
import { DirectoryImportApplicationService, DirectoryImportConflict, type DirectoryImportRepository, type DirectoryTransaction } from './directory-import.application-service';

const document = { sheets: [{ name: 'People', rows: [['Mã nhân viên', 'Họ và tên', 'Ban', 'Email'], ['001', 'Synthetic Person', 'Synthetic Unit', 'person@example.test']] }] };
const input = { fileName: 'synthetic.xlsx', content: new Uint8Array([1, 2, 3]) };
function setup() {
  const tx: DirectoryTransaction = {
    requireDirectSuperadmin: vi.fn().mockResolvedValue({ actorId: 'synthetic-admin' }),
    snapshot: vi.fn().mockResolvedValue({ version: 1, data: { identities: [], accounts: [], pendingEmails: [] } }),
    upsertPersonWithAudit: vi.fn().mockResolvedValue(undefined), upsertPendingWithAudit: vi.fn().mockResolvedValue(undefined),
  };
  const repository: DirectoryImportRepository = { withImportTransaction: (operation) => operation(tx) };
  const service = new DirectoryImportApplicationService({ read: vi.fn().mockResolvedValue(document) });
  return { service, repository, tx };
}
describe('directory import Application Service (repository double)', () => {
  it('inspects source without DB access and returns an exact source hash', async () => {
    const { service } = setup();
    const result = await service.inspect(input);
    expect(result.parsed.people).toHaveLength(1);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('checks authority again inside apply and persists only profile fields through its repository', async () => {
    const { service, repository, tx } = setup();
    const preview = await service.preview(input, 'session-reference', repository);
    const applied = await service.apply(input, { ...preview, sessionId: 'session-reference' }, repository);
    expect(applied.appliedPeople).toBe(1);
    expect(tx.requireDirectSuperadmin).toHaveBeenCalledTimes(2);
    expect(tx.upsertPersonWithAudit).toHaveBeenCalledWith(expect.objectContaining({ employeeCode: '001' }), null, 'synthetic-admin');
  });
  it('rejects permission revocation after preview before writing', async () => {
    const { service, repository, tx } = setup();
    const preview = await service.preview(input, 'session-reference', repository);
    vi.mocked(tx.requireDirectSuperadmin).mockRejectedValue(new Error('AUTHORITY_REVOKED'));
    await expect(service.apply(input, { ...preview, sessionId: 'session-reference' }, repository)).rejects.toThrow('AUTHORITY_REVOKED');
    expect(tx.upsertPersonWithAudit).not.toHaveBeenCalled();
  });
  it('rejects changed source or a stale snapshot', async () => {
    const { service, repository, tx } = setup();
    const preview = await service.preview(input, 'session-reference', repository);
    await expect(service.apply({ ...input, content: new Uint8Array([3]) }, { ...preview, sessionId: 'session-reference' }, repository)).rejects.toBeInstanceOf(DirectoryImportConflict);
    vi.mocked(tx.snapshot).mockResolvedValue({ version: 2, data: { identities: [], accounts: [], pendingEmails: [] } });
    await expect(service.apply(input, { ...preview, sessionId: 'session-reference' }, repository)).rejects.toBeInstanceOf(DirectoryImportConflict);
    expect(tx.upsertPersonWithAudit).not.toHaveBeenCalled();
  });
  it('does not apply identity conflicts or pending contacts as people', async () => {
    const { service, repository, tx } = setup();
    vi.mocked(tx.snapshot).mockResolvedValue({ version: 1, data: { identities: [], accounts: [{ actorId: 'another', employeeCode: 'different', email: 'person@example.test' }], pendingEmails: [] } });
    const preview = await service.preview(input, 'session-reference', repository);
    const applied = await service.apply(input, { ...preview, sessionId: 'session-reference' }, repository);
    expect(applied.preview.counts.CONFLICT).toBe(1);
    expect(applied.appliedPeople).toBe(0);
    expect(tx.upsertPersonWithAudit).not.toHaveBeenCalled();
  });
});
