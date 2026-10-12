import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CampaignFormDraftRepository, type CampaignFormDraftData } from '../application/campaign-form-draft.repository';

@Injectable()
export class PrismaCampaignFormDraftRepository extends CampaignFormDraftRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  async list(ownerActorId: string) {
    return this.prisma.database.campaignFormDraft.findMany({ where: { ownerActorId }, select: { id: true, title: true, levelCode: true, recordVersion: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  async get(id: string, ownerActorId: string): Promise<CampaignFormDraftData | null> {
    const row = await this.prisma.database.campaignFormDraft.findFirst({ where: { id, ownerActorId } });
    return row ? { ...row, formData: row.formData as Record<string, unknown> } : null;
  }

  async save(id: string, value: Record<string, unknown>, expectedVersion: number, actor: ActorContext): Promise<CampaignFormDraftData> {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.campaignFormDraft.findUnique({ where: { id } });
      if (current && current.ownerActorId !== actor.id) throw new NotFoundException('Không tìm thấy bản nhập dở.');
      if (current?.recordVersion !== expectedVersion && !(current === null && expectedVersion === 0)) throw new ConflictException('Bản nhập dở đã được chỉnh sửa ở phiên khác. Hãy tải lại trước khi tiếp tục.');
      const title = typeof value.name === 'string' ? value.name.trim().slice(0, 500) : '';
      const levelCode = typeof value.levelCode === 'string' ? value.levelCode : null;
      const row = current
        ? await tx.campaignFormDraft.update({ where: { id, recordVersion: expectedVersion }, data: { title, levelCode, formData: value as Prisma.InputJsonValue, recordVersion: { increment: 1 } } })
        : await tx.campaignFormDraft.create({ data: { id, ownerActorId: actor.id, title, levelCode, formData: value as Prisma.InputJsonValue } });
      await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: current ? 'campaign.form_draft_updated' : 'campaign.form_draft_created', entityType: 'campaign_form_draft', entityId: id, payload: { recordVersion: row.recordVersion } } });
      return { ...row, formData: row.formData as Record<string, unknown> };
    });
  }

  async remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean> {
    return this.prisma.inTransaction(async (tx) => {
      const result = await tx.campaignFormDraft.deleteMany({ where: { id, ownerActorId } });
      if (result.count) await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'campaign.form_draft_removed', entityType: 'campaign_form_draft', entityId: id, payload: {} } });
      return result.count > 0;
    });
  }
}
