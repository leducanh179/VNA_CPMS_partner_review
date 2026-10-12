import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ActorContext, QcttCatalogEntry, QcttCatalogKind, QcttCatalogView } from '@cpms/domain';
import { validateQcttCatalog } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { QcttCatalogRepository } from './qctt-catalog.repository';
import { qcttCatalogCommand, qcttCatalogImport } from './qctt-catalog.commands';
const parse = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown): T => {
  const r = schema.safeParse(body); if (!r.success) throw new BadRequestException(r.error!.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data!;
};
@Injectable()
export class QcttCatalogApplicationService {
  constructor(@Inject(QcttCatalogRepository) private readonly repository: QcttCatalogRepository,
    @Inject(AccessApplicationService) private readonly access: AccessApplicationService) {}
  private async reader() {
    const who = this.access.snapshot();
    if (!who.identity.effectiveActive || !who.identity.profileComplete || !who.identity.effectiveSuperadmin && !await this.repository.internalReader(who.actor.id)) throw new ForbiddenException('Danh mục QCTT dành cho nhân sự CPMS.');
  }
  read(actor?: ActorContext): Promise<QcttCatalogView> { return this.access.run(actor, async () => {
    await this.reader(); return { schemaVersion: 1, entries: await this.repository.entries(), recordVersion: await this.repository.version(),
      organizations: await this.repository.organizations(), capabilities: { manage: this.access.check('catalog.manage').allowed, purge: this.access.check('catalog.purge').allowed } };
  }); }
  usage(code: string, actor?: ActorContext) { return this.access.run(actor, async () => { this.access.require('catalog.manage'); return this.repository.usage(code); }); }
  history(code: string, actor?: ActorContext) { return this.access.run(actor, async () => { await this.reader(); return this.repository.history(code); }); }
  private async digest(key: string, body: unknown) {
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const receipt = await this.repository.receipt(this.access.snapshot().actor.id,key);
    if (receipt && receipt.digest !== digest) throw new ConflictException('Mã thao tác đã được dùng cho nội dung khác.');
    return { digest, receipt };
  }
  async command(raw: unknown, actor?: ActorContext) {
    const input = parse(qcttCatalogCommand,raw);
    return this.access.run(actor, async () => {
      this.access.require(input.action === 'PURGE' ? 'catalog.purge' : 'catalog.manage');
      const who = this.access.snapshot().actor, { digest, receipt } = await this.digest(input.idempotencyKey,input);
      if (receipt) return receipt.result;
      const before = await this.repository.entries(), after = [...before], reserved = await this.repository.reservedCodes();
      const seen = new Set<string>(), changes: { before: QcttCatalogEntry | null; after: QcttCatalogEntry | null }[] = [];
      const now = new Date().toISOString();
      for (const item of input.items) {
        const old = item.code ? before.find(e => e.code === item.code) ?? null : null;
        if (item.expectedVersion > 0 && !old) throw new NotFoundException('Không tìm thấy mục danh mục.');
        if ((old?.recordVersion ?? 0) !== item.expectedVersion) throw new ConflictException(`${item.code ?? 'Dòng mới'} đã thay đổi; tải lại trước khi lưu.`);
        if (item.code && (seen.has(item.code) || reserved.includes(item.code))) throw new BadRequestException('Mã bị trùng hoặc đã được sử dụng trước đây.');
        let next: QcttCatalogEntry | null;
        if (input.action === 'SAVE' && 'fields' in item) {
          if (old?.deletedAt) throw new BadRequestException('Khôi phục mục trước khi sửa.');
          if (old && old.kind !== item.kind) throw new BadRequestException('Không được đổi loại danh mục của mã đã lưu.');
          const code = old?.code ?? item.code ?? this.nextCode(item.kind,[...after.map(e => e.code),...reserved]);
          if (!/^[A-Z][A-Z0-9_-]{1,99}$/.test(code)) throw new BadRequestException('Mã chỉ gồm chữ hoa, số, dấu gạch ngang và gạch dưới.');
          if (old && old.kind === 'ACTIVITY' && ['layerCode','channelCode','supplyType'].some(k => old[k as keyof QcttCatalogEntry] !== item.fields[k as keyof typeof item.fields]) && (await this.repository.usage(code)).some(u => u.category !== 'Danh mục phụ thuộc' && u.count > 0)) throw new BadRequestException(`${code} đã được sử dụng. Tạo Phương tiện thay thế để đổi phân loại/loại media; hồ sơ cũ phải giữ nguyên.`);
          const org = item.fields.ownerOrgId ? (await this.repository.organizations()).find(o => o.id === item.fields.ownerOrgId) : null;
          if (item.fields.ownerOrgId && !org) throw new BadRequestException('CQĐV không còn hoạt động.');
          next = { ...item.fields, ownerOrgName: org?.name ?? item.fields.ownerOrgName, code, kind: item.kind,
            recordVersion: (old?.recordVersion ?? 0)+1, source: old?.source ?? { origin: 'CPMS' }, deletedAt: null,
            createdAt: old?.createdAt ?? now, updatedAt: now };
        } else {
          if (!old) throw new NotFoundException('Không tìm thấy mục danh mục.');
          if (input.action === 'TRASH' && old.deletedAt || input.action !== 'TRASH' && !old.deletedAt) throw new BadRequestException('Trạng thái Thùng rác không phù hợp.');
          if (input.action === 'PURGE' && (await this.repository.usage(old.code)).some(u => u.count > 0)) throw new BadRequestException(`${old.code} còn được sử dụng trong nghiệp vụ hoặc danh mục phụ thuộc; hãy ngừng sử dụng thay vì xóa vĩnh viễn.`);
          next = input.action === 'PURGE' ? null : { ...old, deletedAt: input.action === 'TRASH' ? now : null, recordVersion: old.recordVersion+1, updatedAt: now };
        }
        const code = next?.code ?? old!.code; seen.add(code);
        const index = after.findIndex(e => e.code === code); if (index >= 0) after.splice(index,1); if (next) after.push(next);
        changes.push({ before: old, after: next });
      }
      const errors = validateQcttCatalog(after); if (errors.length) throw new BadRequestException(errors.join('\n'));
      // Parent entries are persisted before their descendants, including pasted multi-kind commands.
      changes.sort((a,b) => this.rank(a.after?.kind ?? a.before!.kind)-this.rank(b.after?.kind ?? b.before!.kind));
      for (const c of changes) if (c.after) await this.repository.save(c.after,c.before,who,`catalog.${input.action.toLowerCase()}`); else await this.repository.purge(c.before!,who);
      const result = { schemaVersion: 1, recordVersion: await this.repository.version(), codes: changes.map(c => c.after?.code ?? c.before!.code) };
      await this.repository.finish(who,input.idempotencyKey,digest,result); return result;
    });
  }
  private rank(kind: QcttCatalogKind) { return ['LAYER','CHANNEL','PILLAR','ACTIVITY','TOPIC'].indexOf(kind); }
  private nextCode(kind: QcttCatalogKind, codes: string[]) {
    const prefix = { LAYER:'PFL',CHANNEL:'CHN',ACTIVITY:'ATV',PILLAR:'PIL',TOPIC:'TOP' }[kind];
    const numbers = codes.filter(c => c.startsWith(prefix+'-')).map(c => Number(c.slice(prefix.length+1))).filter(Number.isFinite);
    return `${prefix}-${String(Math.max(0,...numbers)+1).padStart(3,'0')}`;
  }
  async import(raw: unknown, apply: boolean, actor?: ActorContext) {
    const input = parse(qcttCatalogImport,raw);
    return this.access.run(actor,async () => {
      this.access.require('catalog.manage');
      const { digest, receipt } = await this.digest(input.idempotencyKey,input); if (apply && receipt) return receipt.result;
      if (input.expectedVersion !== await this.repository.version()) throw new ConflictException('Danh mục đã thay đổi; lập lại bản xem trước.');
      const current = await this.repository.entries(), reserved = await this.repository.reservedCodes(), proposed = [...current];
      const codes = input.items.map(e => e.code); if (new Set(codes).size !== codes.length || codes.some(c => !c || reserved.includes(c))) throw new BadRequestException('Mã nhập bị trùng, thiếu hoặc đã bị xóa.');
      const now = new Date().toISOString(), changes: { before: QcttCatalogEntry | null; after: QcttCatalogEntry }[] = [];
      for (const item of input.items) {
        if (!['LAYER','CHANNEL','ACTIVITY'].includes(item.kind) || item.fields.description || item.fields.note || item.fields.unit || item.kind === 'ACTIVITY' && item.fields.ownerOrgName !== 'Ban TT') throw new BadRequestException('Đợt nhập chỉ nhận Phương tiện Ban TT, lớp/kênh và không nhận các cột mô tả.');
        const old = current.find(e => e.code === item.code) ?? null;
        if (old?.deletedAt || old && old.kind !== item.kind || (old?.recordVersion ?? 0) !== item.expectedVersion) throw new ConflictException(`${item.code}: trạng thái hoặc phiên bản đã thay đổi.`);
        if (old && old.status === 'ACTIVE' && ['layerCode','channelCode','supplyType'].some(k => old[k as keyof QcttCatalogEntry] !== item.fields[k as keyof typeof item.fields]) && (await this.repository.usage(old.code)).some(u => u.count)) throw new BadRequestException(`${item.code}: không đổi phân loại đang được sử dụng.`);
        const after: QcttCatalogEntry = { ...item.fields, code: item.code!, kind: item.kind, recordVersion:(old?.recordVersion ?? 0)+1, deletedAt:null, createdAt:old?.createdAt ?? now, updatedAt:now,
          source:{ origin:'GOOGLE_SHEET',url:input.sourceUrl,capturedAt:input.capturedAt,reference:item.sourceReference,needsConfirmation:item.needsConfirmation } };
        const index = proposed.findIndex(e => e.code === after.code); if (index >= 0) proposed.splice(index,1); proposed.push(after); changes.push({before:old,after});
      }
      const errors = validateQcttCatalog(proposed); if (errors.length) throw new BadRequestException(errors.join('\n'));
      const result = { schemaVersion:1, activities:changes.filter(c => c.after.kind === 'ACTIVITY').length, created:changes.filter(c => !c.before).length,
        updated:changes.filter(c => c.before).length, preserved:current.filter(c => !codes.includes(c.code)).length, recordVersion:await this.repository.version() };
      if (apply) {
        for (const change of changes.sort((a,b)=>this.rank(a.after.kind)-this.rank(b.after.kind))) await this.repository.save(change.after,change.before,this.access.snapshot().actor,'catalog.import');
        result.recordVersion = await this.repository.version(); await this.repository.finish(this.access.snapshot().actor,input.idempotencyKey,digest,result);
      }
      return result;
    });
  }
}
