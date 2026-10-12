import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SPREADSHEET_DOCUMENT_PORT, type SpreadsheetDocumentPort, type TabularWorkbookData } from '@cpms/integrations';
import type { ActorContext, CampaignChangeSource, CampaignSpreadsheetCompareRequest, CampaignSpreadsheetExportRequest, CampaignSpreadsheetImportRequest,
  CampaignSpreadsheetMapping, CampaignSpreadsheetPreviewRequest, CampaignSpreadsheetPreviewRow } from '@cpms/domain';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { AccessBoundary } from '../../access/application/access-boundary';
import { CatalogApplicationService } from '../../catalog/application/catalog.application-service';
import { ScopedCampaignApplicationService } from './scoped-campaign.application-service';
import { CAMPAIGN_REPOSITORY, type CampaignRepository } from './campaign.repository';
import { CampaignSpreadsheetApplicationService } from './campaign-spreadsheet.application-service';

/** Scoped adapter covers file and Google-workbook entrypoints without an import-wide transaction. */
@Injectable()
export class ScopedCampaignSpreadsheetApplicationService extends CampaignSpreadsheetApplicationService {
  constructor(@Inject(SPREADSHEET_DOCUMENT_PORT) documents: SpreadsheetDocumentPort,
    @Inject(CAMPAIGN_REPOSITORY) private readonly scopedRepository: CampaignRepository,
    @Inject(ScopedCampaignApplicationService) private readonly scopedCampaigns: ScopedCampaignApplicationService,
    @Inject(CatalogApplicationService) catalogs: CatalogApplicationService,
    @Inject(AccessApplicationService) readonly access: AccessApplicationService) { super(documents, scopedRepository, scopedCampaigns, catalogs); }

  @AccessBoundary()
  override async inspect(file: { fileName: string; mimeType?: string; contentBase64: string }) { return super.inspect(file); }
  @AccessBoundary()
  override async export(request: CampaignSpreadsheetExportRequest) { return super.export(request); }
  @AccessBoundary()
  override async exportWorkbook(request: CampaignSpreadsheetExportRequest) { return super.exportWorkbook(request); }
  protected override async exportableCampaigns(request: CampaignSpreadsheetExportRequest) {
    if (request.mode === 'TEMPLATE') return [];
    const visible = await this.access.visibleCampaignIds(false, 'campaign.export');
    const chosen = request.recordScope === 'ALL_CURRENT' ? visible : request.campaignIds ?? [];
    if (chosen.some((id) => !visible.includes(id))) throw new ForbiddenException('Phạm vi xuất có chiến dịch không được phép xem/xuất.');
    return this.scopedRepository.list(false, chosen);
  }
  @AccessBoundary()
  override async preview(request: CampaignSpreadsheetPreviewRequest) { return super.preview(request); }
  @AccessBoundary()
  override async previewWorkbook(workbook: TabularWorkbookData, request: Pick<CampaignSpreadsheetPreviewRequest, 'sheetName' | 'mapping' | 'selectedRows' | 'selectedFieldKeys'>) {
    return super.previewWorkbook(workbook, request);
  }
  protected override async lookupCampaignForPreview(code: string) {
    const resource = await this.access.campaignByCode(code);
    return resource ? this.scopedCampaigns.get(resource.id) : null;
  }
  protected override async previewRow(rowNumber: number, raw: Array<string | number | boolean | null>, mapping: CampaignSpreadsheetMapping[], selected: boolean): Promise<CampaignSpreadsheetPreviewRow> {
    try { return await super.previewRow(rowNumber, raw, mapping, selected); }
    catch (error) {
      if (!(error instanceof NotFoundException) && !(error instanceof ForbiddenException)) throw error;
      return { rowNumber, selected, status: 'INVALID', code: null, name: null, campaignId: null, expectedVersion: null, values: {}, diffs: [],
        errors: ['Không thể đối chiếu mã chiến dịch trong phạm vi được phép.'] };
    }
  }
  override async import(request: CampaignSpreadsheetImportRequest, actor: ActorContext, source: CampaignChangeSource = 'XLSX_CSV') {
    return this.access.withRequestActor(actor, () => super.import(request, actor, source));
  }
  override async importWorkbook(workbook: TabularWorkbookData, request: Pick<CampaignSpreadsheetImportRequest, 'sheetName' | 'mapping' | 'selectedRows' | 'selectedFieldKeys' | 'decisions'>,
    actor: ActorContext, source: CampaignChangeSource = 'XLSX_CSV') {
    return this.access.withRequestActor(actor, () => super.importWorkbook(workbook, request, actor, source));
  }
  @AccessBoundary(2)
  protected override async applyImportDecision(row: CampaignSpreadsheetPreviewRow, decision: CampaignSpreadsheetImportRequest['decisions'][number], actor: ActorContext, source: CampaignChangeSource) {
    this.access.require('campaign.import', row.campaignId ? await this.access.campaign(row.campaignId) : undefined);
    if (row.campaignId && (await this.scopedCampaigns.get(row.campaignId)).recordVersion !== decision.expectedVersion) throw new ConflictException('Chiến dịch đã thay đổi sau khi xem trước. Hãy tải lại.');
    return super.applyImportDecision(row, decision, actor, source);
  }
  @AccessBoundary()
  override async compareWorkbook(workbook: TabularWorkbookData, request: Omit<CampaignSpreadsheetCompareRequest, 'spreadsheetUrl'>) { return super.compareWorkbook(workbook, request); }
}
