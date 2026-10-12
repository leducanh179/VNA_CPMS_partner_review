import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ACCESS_PERMISSIONS, evaluateAccess, CAMPAIGN_FIELD_BY_KEY, canonicalCampaignFieldKey, isProtectedCampaignField, type ActorContext } from '@cpms/domain';
import { AccessApplicationService } from './access.application-service';
import { AccessAdministrationRepository } from './access-administration.repository';
import { parseManagedAccessCommand } from './access-administration';

@Injectable()
export class AccessAdministrationApplicationService {
  constructor(@Inject(AccessApplicationService) private readonly access: AccessApplicationService,
    @Inject(AccessAdministrationRepository) private readonly repository: AccessAdministrationRepository) {}
  read(actor: ActorContext, filters: { actorId?: string; campaignId?: string } = {}) {
    return this.access.run(actor, async () => { this.access.require('access.manage'); return this.repository.read(filters); });
  }
  async preview(actor: ActorContext, input: unknown) {
    const command = parseManagedAccessCommand(input);
    return this.access.run(actor, async () => {
      this.access.require('access.manage');
      if (command.expectedVersion !== this.access.snapshot().policyVersion) throw new ConflictException('Quyền đã thay đổi. Hãy tải lại trước khi xem trước.');
      const changes = await this.repository.preview(command);
      const projected = await this.repository.projectRules(command);
      const now = Date.now(); const implemented = this.access.snapshot().implemented;
      const impacts = [];
      for (const account of projected) {
        const { identity } = await this.access.describeAccount(account.actorId);
        const campaignIds = [...new Set(command.changes.flatMap((change) => change.kind !== 'ROLE_PRESET' && change.actorId === account.actorId && change.scope.campaignId ? [change.scope.campaignId] : []))];
        for (const campaignId of campaignIds.length ? campaignIds : [null]) {
          const resource = campaignId ? await this.access.campaign(campaignId) : undefined;
          const compare = (permission: typeof ACCESS_PERMISSIONS[number], fieldKey?: string) => {
            const request = { identity, permission, now, ...(resource ? { resource } : {}), ...(fieldKey ? { fieldKey } : {}) };
            const unavailable = { allowed: false, reason: 'UNKNOWN_PERMISSION' as const, tier: null, ruleIds: [] };
            return { permission, ...(fieldKey ? { fieldKey } : {}), before: implemented.has(permission) ? evaluateAccess(request, account.before) : unavailable,
              after: implemented.has(permission) ? evaluateAccess(request, account.after) : unavailable };
          };
          const fields = resource ? [...new Set(Object.keys(CAMPAIGN_FIELD_BY_KEY).map(canonicalCampaignFieldKey))].filter((key) => !isProtectedCampaignField(key)).map((key) => compare('campaign.update', key)) : [];
          impacts.push({ actorId: account.actorId, campaignId, context: resource ? 'RECORD' : 'MODULE_WITHOUT_RECORD',
            decisions: ACCESS_PERMISSIONS.filter((permission) => !resource || (permission.startsWith('campaign.') && permission !== 'campaign.create')).map((permission) => compare(permission)),
            changedFields: fields.filter((field) => field.before.allowed !== field.after.allowed), editableFieldsAfter: fields.filter((field) => field.after.allowed).map((field) => field.fieldKey),
            workflowAssignmentEvaluated: false });
        }
      }
      return { version: command.expectedVersion, changes, impacts,
        notes: ['Ngoại lệ cụ thể hơn có thể thay quyết định ở scope rộng. Cùng tier có Deny thì Deny thắng.',
          'Field Allow vẫn cần quyền xem record. Chưa che field khi đọc.',
          'Quyền duyệt không thay thế việc được giao task đang mở và điều kiện workflow.',
          'Xem trước chưa lưu. Phạm vi phân hệ chưa chọn record không đánh giá được quan hệ người tạo, người tham gia hoặc đơn vị tiếp nhận.'] };
    });
  }
  async save(actor: ActorContext, input: unknown) {
    const command = parseManagedAccessCommand(input);
    return this.access.run(actor, async () => { this.access.require('access.manage'); return this.repository.save(command, actor); });
  }
  explain(actor: ActorContext, actorId: string, campaignId?: string) {
    return this.access.run(actor, async () => {
      const facts = await this.access.describeAccount(actorId);
      const resource = campaignId ? await this.access.campaign(campaignId) : undefined;
      const now = Date.now(); const implemented = this.access.snapshot().implemented;
      const decision = (permission: typeof ACCESS_PERMISSIONS[number], fieldKey?: string) => !implemented.has(permission)
        ? { allowed: false, reason: 'UNKNOWN_PERMISSION' as const, tier: null, ruleIds: [] }
        : evaluateAccess({ identity: facts.identity, permission, ...(resource ? { resource } : {}), ...(fieldKey ? { fieldKey } : {}), now }, facts.rules);
      return { actorId, campaignId: campaignId ?? null, version: this.access.snapshot().policyVersion, evaluatedAt: new Date(now).toISOString(),
        context: 'DIRECT_POLICY_DESCRIPTION', fieldReadMasking: false, requiresValidLogin: true, workflowAssignmentEvaluated: false,
        decisions: ACCESS_PERMISSIONS.filter((permission) => !campaignId || (permission.startsWith('campaign.') && permission !== 'campaign.create')).map((permission) => ({ permission, implementationStatus: implemented.has(permission) ? 'IMPLEMENTED' : 'RESERVED', ...decision(permission) })),
        fields: resource ? [...new Set(Object.keys(CAMPAIGN_FIELD_BY_KEY).map(canonicalCampaignFieldKey))].filter((key) => !isProtectedCampaignField(key)).map((fieldKey) => ({ fieldKey, ...decision('campaign.update', fieldKey) })) : [],
        sources: facts.rules, notes: ['Đây là giải thích cấu hình quyền; không tạo phiên hoặc thực hiện lệnh thay tài khoản.', 'Có quyền duyệt vẫn cần task được giao, đúng bước và phiên bản workflow.', 'Không có field-level read masking; quyền xem record cho phép đọc các trường đã công bố.'] };
    });
  }
}
