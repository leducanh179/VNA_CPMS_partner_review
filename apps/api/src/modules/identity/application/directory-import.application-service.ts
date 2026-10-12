import {
  parsePersonnelDirectory, previewPersonnelImport, type DirectoryImportSnapshot,
  type DirectorySourceRow, type PendingDirectoryContact,
} from '@cpms/domain';
import type { SpreadsheetDocumentPort } from '@cpms/integrations';
import { createHash } from 'node:crypto';

export interface DirectoryTransaction {
  /** Recheck server session, original/effective identity and direct superadmin inside the lock. */
  requireDirectSuperadmin(sessionId: string): Promise<{ actorId: string }>;
  snapshot(): Promise<{ version: number; data: DirectoryImportSnapshot }>;
  /** Only the whitelisted profile fields are writable. Preserve existing other PII, roles, credentials and history. */
  upsertPersonWithAudit(person: DirectorySourceRow, expectedVersion: number | null, actorId: string): Promise<void>;
  /** A pending contact is never an Actor or credential. */
  upsertPendingWithAudit(contact: PendingDirectoryContact, actorId: string): Promise<void>;
}
export interface DirectoryImportRepository {
  /** PostgreSQL adapter must lock/fence the source namespace, identity links and authorizing session.
   * Transaction rollback must cover both profile updates and append-only audit writes. */
  withImportTransaction<T>(operation: (transaction: DirectoryTransaction) => Promise<T>): Promise<T>;
}
export class DirectoryImportConflict extends Error {}

/** Reuses the existing provider-neutral XLSX port. Not exposed as an unauthenticated HTTP endpoint. */
export class DirectoryImportApplicationService {
  constructor(private readonly spreadsheets: Pick<SpreadsheetDocumentPort, 'read'>) {}

  async inspect(input: { fileName: string; content: Uint8Array }) {
    if (!input.fileName.toLowerCase().endsWith('.xlsx')) throw new Error('Personnel source must be XLSX.');
    if (!input.content.length || input.content.length > 10 * 1024 * 1024) throw new Error('Personnel source size is outside the supported limit.');
    const workbook = await this.spreadsheets.read(input);
    if (workbook.sheets.length > 20 || workbook.sheets.some((sheet) => sheet.rows.length > 10_000 || sheet.rows.some((row) => row.length > 100))) {
      throw new Error('Personnel source dimensions exceed the supported limit.');
    }
    const parsed = parsePersonnelDirectory(workbook);
    if (!parsed.sheets.some((sheet) => sheet.kind === 'PERSONNEL')) throw new Error('No complete personnel header was found.');
    return { sourceHash: createHash('sha256').update(input.content).digest('hex'), parsed };
  }

  async preview(input: { fileName: string; content: Uint8Array }, sessionId: string, repository: DirectoryImportRepository) {
    const source = await this.inspect(input);
    return repository.withImportTransaction(async (transaction) => {
      await transaction.requireDirectSuperadmin(sessionId);
      const snapshot = await transaction.snapshot();
      return { sourceHash: source.sourceHash, expectedSnapshotVersion: snapshot.version,
        preview: previewPersonnelImport(source.parsed, snapshot.data) };
    });
  }

  async apply(
    input: { fileName: string; content: Uint8Array },
    confirmation: { sourceHash: string; expectedSnapshotVersion: number; sessionId: string },
    repository: DirectoryImportRepository,
  ) {
    const source = await this.inspect(input);
    if (source.sourceHash !== confirmation.sourceHash) throw new DirectoryImportConflict('Source changed after preview.');
    return repository.withImportTransaction(async (transaction) => {
      const actor = await transaction.requireDirectSuperadmin(confirmation.sessionId);
      const snapshot = await transaction.snapshot();
      if (snapshot.version !== confirmation.expectedSnapshotVersion) throw new DirectoryImportConflict('Directory changed after preview.');
      const preview = previewPersonnelImport(source.parsed, snapshot.data);
      let appliedPeople = 0;
      let appliedPending = 0;
      for (const item of preview.items) {
        if (item.person && (item.status === 'CREATE' || item.status === 'UPDATE')) {
          await transaction.upsertPersonWithAudit(item.person, item.expectedVersion, actor.actorId);
          appliedPeople++;
        } else if (item.pending && item.status === 'PENDING') {
          await transaction.upsertPendingWithAudit(item.pending, actor.actorId);
          appliedPending++;
        }
      }
      return { sourceHash: source.sourceHash, preview, appliedPeople, appliedPending };
    });
  }
}
