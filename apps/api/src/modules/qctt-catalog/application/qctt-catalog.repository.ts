import type { ActorContext, QcttCatalogEntry } from '@cpms/domain';

export abstract class QcttCatalogRepository {
  abstract entries(): Promise<QcttCatalogEntry[]>;
  abstract version(): Promise<number>;
  abstract organizations(): Promise<{ id: string; name: string }[]>;
  abstract internalReader(actorId: string): Promise<boolean>;
  abstract reservedCodes(): Promise<string[]>;
  abstract usage(code: string): Promise<{ category: string; count: number }[]>;
  abstract save(next: QcttCatalogEntry, before: QcttCatalogEntry | null, actor: ActorContext, action: string): Promise<void>;
  abstract purge(before: QcttCatalogEntry, actor: ActorContext): Promise<void>;
  abstract finish(actor: ActorContext, key: string, digest: string, result: unknown): Promise<void>;
  abstract receipt(actorId: string, key: string): Promise<{ digest: string; result: unknown } | null>;
  abstract history(code: string): Promise<unknown[]>;
}
