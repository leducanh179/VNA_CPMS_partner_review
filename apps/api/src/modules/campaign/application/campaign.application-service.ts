import type {
  ActorContext, CampaignAdditionalInformationItem, CampaignAuditChange, CampaignBatchResult, CampaignBatchSaveItem,
  CampaignChangeSource,
  CampaignDeleteResult, CampaignFieldValues, CampaignLifecycleState, CampaignRequestingUnitInput,
  CampaignSummary, CampaignV2Fields, CreateCampaignCommand, SimilarCampaignSummary, UpdateCampaignCommand,
} from '@cpms/domain';
import { createCampaignCodeCandidate, createCampaignCodeCandidateForPrefix, isCampaignCodeCompliant, validateCampaignRichText } from '@cpms/domain';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CatalogApplicationService } from '../../catalog/application/catalog.application-service';
import {
  CAMPAIGN_REPOSITORY, CampaignCodeConflictError, CampaignVersionConflictError, type CampaignRepository,
  type PersistCampaignMarket, type PersistCampaignRequestingUnit,
} from './campaign.repository';

@Injectable()
export class CampaignApplicationService {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly repository: CampaignRepository,
    @Inject(CatalogApplicationService) private readonly catalogs: CatalogApplicationService,
  ) {}

  list(trash = false): Promise<CampaignSummary[]> { return this.repository.list(trash); }

  async get(id: string): Promise<CampaignSummary> {
    const campaign = await this.repository.findById(id);
    if (!campaign) throw new NotFoundException('Không tìm thấy chiến dịch.');
    return campaign;
  }

  async create(command: CreateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    const name = command.name.trim();
    if (!name) throw new BadRequestException('Tên chiến dịch là bắt buộc.');
    if (!command.levelCode) throw new BadRequestException('Cấp độ chiến dịch là bắt buộc.');
    await this.requireLevel(command.levelCode);
    this.assertDateRange(command.startDate, command.endDate, 'Thời gian QCTT');
    this.assertDateRange(command.effectiveStartDate, command.effectiveEndDate, 'Thời gian hiệu lực');
    await this.validateV2Fields(command);

    const code = command.code?.trim().toUpperCase()
      || await this.uniqueCode(() => createCampaignCodeCandidate(new Date(), randomInt));
    if (command.code && !['XLSX_CSV', 'GOOGLE_SHEETS', 'IMPORTER'].includes(source) && !isCampaignCodeCompliant(code)) {
      throw new BadRequestException('Mã chiến dịch mới phải có bốn ký tự chữ-số xen kẽ theo quy tắc hiện hành.');
    }
    const lifecycleState = command.lifecycleState ?? 'DRAFT';
    const markets = await this.resolveMarkets(command);
    const provinces = await this.resolveProvinces(command.provinceCodes, markets);
    const requestingUnits = await this.resolveRequestingUnits(command.requestingUnits);
    const requestingUnit = this.legacyRequestingUnitLabel(command.requestingUnit, requestingUnits);
    const fieldValues = this.mergeFieldValues(command.fieldValues, {
      campaign_code: code,
      campaign_name: name,
      requesting_unit: requestingUnit,
      campaign_lifecycle_state: lifecycleState,
      campaign_level_code: command.levelCode,
      campaign_comm_start_date: command.startDate ?? null,
      campaign_comm_end_date: command.endDate ?? null,
      campaign_effect_start_date: command.effectiveStartDate ?? null,
      campaign_effect_end_date: command.effectiveEndDate ?? null,
      campaign_objective: command.primaryObjectiveCode ?? null,
      kpi_primary: this.cleanOptional(command.kpiText),
    });

    return this.repository.createWithAudit({
      code, name, requestingUnit, lifecycleState,
      startDate: this.toDate(command.startDate), endDate: this.toDate(command.endDate),
      effectiveStartDate: this.toDate(command.effectiveStartDate), effectiveEndDate: this.toDate(command.effectiveEndDate),
      levelCode: command.levelCode,
      requestingEmployeeCode: this.cleanOptional(command.requestingEmployeeCode),
      manualRequesterEmail: this.cleanOptional(command.manualRequesterEmail),
      primaryObjectiveCode: command.primaryObjectiveCode ?? null,
      primaryObjectiveOther: command.primaryObjectiveCode === 'OTHER' ? this.cleanOptional(command.primaryObjectiveOther) : null,
      kpiText: this.cleanOptional(command.kpiText),
      descriptionRichText: command.descriptionRichText ?? null,
      additionalInformation: this.normalizeAdditionalInformation(command.additionalInformation),
      dataSchemaVersion: 2, normalizationStatus: 'CURRENT', fieldValues, markets, provinces, requestingUnits, auditSource: source,
    }, actor);
  }

  async regenerateCode(id: string, expectedVersion: number, actor: ActorContext): Promise<CampaignSummary> {
    const current = await this.get(id);
    if (current.isDeleted) throw new ConflictException('Hãy phục hồi Chiến dịch trước khi chuẩn hóa mã.');
    if (current.recordVersion !== expectedVersion) throw new ConflictException('Chiến dịch đã đổi. Hãy tải lại trước khi chuẩn hóa mã.');
    if (isCampaignCodeCompliant(current.code)) throw new ConflictException('Mã Chiến dịch đã đúng quy tắc.');
    const prefix = /^CPG-\d{6}/.exec(current.code)?.[0];
    if (!prefix) throw new ConflictException('Mã cũ không có tiền tố CPG-YYYYMM; cần đối soát thủ công.');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const nextCode = await this.uniqueCode(() => createCampaignCodeCandidateForPrefix(prefix, randomInt));
      try { return await this.repository.regenerateCodeWithAudit(id, current.code, nextCode, expectedVersion, actor); }
      catch (error) {
        if (error instanceof CampaignCodeConflictError) continue;
        if (error instanceof CampaignVersionConflictError) throw new ConflictException('Chiến dịch đã đổi. Hãy tải lại trước khi chuẩn hóa mã.');
        throw error;
      }
    }
    throw new ConflictException('Chưa cấp được mã không trùng. Hãy thử lại.');
  }

  private async uniqueCode(candidate: () => string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = candidate();
      if (!await this.repository.findByCode(code)) return code;
    }
    throw new ConflictException('Chưa cấp được mã Chiến dịch không trùng. Hãy thử lại.');
  }

  async update(id: string, command: UpdateCampaignCommand, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    const current = await this.get(id);
    if (current.isDeleted) throw new ConflictException('Chiến dịch đang ở trong Thùng rác. Hãy phục hồi trước khi chỉnh sửa.');
    if (command.expectedVersion === undefined) throw new BadRequestException('expectedVersion là bắt buộc khi cập nhật chiến dịch.');
    if (command.expectedVersion !== current.recordVersion) {
      throw new ConflictException('Chiến dịch đã được cập nhật ở nơi khác. Hãy tải lại dữ liệu trước khi lưu.');
    }

    const next = this.mergeCurrent(current, command);
    if (!next.name.trim()) throw new BadRequestException('Tên chiến dịch là bắt buộc.');
    if (next.levelCode) await this.requireLevel(next.levelCode);
    this.assertDateRange(next.startDate, next.endDate, 'Thời gian QCTT');
    this.assertDateRange(next.effectiveStartDate, next.effectiveEndDate, 'Thời gian hiệu lực');
    await this.validateV2Fields(next);

    const markets = this.hasMarketChange(command) ? await this.resolveMarkets(command) : undefined;
    const provinces = command.provinceCodes !== undefined || markets !== undefined
      ? await this.resolveProvinces(command.provinceCodes ?? current.provinces.map((province) => province.provinceCode), markets ?? current.markets)
      : undefined;
    const requestingUnits = command.requestingUnits !== undefined
      ? await this.resolveRequestingUnits(command.requestingUnits) : undefined;
    const requestingUnit = command.requestingUnits !== undefined || command.requestingUnit !== undefined
      ? this.legacyRequestingUnitLabel(command.requestingUnit, requestingUnits ?? [])
      : current.requestingUnit || null;
    const fieldValues = this.mergeFieldValues(current.fieldValues, command.fieldValues, {
      campaign_code: current.code,
      campaign_name: next.name.trim(),
      requesting_unit: requestingUnit,
      campaign_lifecycle_state: next.lifecycleState,
      campaign_level_code: next.levelCode,
      campaign_comm_start_date: next.startDate,
      campaign_comm_end_date: next.endDate,
      campaign_effect_start_date: next.effectiveStartDate ?? null,
      campaign_effect_end_date: next.effectiveEndDate ?? null,
      campaign_objective: next.primaryObjectiveCode ?? null,
      kpi_primary: this.cleanOptional(next.kpiText),
    });
    const auditChanges = this.campaignChanges(current, {
      ...next,
      requestingUnit,
      fieldValues,
      markets: markets ?? current.markets.map((market) => ({ marketCode: market.marketCode, selectionOrigin: market.selectionOrigin, selectionCode: market.selectionCode })),
      provinces: provinces ?? current.provinces.map((province) => province.provinceCode),
      requestingUnits: requestingUnits ?? current.requestingUnits.map((unit) => ({ unitCode: unit.unitCode, customName: unit.customName, displayOrder: unit.order })),
    });
    if (!auditChanges.length) return current;

    try {
      return await this.repository.updateWithAudit(id, {
        name: next.name.trim(), requestingUnit, lifecycleState: next.lifecycleState,
        startDate: this.toDate(next.startDate), endDate: this.toDate(next.endDate),
        effectiveStartDate: this.toDate(next.effectiveStartDate), effectiveEndDate: this.toDate(next.effectiveEndDate),
        levelCode: next.levelCode,
        requestingEmployeeCode: this.cleanOptional(next.requestingEmployeeCode),
        manualRequesterEmail: this.cleanOptional(next.manualRequesterEmail),
        primaryObjectiveCode: next.primaryObjectiveCode ?? null,
        primaryObjectiveOther: next.primaryObjectiveCode === 'OTHER' ? this.cleanOptional(next.primaryObjectiveOther) : null,
        kpiText: this.cleanOptional(next.kpiText), descriptionRichText: next.descriptionRichText ?? null,
        additionalInformation: this.normalizeAdditionalInformation(next.additionalInformation),
        dataSchemaVersion: 2,
        normalizationStatus: next.levelCode ? 'CURRENT' : 'NEEDS_NORMALIZATION',
        fieldValues,
        ...(markets !== undefined ? { markets } : {}),
        ...(provinces !== undefined ? { provinces } : {}),
        ...(requestingUnits !== undefined ? { requestingUnits } : {}),
        expectedVersion: command.expectedVersion,
        auditSource: source,
        auditChanges,
      }, actor);
    } catch (error) {
      if (error instanceof CampaignVersionConflictError) {
        throw new ConflictException('Chiến dịch đã được cập nhật ở nơi khác. Hãy tải lại dữ liệu trước khi lưu.');
      }
      throw error;
    }
  }

  /** Runs the existing business validators without changing the effective Campaign. */
  async validateProposedUpdate(id: string, command: UpdateCampaignCommand) {
    const current = await this.get(id);
    if (current.isDeleted || command.expectedVersion !== current.recordVersion) throw new ConflictException('Chiến dịch đã thay đổi. Hãy tải lại trước khi gửi đề nghị.');
    const next = this.mergeCurrent(current, command);
    if (!next.name.trim()) throw new BadRequestException('Tên chiến dịch là bắt buộc.');
    if (next.levelCode) await this.requireLevel(next.levelCode);
    this.assertDateRange(next.startDate, next.endDate, 'Thời gian QCTT');
    this.assertDateRange(next.effectiveStartDate, next.effectiveEndDate, 'Thời gian hiệu lực');
    await this.validateV2Fields(next);
    if (this.hasMarketChange(command) || command.provinceCodes !== undefined) {
      const markets = this.hasMarketChange(command) ? await this.resolveMarkets(command) : current.markets;
      await this.resolveProvinces(command.provinceCodes ?? current.provinces.map((province) => province.provinceCode), markets);
    }
    if (command.requestingUnits !== undefined) await this.resolveRequestingUnits(command.requestingUnits);
  }

  async findSimilar(query: string, excludeId?: string): Promise<SimilarCampaignSummary[]> {
    return this.similarWithinVisibility(query, excludeId);
  }
  protected async similarWithinVisibility(query: string, excludeId?: string, visibleIds?: readonly string[]): Promise<SimilarCampaignSummary[]> {
    const normalizedQuery = this.normalizeSearchText(query);
    if (normalizedQuery.length < 3) throw new BadRequestException('Từ khóa so sánh phải có ít nhất 3 ký tự.');
    const candidates = await this.repository.findSimilarCandidates(query.trim(), excludeId, visibleIds);
    return candidates
      .map((campaign) => ({ ...campaign, score: this.similarity(normalizedQuery, this.normalizeSearchText(`${campaign.code} ${campaign.name}`)) }))
      .filter((campaign) => campaign.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'vi'))
      .slice(0, 20)
      .map(({ id, code, name, lifecycleState, startDate, endDate, score }) => ({ id, code, name, lifecycleState, startDate, endDate, score }));
  }

  async moveToTrash(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    const current = await this.get(id);
    return current.isDeleted ? current : this.repository.moveToTrashWithAudit(id, actor, source);
  }
  async restore(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignSummary> {
    const current = await this.get(id);
    return current.isDeleted ? this.repository.restoreWithAudit(id, actor, source) : current;
  }
  async deletePermanently(id: string, actor: ActorContext, source: CampaignChangeSource = 'API'): Promise<CampaignDeleteResult> {
    const current = await this.get(id);
    if (!current.isDeleted) throw new ConflictException('Chỉ có thể xóa vĩnh viễn chiến dịch đã nằm trong Thùng rác.');
    return { ...await this.repository.deletePermanentlyWithAudit(id, actor, source), permanentlyDeleted: true };
  }

  async batchSave(items: CampaignBatchSaveItem[], actor: ActorContext): Promise<CampaignBatchResult> {
    const results: CampaignBatchResult['items'] = [];
    for (const item of items) {
      try {
        const existing = item.id ? null : item.code ? await this.repository.findByCode(item.code) : null;
        const campaign = item.id || existing
          ? await this.update(item.id ?? existing!.id, this.toUpdateCommand(item), actor, 'INLINE_GRID')
          : await this.create(this.toCreateCommand(item), actor, 'INLINE_GRID');
        results.push({ clientKey: item.clientKey, id: campaign.id, ok: true, campaign });
      } catch (error) {
        results.push({ clientKey: item.clientKey, ...(item.id ? { id: item.id } : {}), ok: false, message: this.errorMessage(error) });
      }
    }
    return this.batchResult(results);
  }

  async bulkTransition(ids: string[], lifecycleState: CampaignLifecycleState, actor: ActorContext): Promise<CampaignBatchResult> {
    const results: CampaignBatchResult['items'] = [];
    for (const id of ids) {
      try {
        const current = await this.get(id);
        const campaign = await this.update(id, { lifecycleState, expectedVersion: current.recordVersion }, actor, 'INLINE_GRID');
        results.push({ clientKey: id, id, ok: true, campaign });
      } catch (error) {
        results.push({ clientKey: id, id, ok: false, message: this.errorMessage(error) });
      }
    }
    return this.batchResult(results);
  }

  private mergeCurrent(current: CampaignSummary, command: UpdateCampaignCommand) {
    return {
      name: command.name ?? current.name,
      requestingUnit: command.requestingUnit !== undefined ? command.requestingUnit : current.requestingUnit,
      lifecycleState: command.lifecycleState ?? current.lifecycleState,
      startDate: command.startDate !== undefined ? command.startDate : current.startDate,
      endDate: command.endDate !== undefined ? command.endDate : current.endDate,
      effectiveStartDate: command.effectiveStartDate !== undefined ? command.effectiveStartDate : current.effectiveStartDate ?? null,
      effectiveEndDate: command.effectiveEndDate !== undefined ? command.effectiveEndDate : current.effectiveEndDate ?? null,
      levelCode: command.levelCode !== undefined ? command.levelCode : current.levelCode ?? null,
      requestingEmployeeCode: command.requestingEmployeeCode !== undefined ? command.requestingEmployeeCode : current.requestingEmployeeCode ?? null,
      manualRequesterEmail: command.manualRequesterEmail !== undefined ? command.manualRequesterEmail : current.manualRequesterEmail ?? null,
      primaryObjectiveCode: command.primaryObjectiveCode !== undefined ? command.primaryObjectiveCode : current.primaryObjectiveCode ?? null,
      primaryObjectiveOther: command.primaryObjectiveOther !== undefined ? command.primaryObjectiveOther : current.primaryObjectiveOther ?? null,
      kpiText: command.kpiText !== undefined ? command.kpiText : current.kpiText ?? null,
      descriptionRichText: command.descriptionRichText !== undefined ? command.descriptionRichText : current.descriptionRichText ?? null,
      additionalInformation: command.additionalInformation ?? current.additionalInformation ?? [],
    };
  }

  private campaignChanges(
    current: CampaignSummary,
    next: ReturnType<CampaignApplicationService['mergeCurrent']> & {
      requestingUnit: string | null;
      fieldValues: CampaignFieldValues;
      markets: PersistCampaignMarket[];
      provinces: string[];
      requestingUnits: PersistCampaignRequestingUnit[];
    },
  ): CampaignAuditChange[] {
    const rows: Array<[string, string, unknown, unknown]> = [
      ['campaign_name', 'Tên chiến dịch', current.name, next.name.trim()],
      ['requesting_unit', 'Đơn vị yêu cầu', current.requestingUnit || null, next.requestingUnit],
      ['campaign_lifecycle_state', 'Trạng thái', current.lifecycleState, next.lifecycleState],
      ['campaign_comm_start_date', 'Thời gian bắt đầu QCTT', this.dateKey(current.startDate), this.dateKey(next.startDate)],
      ['campaign_comm_end_date', 'Thời gian kết thúc QCTT', this.dateKey(current.endDate), this.dateKey(next.endDate)],
      ['campaign_effect_start_date', 'Bắt đầu hiệu lực', this.dateKey(current.effectiveStartDate), this.dateKey(next.effectiveStartDate)],
      ['campaign_effect_end_date', 'Kết thúc hiệu lực', this.dateKey(current.effectiveEndDate), this.dateKey(next.effectiveEndDate)],
      ['campaign_level_code', 'Cấp chiến dịch', current.levelCode, next.levelCode],
      ['requesting_employee_code', 'Người yêu cầu', current.requestingEmployeeCode, next.requestingEmployeeCode],
      ['manual_requester_email', 'Email người yêu cầu', current.manualRequesterEmail, next.manualRequesterEmail],
      ['primary_objective_code', 'Mục tiêu chính', current.primaryObjectiveCode, next.primaryObjectiveCode],
      ['primary_objective_other', 'Mục tiêu khác', current.primaryObjectiveOther, next.primaryObjectiveOther],
      ['kpi_text', 'Chỉ tiêu', current.kpiText, next.kpiText],
      ['description_rich_text', 'Mô tả chiến dịch', current.descriptionRichText, next.descriptionRichText],
      ['additional_information', 'Thông tin bổ sung', current.additionalInformation, next.additionalInformation],
      ['markets', 'Thị trường', current.markets.map((market) => ({ marketCode: market.marketCode, selectionOrigin: market.selectionOrigin, selectionCode: market.selectionCode })), next.markets],
      ['provinces', 'Tỉnh thành Việt Nam', current.provinces.map((province) => province.provinceCode), next.provinces],
      ['requesting_units', 'Các đơn vị yêu cầu', current.requestingUnits.map((unit) => ({ unitCode: unit.unitCode, customName: unit.customName, displayOrder: unit.order })), next.requestingUnits],
      ['field_values', 'Dữ liệu mở rộng', this.auditFieldValues(current.fieldValues), this.auditFieldValues(next.fieldValues)],
    ];
    return rows.flatMap(([fieldKey, label, before, after]) => this.sameValue(before, after) ? [] : [{
      fieldKey,
      label,
      before: this.auditValue(fieldKey, before),
      after: this.auditValue(fieldKey, after),
    }]);
  }

  private auditValue(fieldKey: string, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (fieldKey === 'description_rich_text') return `${JSON.stringify(value).length} ký tự nội dung có cấu trúc`;
    if (fieldKey === 'additional_information') return `${Array.isArray(value) ? value.length : 0} dòng`;
    if (fieldKey === 'markets' && Array.isArray(value)) return value.map((item) => (item as PersistCampaignMarket).marketCode).join('; ') || null;
    if (fieldKey === 'provinces' && Array.isArray(value)) return value.join('; ') || null;
    if (fieldKey === 'requesting_units' && Array.isArray(value)) return value.map((item) => {
      const unit = item as PersistCampaignRequestingUnit;
      return unit.unitCode ?? unit.customName ?? '';
    }).filter(Boolean).join('; ') || null;
    if (fieldKey === 'field_values') return 'Dữ liệu mở rộng đã thay đổi';
    return String(value).slice(0, 500);
  }

  private sameValue(left: unknown, right: unknown) {
    return JSON.stringify(this.sortValue(left)) === JSON.stringify(this.sortValue(right));
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortValue(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, this.sortValue(item)]));
    return value ?? null;
  }

  private dateKey(value: string | null | undefined) { return value ? value.slice(0, 10) : null; }
  private auditFieldValues(values: CampaignFieldValues) {
    const typedKeys = new Set([
      'campaign_code', 'campaign_name', 'requesting_unit', 'campaign_lifecycle_state', 'campaign_level_code',
      'campaign_comm_start_date', 'campaign_comm_end_date', 'campaign_effect_start_date', 'campaign_effect_end_date',
      'campaign_objective', 'kpi_primary',
    ]);
    return Object.fromEntries(Object.entries(values).filter(([key]) => !typedKeys.has(key)));
  }

  private async validateV2Fields(fields: CampaignV2Fields) {
    if (fields.requestingEmployeeCode && fields.manualRequesterEmail) {
      throw new BadRequestException('Chỉ chọn nhân sự trong danh bạ hoặc nhập email thủ công, không dùng đồng thời cả hai.');
    }
    if (fields.requestingEmployeeCode && !await this.catalogs.findPersonnel(fields.requestingEmployeeCode.trim())) {
      throw new BadRequestException('Không tìm thấy mã nhân viên đang hoạt động trong danh bạ demo.');
    }
    if (fields.manualRequesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.manualRequesterEmail.trim())) {
      throw new BadRequestException('Email nhân sự yêu cầu không hợp lệ.');
    }
    if (fields.primaryObjectiveCode) {
      if (!await this.catalogs.findCampaignObjective(fields.primaryObjectiveCode)) throw new BadRequestException('Mục tiêu chính không có trong catalog.');
      if (fields.primaryObjectiveCode === 'OTHER' && !fields.primaryObjectiveOther?.trim()) {
        throw new BadRequestException('Cần nhập nội dung mục tiêu khác khi chọn OTHER.');
      }
    }
    if (fields.descriptionRichText) {
      const errors = validateCampaignRichText(fields.descriptionRichText);
      if (errors.length) throw new BadRequestException(errors.join(' '));
    }
    this.normalizeAdditionalInformation(fields.additionalInformation);
  }

  private async requireLevel(code: NonNullable<CampaignV2Fields['levelCode']>) {
    if (!await this.catalogs.findCampaignLevel(code)) throw new BadRequestException('Cấp độ chiến dịch không có trong catalog.');
  }
  private async resolveMarkets(fields: CampaignV2Fields): Promise<PersistCampaignMarket[]> {
    const resolved = await this.catalogs.resolveMarketSelection(fields.marketCodes, fields.marketSelectionOrigin, fields.marketSelectionCode);
    return resolved.marketCodes.map((marketCode) => ({ marketCode, selectionOrigin: resolved.origin, selectionCode: resolved.selectionCode }));
  }
  private async resolveProvinces(codes: string[] | undefined, markets: readonly { marketCode: string }[]): Promise<string[]> {
    const provinces = await this.catalogs.requireProvinces(codes ?? []);
    if (provinces.length && !markets.some((market) => market.marketCode === 'VN')) {
      throw new BadRequestException('Chọn Việt Nam trước khi chọn tỉnh/thành.');
    }
    return provinces;
  }
  private hasMarketChange(command: UpdateCampaignCommand) {
    return command.marketCodes !== undefined || command.marketSelectionOrigin !== undefined || command.marketSelectionCode !== undefined;
  }
  private async resolveRequestingUnits(items: CampaignRequestingUnitInput[] | undefined): Promise<PersistCampaignRequestingUnit[]> {
    if (!items) return [];
    const normalized = items.map((item, displayOrder) => ({
      unitCode: this.cleanOptional(item.unitCode), customName: this.cleanOptional(item.customName), displayOrder,
    }));
    if (normalized.some((item) => Boolean(item.unitCode) === Boolean(item.customName))) {
      throw new BadRequestException('Mỗi đơn vị yêu cầu phải có đúng một unitCode hoặc customName.');
    }
    const unitCodes = normalized.flatMap((item) => item.unitCode ? [item.unitCode] : []);
    if (new Set(unitCodes).size !== unitCodes.length) throw new BadRequestException('Đơn vị yêu cầu không được trùng lặp.');
    await this.catalogs.requireOrganizationUnits(unitCodes);
    return normalized;
  }
  private normalizeAdditionalInformation(items: CampaignAdditionalInformationItem[] | undefined): CampaignAdditionalInformationItem[] {
    if (!items) return [];
    if (items.length > 10) throw new BadRequestException('Thông tin bổ sung không được vượt quá 10 mục.');
    const ids = new Set<string>();
    return items.map((item, index) => {
      const id = item.id.trim(); const label = item.label.trim(); const value = item.value.trim();
      if (!id || !label) throw new BadRequestException('Mỗi thông tin bổ sung cần có id và nhãn.');
      if (ids.has(id)) throw new BadRequestException('id của thông tin bổ sung không được trùng lặp.');
      ids.add(id);
      return { id, label, value, order: index };
    });
  }
  private legacyRequestingUnitLabel(explicit: string | null | undefined, units: PersistCampaignRequestingUnit[]) {
    const cleaned = this.cleanOptional(explicit);
    if (cleaned) return cleaned;
    const first = units[0];
    return first?.customName ?? first?.unitCode ?? null;
  }
  private assertDateRange(startDate: string | null | undefined, endDate: string | null | undefined, label: string) {
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new BadRequestException(`${label}: ngày bắt đầu không được sau ngày kết thúc.`);
    }
  }
  private toDate(value: string | null | undefined) { return value ? new Date(value) : null; }
  private cleanOptional(value: string | null | undefined) { const cleaned = value?.trim(); return cleaned || null; }
  private mergeFieldValues(...sources: Array<CampaignFieldValues | undefined>): CampaignFieldValues {
    return sources.reduce<CampaignFieldValues>((result, source) => ({ ...result, ...(source ?? {}) }), {});
  }
  private toCreateCommand(item: CampaignBatchSaveItem): CreateCampaignCommand {
    if (!item.name || !item.levelCode) throw new BadRequestException('Dòng mới cần tên và cấp độ chiến dịch.');
    return { ...item, name: item.name, levelCode: item.levelCode };
  }
  private toUpdateCommand(item: CampaignBatchSaveItem): UpdateCampaignCommand {
    if (item.expectedVersion === undefined) throw new BadRequestException('Dòng cập nhật cần expectedVersion.');
    return { ...item, expectedVersion: item.expectedVersion };
  }
  private normalizeSearchText(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  private similarity(query: string, candidate: string) {
    if (candidate.includes(query)) return 1;
    const queryTokens = new Set(query.split(' ').filter(Boolean));
    const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
    const intersection = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
    const union = new Set([...queryTokens, ...candidateTokens]).size;
    return union ? Number((intersection / union).toFixed(3)) : 0;
  }
  private batchResult(items: CampaignBatchResult['items']): CampaignBatchResult {
    const succeeded = items.filter((item) => item.ok).length;
    return { ok: succeeded === items.length, total: items.length, succeeded, failed: items.length - succeeded, items };
  }
  private errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Không thể lưu chiến dịch.'; }
}
