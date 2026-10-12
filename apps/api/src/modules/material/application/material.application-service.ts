import {
  MATERIAL_BULK_ACTIONS,
  MATERIAL_FIELD_KEYS,
  MATERIAL_GROUPS,
  MATERIAL_LANGUAGES,
  MATERIAL_TYPES_BY_GROUP,
  hasPermission,
  parseMaterialCampaignRefs,
  parseMaterialSupplementaryLinks,
  validateCampaignRichText,
  type ActorContext,
  type MaterialBatchItemResult,
  type MaterialBatchResult,
  type MaterialBatchSaveItem,
  type MaterialBulkAction,
  type MaterialBulkActionItem,
  type MaterialFieldKey,
  type MaterialFields,
  type MaterialCampaignReference,
  type MaterialPortalBootstrap,
  type MaterialSummary,
  type Permission,
} from '@cpms/domain';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { generateMaterialCode } from './material-code';
import {
  MATERIAL_REPOSITORY,
  type MaterialRepository,
  type PersistMaterialRecord,
} from './material.repository';

const MAX_BATCH_RECORDS = 50;
const CONTENT_FIELDS = new Set<MaterialFieldKey>([
  'campaign', 'material_type', 'material_name', 'version', 'market_codes',
  'material_link', 'supplementary_link', 'status', 'material_publish', 'note',
  'campaign_code', 'campaign_name', 'vendor_id', 'visibility',
  'request_date', 'completion_date',
  'campaign_refs', 'material_group', 'material_type_other', 'description_rich_text',
  'note_rich_text', 'material_description_rich_text', 'supplementary_links', 'material_update_date', 'material_languages',
]);

interface SelectableCampaign { id: string; name: string; code: string; marketCodes: string[] }

@Injectable()
export class MaterialApplicationService {
  private readonly allowedFields = new Set<MaterialFieldKey>(MATERIAL_FIELD_KEYS);

  constructor(@Inject(MATERIAL_REPOSITORY) private readonly repository: MaterialRepository) {}

  protected async selectableCampaigns(): Promise<SelectableCampaign[]> { return []; }

  list(includeDeleted = false): Promise<MaterialSummary[]> {
    return this.repository.list(includeDeleted);
  }

  async bootstrap(): Promise<MaterialPortalBootstrap> {
    const [references, materials] = await Promise.all([
      this.repository.listReferences(['WebApp_Settings', 'Users_Roles', 'Field_Rules', 'Role_Rules', 'Campaign_Reference', 'Config']),
      this.repository.list(false),
    ]);
    const rows = (type: string) => references.filter((row) => row.type === type).map((row) => row.data);
    const settings = Object.fromEntries(rows('WebApp_Settings').flatMap((row) => row.key ? [[row.key, row.value ?? '']] : []));
    const materialTypes = this.unique(materials.map((record) => record.fields.material_type));
    const markets = this.unique(rows('Config').map((row) => row.market_code));
    return {
      settings,
      users: rows('Users_Roles'),
      fieldRules: rows('Field_Rules'),
      roleRules: rows('Role_Rules'),
      campaigns: rows('Campaign_Reference').map((row) => ({
        campaign_id: row.campaign_id || '', campaign_code: row.campaign_code || '',
        campaign_name: row.campaign_name || '', market_codes: (row.market_codes || '').split(',').filter(Boolean),
      })),
      options: {
        materialTypes,
        statuses: ['Undone', 'Done', 'Replaced', 'Cancel'],
        markets,
      },
    };
  }

  async batchSave(items: readonly MaterialBatchSaveItem[], actor: ActorContext): Promise<MaterialBatchResult> {
    this.assertBatchSize(items);
    const duplicateKeys = this.duplicates(items.map((item) => item.clientKey));
    if (duplicateKeys.length) throw new BadRequestException(`clientKey bị trùng: ${duplicateKeys.join(', ')}`);

    const materialIds = items.flatMap((item) => item.materialId ? [item.materialId] : []);
    const current = await this.repository.findByMaterialIds(materialIds);
    const currentById = new Map(current.map((record) => [record.materialId, record]));
    const campaigns = items.some((item) => item.fields.campaign_refs && item.fields.campaign_refs !== currentById.get(item.materialId || '')?.fields.campaign_refs)
      ? await this.selectableCampaigns() : [];
    const prepared: Array<{ clientKey: string; record: PersistMaterialRecord }> = [];
    const resultByKey = new Map<string, MaterialBatchItemResult>();

    for (const item of items) {
      const existing = item.materialId ? currentById.get(item.materialId) : undefined;
      const permission: Permission = existing ? 'material.update' : 'material.create';
      if (!this.canPerform(actor, permission)) {
        resultByKey.set(item.clientKey, this.failure(item, 'VALIDATION', `Thiếu quyền ${permission}.`));
        continue;
      }
      try {
        if (existing?.isDeleted) throw new BadRequestException('Hãy phục hồi tư liệu trước khi chỉnh sửa.');
        const normalized = this.normalizeFields(item.fields);
        this.assertSingleLink(existing, item.fields, normalized);
        const conflictFields = existing ? this.conflictingFields(existing, item, normalized) : [];
        if (conflictFields.length) {
          resultByKey.set(item.clientKey, {
            ...this.failure(item, 'CONFLICT', 'Record đã thay đổi ở phiên khác. Dữ liệu nhập vẫn được giữ.'),
            conflictingFields: conflictFields,
          });
          continue;
        }
        const fields = this.prepareFields(existing, normalized, actor);
        if (normalized.campaign_refs && normalized.campaign_refs !== existing?.fields.campaign_refs) this.applyCampaignSelection(fields, campaigns);
        this.validateFields(fields, existing);
        const materialId = existing?.materialId ?? await this.generateAvailableMaterialId(new Set(prepared.map((entry) => entry.record.materialId)));
        const recordVersion = (existing?.recordVersion ?? 0) + 1;
        fields.material_id = materialId;
        fields.record_version = String(recordVersion);
        fields.is_deleted = existing?.isDeleted ? 'TRUE' : 'FALSE';
        prepared.push({
          clientKey: item.clientKey,
          record: {
            materialId,
            fields,
            recordVersion,
            isDeleted: existing?.isDeleted ?? false,
            createdBy: existing?.fields.created_by || actor.key,
            updatedBy: actor.key,
          },
        });
      } catch (error) {
        resultByKey.set(item.clientKey, this.failure(item, 'VALIDATION', this.errorMessage(error)));
      }
    }

    if (prepared.length) {
      try {
        const saved = await this.repository.saveBatch(prepared.map((entry) => entry.record), actor, 'material.batch_saved');
        const savedById = new Map(saved.map((record) => [record.materialId, record]));
        for (const entry of prepared) {
          const material = savedById.get(entry.record.materialId);
          if (!material) throw new Error(`Không nhận được record ${entry.record.materialId} sau khi lưu.`);
          resultByKey.set(entry.clientKey, { clientKey: entry.clientKey, materialId: material.materialId, ok: true, material });
        }
      } catch (error) {
        for (const entry of prepared) {
          resultByKey.set(entry.clientKey, {
            clientKey: entry.clientKey,
            materialId: entry.record.materialId,
            ok: false,
            code: 'PERSISTENCE',
            message: `Không thể lưu lô: ${this.errorMessage(error)}`,
          });
        }
      }
    }

    return this.batchResult(items.map((item) => resultByKey.get(item.clientKey) ?? this.failure(item, 'PERSISTENCE', 'Không có kết quả lưu.')));
  }

  async bulkAction(items: readonly MaterialBulkActionItem[], action: MaterialBulkAction, actor: ActorContext, reason?: string): Promise<MaterialBatchResult> {
    this.assertBatchSize(items);
    if (!MATERIAL_BULK_ACTIONS.includes(action)) throw new BadRequestException('Thao tác lô không hợp lệ.');
    const permission = this.bulkPermission(action);
    if (!this.canPerform(actor, permission)) throw new ForbiddenException(`Thiếu quyền ${permission}.`);

    const current = await this.repository.findByMaterialIds(items.map((item) => item.materialId));
    const currentById = new Map(current.map((record) => [record.materialId, record]));
    const prepared: Array<{ clientKey: string; record: PersistMaterialRecord }> = [];
    const resultByKey = new Map<string, MaterialBatchItemResult>();
    for (const item of items) {
      const record = currentById.get(item.materialId);
      if (!record) {
        resultByKey.set(item.materialId, { clientKey: item.materialId, materialId: item.materialId, ok: false, code: 'VALIDATION', message: 'Không tìm thấy tư liệu.' });
        continue;
      }
      if (record.recordVersion !== item.expectedVersion) {
        resultByKey.set(item.materialId, { clientKey: item.materialId, materialId: item.materialId, ok: false, code: 'CONFLICT', message: 'Version đã thay đổi; hãy tải lại trước khi xác nhận lô.' });
        continue;
      }
      try {
        const fields = this.applyBulkAction(record, action, actor, reason);
        const recordVersion = record.recordVersion + 1;
        fields.record_version = String(recordVersion);
        prepared.push({
          clientKey: item.materialId,
          record: {
            materialId: record.materialId,
            fields,
            recordVersion,
            isDeleted: fields.is_deleted === 'TRUE',
            createdBy: record.fields.created_by || actor.key,
            updatedBy: actor.key,
          },
        });
      } catch (error) {
        resultByKey.set(item.materialId, { clientKey: item.materialId, materialId: item.materialId, ok: false, code: 'VALIDATION', message: this.errorMessage(error) });
      }
    }

    if (prepared.length) {
      try {
        const saved = await this.repository.saveBatch(prepared.map((entry) => entry.record), actor, `material.bulk_${action.toLowerCase()}`);
        const savedById = new Map(saved.map((record) => [record.materialId, record]));
        for (const entry of prepared) {
          const material = savedById.get(entry.record.materialId);
          resultByKey.set(entry.clientKey, material
            ? { clientKey: entry.clientKey, materialId: entry.clientKey, ok: true, material }
            : { clientKey: entry.clientKey, materialId: entry.clientKey, ok: false, code: 'PERSISTENCE', message: 'Không nhận được kết quả thao tác lô.' });
        }
      } catch (error) {
        for (const entry of prepared) resultByKey.set(entry.clientKey, { clientKey: entry.clientKey, materialId: entry.clientKey, ok: false, code: 'PERSISTENCE', message: this.errorMessage(error) });
      }
    }
    return this.batchResult(items.map((item) => resultByKey.get(item.materialId)!));
  }

  async purge(materialId: string, expectedVersion: number, actor: ActorContext): Promise<void> {
    if ((actor.session && actor.session.mode !== 'DIRECT') || !hasPermission(actor.roles, 'material.manage') || !hasPermission(actor.roles, 'system.manage')) {
      throw new ForbiddenException('Chỉ quản trị viên hệ thống được xóa vĩnh viễn tư liệu.');
    }
    const [current] = await this.repository.findByMaterialIds([materialId]);
    if (!current) throw new NotFoundException('Không tìm thấy tư liệu.');
    await this.repository.purge(materialId, expectedVersion, actor);
  }

  private prepareFields(existing: MaterialSummary | undefined, input: MaterialFields, actor: ActorContext): MaterialFields {
    const now = new Date().toISOString();
    const merged = { ...(existing?.fields ?? {}), ...input };
    if (!existing) {
      merged.created_by = actor.key;
      merged.created_at = now;
      merged.material_update_date = merged.material_update_date || new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
      merged.source = merged.source || 'WEB_APP';
      merged.request_id = merged.request_id || `WEB-${randomUUID()}`;
    }
    merged.updated_by = actor.key;
    merged.updated_at = now;
    merged.status = merged.status || 'Undone';
    merged.material_publish = merged.material_publish || 'Not published';
    if (!existing) {
      merged.submission_status = 'BOOKED';
      merged.approval_status = 'BOOKED';
      merged.publish_status = 'NOT_PUBLISHED';
      merged.workflow_state = 'DRAFT';
    }
    merged.visibility = merged.visibility || 'INTERNAL';
    return merged;
  }

  private conflictingFields(existing: MaterialSummary, item: MaterialBatchSaveItem, incoming: MaterialFields): MaterialFieldKey[] {
    if (item.expectedVersion === undefined || item.expectedVersion === existing.recordVersion) return [];
    if (!item.baselineFields) return Object.keys(incoming).filter((key): key is MaterialFieldKey => this.allowedFields.has(key as MaterialFieldKey));
    return Object.keys(incoming).filter((key): key is MaterialFieldKey => {
      if (!this.allowedFields.has(key as MaterialFieldKey)) return false;
      const field = key as MaterialFieldKey;
      const baseline = this.comparable(item.baselineFields?.[field]);
      const current = this.comparable(existing.fields[field]);
      const next = this.comparable(incoming[field]);
      return current !== baseline && current !== next;
    });
  }

  private normalizeFields(input: MaterialFields): MaterialFields {
    const normalized: MaterialFields = {};
    for (const [key, value] of Object.entries(input)) {
      if (!this.allowedFields.has(key as MaterialFieldKey) || !CONTENT_FIELDS.has(key as MaterialFieldKey)) continue;
      normalized[key as MaterialFieldKey] = value === null ? null : String(value).trim();
    }
    return normalized;
  }

  private assertSingleLink(existing: MaterialSummary | undefined, input: MaterialFields, normalized: MaterialFields) {
    for (const key of ['supplementary_link', 'supplementary_links', 'supplementary_link_1', 'supplementary_link_2'] as const) {
      const next = (normalized[key] ?? input[key])?.trim();
      if (!next || (key === 'supplementary_links' && next === '[]')) continue;
      if (existing && next === existing.fields[key]?.trim()) continue;
      throw new BadRequestException('Mỗi tư liệu chỉ có một Link tư liệu. Hãy tạo tư liệu riêng cho link khác.');
    }
  }

  private validateFields(fields: MaterialFields, existing?: MaterialSummary) {
    const hasContent = ['campaign', 'material_type', 'material_name', 'material_link', 'note', 'description_rich_text', 'material_description_rich_text']
      .some((key) => this.comparable(fields[key as MaterialFieldKey]));
    if (!hasContent) throw new BadRequestException('Dòng trống chưa được lưu.');
    if ((!existing || fields.material_link !== existing.fields.material_link) && !this.validWebUrl(fields.material_link || ''))
      throw new BadRequestException('Mỗi tư liệu cần một Link tư liệu http/https hợp lệ.');
    if (fields.material_group) {
      if (!(MATERIAL_GROUPS as readonly string[]).includes(fields.material_group)) throw new BadRequestException('Nhóm tư liệu không hợp lệ.');
      const choices = MATERIAL_TYPES_BY_GROUP[fields.material_group as keyof typeof MATERIAL_TYPES_BY_GROUP];
      if (fields.material_type === 'Khác' || fields.material_group === 'Khác') {
        if (!fields.material_type_other?.trim()) throw new BadRequestException('Hãy nhập loại tư liệu khác.');
      } else if (fields.material_type && !choices.includes(fields.material_type)) throw new BadRequestException('Loại tư liệu không thuộc nhóm đã chọn.');
    }
    if (fields.material_languages) {
      let values: unknown;
      try { values = JSON.parse(fields.material_languages); } catch { throw new BadRequestException('Danh sách ngôn ngữ không phải JSON hợp lệ.'); }
      if (!Array.isArray(values) || values.length > MATERIAL_LANGUAGES.length || values.some((value) => typeof value !== 'string' || !(MATERIAL_LANGUAGES as readonly string[]).includes(value)) || new Set(values).size !== values.length)
        throw new BadRequestException('Danh sách ngôn ngữ tư liệu không hợp lệ hoặc có lựa chọn trùng.');
    }
    for (const key of ['description_rich_text', 'note_rich_text', 'material_description_rich_text'] as const) {
      if (!fields[key]) continue;
      let document: unknown;
      try { document = JSON.parse(fields[key]); } catch { throw new BadRequestException(`${key} không phải JSON hợp lệ.`); }
      const errors = validateCampaignRichText(document);
      if (errors.length) throw new BadRequestException(`${key}: ${errors.join(' ')}`);
    }
    if (fields.supplementary_links) {
      const links = parseMaterialSupplementaryLinks(fields.supplementary_links);
      let parsed: unknown;
      try { parsed = JSON.parse(fields.supplementary_links); } catch { throw new BadRequestException('Danh sách link tư liệu không phải JSON hợp lệ.'); }
      if (links.length > 30 || !Array.isArray(parsed) || links.length !== parsed.length)
        throw new BadRequestException('Danh sách link tư liệu không hợp lệ hoặc vượt quá 30 link.');
      for (const link of links) {
        if (!link.label.trim() || !this.validWebUrl(link.url)) throw new BadRequestException('Mỗi link tư liệu cần tên trường và URL http/https hợp lệ.');
      }
    }
    for (const key of ['request_date', 'completion_date', 'material_update_date'] as const) {
      const value = fields[key];
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${key} phải có dạng yyyy-MM-dd.`);
      if (key === 'material_update_date' && value) {
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Ngày cập nhật không hợp lệ.');
      }
    }
  }

  private applyBulkAction(record: MaterialSummary, action: MaterialBulkAction, actor: ActorContext, reason?: string): MaterialFields {
    const fields: MaterialFields = { ...record.fields, updated_by: actor.key, updated_at: new Date().toISOString() };
    if (action === 'PUBLISH') {
      if (record.isDeleted) throw new BadRequestException('Không thể xuất bản tư liệu trong Thùng rác.');
      if (fields.publish_status === 'PUBLISHED') throw new BadRequestException('Tư liệu đã xuất bản.');
      fields.publish_status = 'PUBLISHED';
      fields.material_publish = 'Published';
    } else if (action === 'PAUSE_PUBLISH') {
      if (record.isDeleted) throw new BadRequestException('Không thể thay đổi xuất bản trong Thùng rác.');
      if (fields.publish_status !== 'PUBLISHED') throw new BadRequestException('Chỉ tư liệu Đã xuất bản mới được tạm dừng.');
      fields.publish_status = 'PAUSED';
      fields.material_publish = 'Paused';
    } else if (action === 'UNPUBLISH') {
      if (record.isDeleted) throw new BadRequestException('Không thể thay đổi xuất bản trong Thùng rác.');
      if (!['PUBLISHED', 'PAUSED'].includes(fields.publish_status || '')) throw new BadRequestException('Tư liệu chưa được xuất bản.');
      fields.publish_status = 'NOT_PUBLISHED';
      fields.material_publish = 'Not published';
    } else if (action === 'SOFT_DELETE') {
      if (record.isDeleted) throw new BadRequestException('Tư liệu đã nằm trong Thùng rác.');
      fields.is_deleted = 'TRUE';
      fields.deleted_at = new Date().toISOString();
      fields.deleted_by = actor.key;
      fields.delete_reason = reason?.trim() || 'Xóa từ Material Portal';
    } else if (action === 'RESTORE') {
      if (!record.isDeleted) throw new BadRequestException('Tư liệu chưa nằm trong Thùng rác.');
      fields.is_deleted = 'FALSE';
      fields.deleted_at = null;
      fields.deleted_by = null;
      fields.delete_reason = null;
    }
    return fields;
  }

  protected canPerform(actor: ActorContext, permission: Permission): boolean { return hasPermission(actor.roles, permission); }

  protected bulkPermission(action: MaterialBulkAction): Permission {
    if (action === 'PUBLISH' || action === 'PAUSE_PUBLISH' || action === 'UNPUBLISH') return 'material.publish';
    if (action === 'RESTORE') return 'material.restore';
    return 'material.delete';
  }

  private assertBatchSize(items: readonly unknown[]) {
    if (!items.length) throw new BadRequestException('Lô chưa có record nào.');
    if (items.length > MAX_BATCH_RECORDS) throw new BadRequestException(`Mỗi lô tối đa ${MAX_BATCH_RECORDS} record.`);
  }

  private batchResult(items: MaterialBatchItemResult[]): MaterialBatchResult {
    const succeeded = items.filter((item) => item.ok).length;
    return { ok: succeeded === items.length, total: items.length, succeeded, failed: items.length - succeeded, items };
  }

  private failure(item: MaterialBatchSaveItem, code: 'CONFLICT' | 'VALIDATION' | 'PERSISTENCE', message: string): MaterialBatchItemResult {
    return { clientKey: item.clientKey, ...(item.materialId ? { materialId: item.materialId } : {}), ok: false, code, message };
  }

  private async generateAvailableMaterialId(reserved: ReadonlySet<string>) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateMaterialCode();
      if (!reserved.has(candidate) && !(await this.repository.findByMaterialIds([candidate])).length) return candidate;
    }
    throw new BadRequestException('Không tạo được mã tư liệu duy nhất. Hãy thử lưu lại.');
  }

  private comparable(value: string | null | undefined) { return String(value ?? '').trim(); }
  private unique(values: Array<string | null | undefined>) { return [...new Set(values.map((value) => this.comparable(value)).filter(Boolean))].sort(); }
  private duplicates(values: readonly string[]) { return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]; }
  private errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Có lỗi xử lý tư liệu.'; }

  private validWebUrl(value: string) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }

  private applyCampaignSelection(fields: MaterialFields, campaigns: readonly SelectableCampaign[]) {
    let references: MaterialCampaignReference[];
    try {
      const parsed: unknown = JSON.parse(fields.campaign_refs || '[]');
      if (!Array.isArray(parsed)) throw new Error();
      references = parseMaterialCampaignRefs(fields.campaign_refs);
      if (references.length !== parsed.length || references.length > 20) throw new Error();
    } catch { throw new BadRequestException('Danh sách Chiến dịch không hợp lệ.'); }
    if (!references.length) throw new BadRequestException('Hãy chọn ít nhất một Chiến dịch hoặc Khác.');
    const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const seen = new Set<string>();
    const normalized = references.map((reference) => {
      if (seen.has(reference.id)) throw new BadRequestException('Chiến dịch bị chọn trùng.');
      seen.add(reference.id);
      if (reference.kind === 'SYSTEM') {
        const campaign = byId.get(reference.id);
        if (!campaign) throw new BadRequestException('Chiến dịch đã chọn không tồn tại hoặc không được phép xem.');
        return { kind: 'SYSTEM' as const, id: campaign.id, name: campaign.name };
      }
      const name = reference.name.trim();
      if (!reference.id.startsWith('temp:') || !name || name.length > 240) throw new BadRequestException('Tên Chiến dịch khác không hợp lệ.');
      return { kind: 'TEMPORARY' as const, id: reference.id, name };
    });
    fields.campaign_refs = JSON.stringify(normalized);
    fields.campaign = normalized.map((reference) => reference.name).join('; ');
    const selected = normalized.flatMap((reference) => reference.kind === 'SYSTEM' ? [byId.get(reference.id)!] : []);
    if (selected.length) {
      selected.sort((a, b) => b.marketCodes.length - a.marketCodes.length || a.id.localeCompare(b.id));
      fields.market_codes = [...new Set(selected[0]!.marketCodes)].join(',');
      fields.market_source_campaign_id = selected[0]!.id;
    } else {
      fields.market_source_campaign_id = null;
    }
  }
}
