import { DEMO_ACTOR, type MaterialCommentItem } from '@cpms/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AccessApplicationService } from '../../access/application/access.application-service';
import { MaterialCollaborationApplicationService } from './material-collaboration.application-service';
import type { MaterialCollaborationRepository } from './material-collaboration.repository';

const comment: MaterialCommentItem = {
  id: 'comment-1', materialId: 'MAT-1', authorActorId: DEMO_ACTOR.id, authorName: 'Demo', body: 'Nội dung',
  parentId: null, recordVersion: 1, createdAt: '2026-10-03T00:00:00Z', editedAt: null, deletedAt: null,
};

function setup(exists = true) {
  const access = {
    run: (_actor: unknown, operation: () => Promise<unknown>) => operation(),
    require: vi.fn(), check: vi.fn(() => ({ allowed: true })),
  } as unknown as AccessApplicationService;
  const repository: MaterialCollaborationRepository = {
    materialExists: vi.fn(async () => exists),
    listComments: vi.fn(async () => [comment]),
    listJournal: vi.fn(async () => []),
    createComment: vi.fn(async () => comment),
    updateComment: vi.fn(async () => comment),
    deleteComment: vi.fn(async () => comment),
  };
  return { service: new MaterialCollaborationApplicationService(repository, access), repository, access };
}

describe('MaterialCollaborationApplicationService', () => {
  it('reads material comments and requires material permission', async () => {
    const { service, repository, access } = setup();
    expect(await service.comments('MAT-1')).toEqual([comment]);
    expect(repository.listComments).toHaveBeenCalledWith('MAT-1');
    expect(access.require).toHaveBeenCalledWith('material.read');
  });

  it('rejects comments for a missing material and empty content', async () => {
    await expect(setup(false).service.comments('MISSING')).rejects.toThrow('Không tìm thấy tư liệu');
    const { service, repository } = setup();
    await expect(service.create('MAT-1', '  ', null, DEMO_ACTOR)).rejects.toThrow('Bình luận cần');
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it('sends comment mutations through the repository with actor and version', async () => {
    const { service, repository } = setup();
    await service.create('MAT-1', '  Nội dung  ', null, DEMO_ACTOR);
    expect(repository.createComment).toHaveBeenCalledWith('MAT-1', 'Nội dung', null, DEMO_ACTOR);
    await service.update('MAT-1', 'comment-1', ' Sửa ', 1, DEMO_ACTOR);
    expect(repository.updateComment).toHaveBeenCalledWith('MAT-1', 'comment-1', 'Sửa', 1, DEMO_ACTOR, true);
    await service.remove('MAT-1', 'comment-1', 1, DEMO_ACTOR);
    expect(repository.deleteComment).toHaveBeenCalledWith('MAT-1', 'comment-1', 1, DEMO_ACTOR, true);
  });
});
