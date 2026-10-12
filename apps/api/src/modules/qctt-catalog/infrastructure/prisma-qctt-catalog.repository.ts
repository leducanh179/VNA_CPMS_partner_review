import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ActorContext, QcttCatalogEntry } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QcttCatalogRepository } from '../application/qctt-catalog.repository';
const wire = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
@Injectable()
export class PrismaQcttCatalogRepository extends QcttCatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { super(); }
  private get db() { return this.prisma.database; }
  async entries() {
    const rows = await this.db.$queryRaw<QcttCatalogEntry[]>`SELECT code,kind,name,status,layer_code AS "layerCode",channel_code AS "channelCode",
      parent_code AS "parentCode",owner_org_id AS "ownerOrgId",owner_org_name AS "ownerOrgName",supply_type AS "supplyType",year,
      effective_from AS "effectiveFrom",effective_to AS "effectiveTo",sort_order AS "sortOrder",description,unit,note,source,
      record_version AS "recordVersion",deleted_at AS "deletedAt",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM qctt_catalog_entries ORDER BY sort_order,code`;
    return wire<QcttCatalogEntry[]>(rows).map(e => ({ ...e, effectiveFrom: e.effectiveFrom?.slice(0,10) ?? null, effectiveTo: e.effectiveTo?.slice(0,10) ?? null }));
  }
  async version() { const rows = await this.db.$queryRaw<{ version: number }[]>`SELECT record_version AS version FROM qctt_catalog_state WHERE key='qctt'`; return rows[0]!.version; }
  async organizations() { return this.db.$queryRaw<{ id: string; name: string }[]>`SELECT id,source_name AS name FROM employment_org_units WHERE kind='DEPARTMENT' AND is_active=true ORDER BY source_name`; }
  async internalReader(actorId: string) { return Boolean(await this.db.employmentMembership.findUnique({ where: { actorId } })); }
  async reservedCodes() { return (await this.db.$queryRaw<{ code: string }[]>`SELECT code FROM qctt_catalog_reserved_codes`).map(e => e.code); }
  async usage(code: string) {
    const rows = await this.db.$queryRaw<{ category: string; count: bigint }[]>`WITH catalog_references AS (
      SELECT 'Chiến dịch' AS category, field_values AS data FROM campaigns
      UNION ALL SELECT 'Lịch sử Chiến dịch',subject_snapshot FROM campaign_workflow_revisions
      UNION ALL SELECT 'Yêu cầu Chiến dịch',payload || before_snapshot FROM campaign_change_requests
      UNION ALL SELECT 'Kế hoạch QCTT',jsonb_build_object('professionLayer',profession_layer,'channelCode',channel_code,'activityCode',activity_code) || COALESCE(classification,'{}') FROM qctt_plan_items
      UNION ALL SELECT 'Lịch sử Kế hoạch QCTT',data FROM qctt_plan_item_revisions
      UNION ALL SELECT 'Hợp đồng / Owned media',source FROM supply_contracts
      UNION ALL SELECT 'Lịch sử hợp đồng',snapshot FROM supply_contract_revisions
      UNION ALL SELECT 'Yêu cầu hợp đồng',fields FROM supply_contract_change_requests
      UNION ALL SELECT 'Slot',source FROM supply_slots
      UNION ALL SELECT 'Hạng mục hợp đồng',effective || COALESCE(baseline,'{}') FROM supply_item_terms
      UNION ALL SELECT 'Booking',COALESCE(contract_snapshot,'{}') || COALESCE(workflow,'{}') FROM booking_records
      UNION ALL SELECT 'Lịch sử Booking',data FROM booking_revisions
      UNION ALL SELECT 'Nhật ký nghiệp vụ',payload FROM audit_events WHERE entity_type IN ('campaign','contract','booking')
    ) SELECT category,count(*) AS count FROM catalog_references
    WHERE jsonb_path_exists(data,'$.** ? (@ == $code)',jsonb_build_object('code',${code}::text)) GROUP BY category`;
    const children = (await this.entries()).filter(e => e.layerCode === code || e.channelCode === code || e.parentCode === code).length;
    return [...rows.map(r => ({ category: r.category, count: Number(r.count) })), ...(children ? [{ category: 'Danh mục phụ thuộc', count: children }] : [])];
  }
  async save(next: QcttCatalogEntry, before: QcttCatalogEntry | null, actor: ActorContext, action: string) {
    await this.db.$executeRaw`INSERT INTO qctt_catalog_entries(code,kind,name,status,layer_code,channel_code,parent_code,owner_org_id,owner_org_name,
      supply_type,year,effective_from,effective_to,sort_order,description,unit,note,source,record_version,deleted_at,created_at,updated_at)
      VALUES (${next.code},${next.kind},${next.name},${next.status},${next.layerCode},${next.channelCode},${next.parentCode},${next.ownerOrgId}::uuid,
      ${next.ownerOrgName},${next.supplyType},${next.year},${next.effectiveFrom}::date,${next.effectiveTo}::date,${next.sortOrder},${next.description},
      ${next.unit},${next.note},${JSON.stringify(next.source)}::jsonb,${next.recordVersion},${next.deletedAt}::timestamptz,${next.createdAt}::timestamptz,${next.updatedAt}::timestamptz)
      ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,layer_code=EXCLUDED.layer_code,channel_code=EXCLUDED.channel_code,
      parent_code=EXCLUDED.parent_code,owner_org_id=EXCLUDED.owner_org_id,owner_org_name=EXCLUDED.owner_org_name,supply_type=EXCLUDED.supply_type,
      year=EXCLUDED.year,effective_from=EXCLUDED.effective_from,effective_to=EXCLUDED.effective_to,sort_order=EXCLUDED.sort_order,
      description=EXCLUDED.description,unit=EXCLUDED.unit,note=EXCLUDED.note,source=EXCLUDED.source,record_version=EXCLUDED.record_version,
      deleted_at=EXCLUDED.deleted_at,updated_at=EXCLUDED.updated_at`;
    await this.audit(next.code, next.recordVersion, before, next, actor, action);
    await this.db.$executeRaw`UPDATE qctt_catalog_state SET record_version=record_version+1 WHERE key='qctt'`;
  }
  async purge(before: QcttCatalogEntry, actor: ActorContext) {
    await this.db.$executeRaw`INSERT INTO qctt_catalog_reserved_codes(code,kind) VALUES (${before.code},${before.kind})`;
    await this.db.$executeRaw`DELETE FROM qctt_catalog_entries WHERE code=${before.code}`;
    await this.audit(before.code,before.recordVersion+1,before,null,actor,'catalog.purge');
    await this.db.$executeRaw`UPDATE qctt_catalog_state SET record_version=record_version+1 WHERE key='qctt'`;
  }
  private async audit(code: string, version: number, before: QcttCatalogEntry | null, after: QcttCatalogEntry | null, actor: ActorContext, action: string) {
    const data = JSON.stringify({ before, after });
    await this.db.$executeRaw`INSERT INTO qctt_catalog_revisions(id,code,version,actor_id,action,data) VALUES (${randomUUID()}::uuid,${code},${version},${actor.id}::uuid,${action},${data}::jsonb)`;
    await this.db.auditEvent.create({ data: { actorId: actor.id, originalActorId: actor.session?.originalActorId ?? actor.id,
      contextMode: actor.session?.mode ?? 'DIRECT', entityType: 'qctt-catalog', entityId: code, action, payload: JSON.parse(data) } });
  }
  async finish(actor: ActorContext, key: string, digest: string, result: unknown) {
    await this.db.$executeRaw`INSERT INTO qctt_catalog_commands(id,actor_id,key,digest,result) VALUES (${randomUUID()}::uuid,${actor.id}::uuid,${key},${digest},${JSON.stringify(result)}::jsonb)`;
  }
  async receipt(actorId: string, key: string) { return (await this.db.$queryRaw<{ digest: string; result: unknown }[]>`SELECT digest,result FROM qctt_catalog_commands WHERE actor_id=${actorId}::uuid AND key=${key}`)[0] ?? null; }
  async history(code: string) { return wire<unknown[]>(await this.db.$queryRaw`SELECT r.version,r.action,r.data,r.created_at AS "createdAt",a.display_name AS "actorName" FROM qctt_catalog_revisions r JOIN actors a ON a.id=r.actor_id WHERE r.code=${code} ORDER BY r.version DESC LIMIT 100`); }
}
