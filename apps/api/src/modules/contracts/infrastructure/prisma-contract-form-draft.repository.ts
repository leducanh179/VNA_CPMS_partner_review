import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ContractFormDraftRepository, type ContractFormDraftData, type ContractFormDraftValue } from '../application/contract-form-draft.repository';

@Injectable()
export class PrismaContractFormDraftRepository extends ContractFormDraftRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }

  list(ownerActorId: string) {
    return this.prisma.database.contractFormDraft.findMany({ where: { ownerActorId }, select: { id: true, kind: true, title: true, activityCode: true, recordVersion: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  async get(id: string, ownerActorId: string): Promise<ContractFormDraftData | null> {
    const row = await this.prisma.database.contractFormDraft.findFirst({ where: { id, ownerActorId } });
    return row ? { ...row, formData: row.formData as ContractFormDraftValue } : null;
  }

  async save(id: string, value: ContractFormDraftValue, expectedVersion: number, actor: ActorContext): Promise<ContractFormDraftData> {
    return this.prisma.inTransaction(async (tx) => {
      const current = await tx.contractFormDraft.findUnique({ where: { id } });
      if (current && current.ownerActorId !== actor.id) throw new NotFoundException('Không tìm thấy bản nhập dở.');
      if (current?.recordVersion !== expectedVersion && !(current === null && expectedVersion === 0)) throw new ConflictException('Bản nhập dở đã được sửa ở phiên khác. Hãy tải lại.');
      const title = String(value.fields.name ?? '').trim().slice(0, 500);
      const data = { kind: value.kind, activityCode: value.kind === 'OWNED_ACTIVITY' ? value.activityCode ?? null : null, title, formData: value as Prisma.InputJsonValue };
      const row = current
        ? await tx.contractFormDraft.update({ where: { id, recordVersion: expectedVersion }, data: { ...data, recordVersion: { increment: 1 } } })
        : await tx.contractFormDraft.create({ data: { id, ownerActorId: actor.id, ...data } });
      await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: current ? 'contract.form_draft_updated' : 'contract.form_draft_created', entityType: 'contract_form_draft', entityId: id, payload: { recordVersion: row.recordVersion, kind: row.kind } } });
      return { ...row, formData: row.formData as ContractFormDraftValue };
    });
  }

  async remove(id: string, ownerActorId: string, actor: ActorContext): Promise<boolean> {
    return this.prisma.inTransaction(async (tx) => {
      const result = await tx.contractFormDraft.deleteMany({ where: { id, ownerActorId } });
      if (result.count) await tx.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id, contextMode: actor.session?.mode ?? 'DIRECT', action: 'contract.form_draft_removed', entityType: 'contract_form_draft', entityId: id, payload: {} } });
      return result.count > 0;
    });
  }
}
