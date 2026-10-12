import type { ActorContext, MaterialCommentItem, MaterialJournalItem } from '@cpms/domain';

export const MATERIAL_COLLABORATION_REPOSITORY = Symbol('MATERIAL_COLLABORATION_REPOSITORY');

export interface MaterialCollaborationRepository {
  materialExists(materialId: string): Promise<boolean>;
  listComments(materialId: string): Promise<MaterialCommentItem[]>;
  listJournal(materialId: string): Promise<MaterialJournalItem[]>;
  createComment(materialId: string, body: string, parentId: string | null, actor: ActorContext): Promise<MaterialCommentItem>;
  updateComment(materialId: string, id: string, body: string, expectedVersion: number, actor: ActorContext, canManage: boolean): Promise<MaterialCommentItem>;
  deleteComment(materialId: string, id: string, expectedVersion: number, actor: ActorContext, canManage: boolean): Promise<MaterialCommentItem>;
}
