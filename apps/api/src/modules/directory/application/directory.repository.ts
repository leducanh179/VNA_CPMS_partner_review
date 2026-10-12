import type { ActorContext, DirectoryPerson, PersonalNoteView, SupplierView } from '@cpms/domain';
import type { PersonnelDirectorySnapshot } from '@cpms/integrations';

export abstract class DirectoryRepository {
  abstract people(): Promise<DirectoryPerson[]>;
  abstract syncStatus(): Promise<unknown[]>;
  abstract sync(input: PersonnelDirectorySnapshot, digest: string, apply: boolean, actor: ActorContext): Promise<unknown>;
  abstract suppliers(): Promise<SupplierView[]>;
  abstract saveSupplier(value: SupplierView, previous: SupplierView | null, actor: ActorContext): Promise<SupplierView>;
  abstract canMaintainSuppliers(actorId: string, enforce?: boolean): Promise<boolean>;
  abstract notes(actorId: string): Promise<PersonalNoteView[]>;
  abstract saveNote(value: PersonalNoteView, previous: PersonalNoteView | null, actor: ActorContext): Promise<PersonalNoteView>;
  abstract deleteNote(value: PersonalNoteView, actor: ActorContext): Promise<void>;
}
