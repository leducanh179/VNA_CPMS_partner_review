import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ACCESS_PERMISSIONS, CAMPAIGN_ACCESS_FIELD_ALIASES, CAMPAIGN_FIELD_BY_KEY, evaluateAccess, evaluateCampaignFieldChanges, inspectCampaignFieldChanges,
  isProtectedCampaignField, canonicalCampaignFieldKey, type AccessDecision, type AccessPermission, type AccessResource, type ActorContext } from '@cpms/domain';
import { AccessRepository, type AccessSnapshot, type CampaignAccessCapabilities } from './access.repository';

@Injectable()
export class AccessApplicationService {
  private readonly requests = new AsyncLocalStorage<ActorContext>();
  private readonly commands = new AsyncLocalStorage<AccessSnapshot>();
  private readonly purgeVerifications = new WeakMap<AccessSnapshot, Set<string>>();
  private readonly commitChecks = new WeakMap<AccessSnapshot, (() => Promise<void>)[]>();
  constructor(@Inject(AccessRepository) private readonly repository: AccessRepository) {}

  /** Middleware may supply only its server-authenticated actor; CLI callers pass one explicitly. */
  withRequestActor<T>(actor: ActorContext, operation: () => T): T { return this.requests.run(actor, operation); }

  async run<T>(actor: ActorContext | undefined, operation: () => Promise<T>): Promise<T> {
    const current = this.commands.getStore();
    const resolved = actor ?? current?.actor ?? this.requests.getStore();
    if (!resolved) throw new UnauthorizedException('Cần phiên đăng nhập hiện hành.');
    if (current) {
      if (resolved.id !== current.actor.id || resolved.session?.id !== current.actor.session?.id) throw new ForbiddenException('Không được đổi người thực hiện trong giao dịch.');
      return operation();
    }
    return this.repository.execute(resolved, async (snapshot) => {
      const result = await this.commands.run(snapshot, operation);
      // Locks fence concurrent writes; refreshing also catches expiry during a long-running command.
      await this.repository.execute(resolved, async (fresh) => {
        for (const required of snapshot.requiredAtCommit) {
          // Evaluate the command's pre-state: its own trash/submit/assignment must not retroactively undo authorization.
          // Other mutations are excluded by the transaction lock; participation deadlines still invalidate these facts.
          const resource = required.resource;
          if (!fresh.implemented.has(required.permission) || !evaluateAccess({ identity: fresh.identity, permission: required.permission,
            ...(resource ? { resource } : {}), ...(required.fieldKey ? { fieldKey: required.fieldKey } : {}), now: Date.now() }, fresh.rules).allowed) throw new ForbiddenException('Quyền hoặc thời hạn đã thay đổi trước khi hoàn tất.');
        }
        await this.commands.run(fresh, async () => {
          for (const check of this.commitChecks.get(snapshot) ?? []) await check();
        });
      });
      return result;
    });
  }

  snapshot(): AccessSnapshot {
    const current = this.commands.getStore();
    if (!current) throw new UnauthorizedException('Thao tác chưa có ranh giới phân quyền.');
    return current;
  }
  /** Workflow also fences the task's actual scoped role, even when a separate record grant allows approve. */
  requireAtCommit(check: () => Promise<void>) {
    const snapshot = this.snapshot(); const checks = this.commitChecks.get(snapshot) ?? [];
    checks.push(check); this.commitChecks.set(snapshot, checks);
  }

  check(permission: AccessPermission, resource?: AccessResource, fieldKey?: string): AccessDecision {
    const snapshot = this.snapshot();
    if (!snapshot.implemented.has(permission)) return { allowed: false, reason: 'UNKNOWN_PERMISSION', tier: null, ruleIds: [] };
    return evaluateAccess({ identity: snapshot.identity, permission, ...(resource ? { resource } : {}), ...(fieldKey ? { fieldKey } : {}), now: Date.now() }, snapshot.rules);
  }
  require(permission: AccessPermission, resource?: AccessResource, fieldKey?: string): void {
    const decision = this.check(permission, resource, fieldKey);
    if (!decision.allowed) throw new ForbiddenException({ message: 'Không có quyền thực hiện thao tác trong phạm vi này.', code: decision.reason });
    this.snapshot().requiredAtCommit.push({ permission, ...(resource ? { resource } : {}), ...(fieldKey ? { fieldKey } : {}) });
  }
  async campaign(id: string): Promise<AccessResource> {
    this.snapshot();
    const resource = (await this.repository.campaignMetadata({ id }))[0];
    // Same response for missing and unreadable IDs: no names, versions or metadata are disclosed.
    if (!resource || !this.check('campaign.read', resource).allowed) throw new NotFoundException('Không tìm thấy chiến dịch trong phạm vi được phép.');
    this.require('campaign.read', resource);
    return resource;
  }
  async campaignByCode(code: string): Promise<AccessResource | null> {
    this.snapshot();
    const resource = (await this.repository.campaignMetadata({ code: code.trim().toUpperCase() }))[0];
    if (!resource) return null;
    if (!this.check('campaign.read', resource).allowed) throw new NotFoundException('Không tìm thấy chiến dịch trong phạm vi được phép.');
    this.require('campaign.read', resource);
    return resource;
  }
  async visibleCampaignIds(trash = false, permission: AccessPermission = 'campaign.read'): Promise<string[]> {
    this.snapshot();
    const resources = await this.repository.campaignMetadata({ trash });
    return resources.filter((resource) => this.check(permission, resource).allowed).map((resource) => { this.require(permission, resource); return resource.id; });
  }
  requireChangedFields(resource: AccessResource, before: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>) {
    const snapshot = this.snapshot();
    this.require('campaign.read', resource);
    if (!snapshot.implemented.has('campaign.update')) throw new ForbiddenException('Quyền sửa chưa được triển khai.');
    const changes = inspectCampaignFieldChanges(before, patch);
    if (changes.errors.length) throw new BadRequestException({ message: 'Payload chứa trường bảo vệ, alias xung đột hoặc trường chưa biết bị thay đổi.', fields: changes.errors });
    const result = evaluateCampaignFieldChanges({ identity: snapshot.identity, permission: 'campaign.update', resource, now: Date.now() }, changes, snapshot.rules);
    if (!result.allowed) throw new ForbiddenException({ message: 'Không lưu toàn bộ dòng vì có trường thay đổi bị chặn.', fields: result.deniedFields });
    for (const field of changes.fields) this.require('campaign.update', resource, field.fieldKey);
    return changes.fields;
  }
  capabilities(resource: AccessResource): CampaignAccessCapabilities {
    const permissions: CampaignAccessCapabilities['permissions'] = {};
    for (const permission of ['campaign.read','campaign.update','campaign.delete','campaign.restore','campaign.purge','campaign.export','campaign.import',
      'campaign.comment','campaign.comment.moderate','campaign.journal.read','campaign.submit','campaign.approve','campaign.assign','campaign.access.manage',
      'campaign.drive.read','campaign.drive.ensure','campaign.drive.upload','campaign.drive.rename','campaign.drive.trash','campaign.drive.restore'] as const) {
      permissions[permission] = this.check(permission, resource).allowed;
    }
    const fields = new Set([...Object.keys(CAMPAIGN_FIELD_BY_KEY), ...Object.values(CAMPAIGN_ACCESS_FIELD_ALIASES)].map(canonicalCampaignFieldKey));
    const editableFields = resource.workflowEditLocked ? [] : [...fields].filter((fieldKey) => !isProtectedCampaignField(fieldKey) && this.check('campaign.update', resource, fieldKey).allowed);
    if (resource.workflowEditLocked) permissions['campaign.update'] = false;
    return { permissions, editableFields, canEditAnyField: editableFields.length > 0, fieldReadMasking: false };
  }
  async requireProposedFields(requesterId: string, resource: AccessResource, before: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>) {
    this.require('campaign.approve', resource);
    const changes = inspectCampaignFieldChanges(before, patch);
    if (changes.errors.length) throw new BadRequestException('Đề nghị chứa trường được bảo vệ hoặc không hợp lệ.');
    const validate = async () => {
      const requester = await this.repository.describeAccount(requesterId);
      if (!requester?.identity.effectiveActive || !requester.identity.profileComplete) throw new ForbiddenException('Người đề nghị không còn đủ điều kiện.');
      const decision = evaluateCampaignFieldChanges({ identity: requester.identity, permission: 'campaign.update', resource, now: Date.now() }, changes, requester.rules);
      if (!decision.allowed) throw new ForbiddenException('Quyền sửa các trường của người đề nghị đã thay đổi.');
    };
    await validate(); this.requireAtCommit(validate);
    return changes.fields;
  }
  initializeCatalog(actor: ActorContext) { return this.repository.initializeCatalog(actor); }
  currentCapabilities(actor: ActorContext) {
    return this.run(actor, async () => {
      const permissions = Object.fromEntries(ACCESS_PERMISSIONS.map((permission) => [permission, this.check(permission).allowed]));
      const resources = await this.repository.campaignMetadata({});
      const moduleResources = await this.repository.moduleMetadata();
      for (const permission of ['booking.read','booking.create','booking.update','booking.report','contract.read','contract.approve'] as const) {
        const type = permission.startsWith('booking.') ? 'BOOKING' : 'CONTRACT';
        permissions[permission] ||= moduleResources.some(resource => resource.type === type && (permission !== 'contract.approve' || !resource.deleted) && this.check(permission, resource).allowed);
      }
      // Presence of any eligible resource controls navigation; each command still checks its actual target.
      for (const permission of ['campaign.read', 'campaign.trash.read', 'campaign.export', 'campaign.import'] as const) {
        permissions[permission] ||= resources.some((resource) => (permission === 'campaign.trash.read' ? resource.deleted : !resource.deleted) && this.check(permission, resource).allowed);
      }
      return { policyVersion: this.snapshot().policyVersion, permissions };
    });
  }
  async describeAccount(actorId: string) {
    this.require('access.manage');
    const facts = await this.repository.describeAccount(actorId);
    if (!facts) throw new NotFoundException('Không tìm thấy tài khoản đầy đủ.');
    return facts;
  }
  /** Internal routing facts only: never installs another identity or executes a command on its behalf. */
  async eligibleBookingAssignees(resource:AccessResource,permission:'booking.approve'|'booking.confirm'|'booking.report.approve',actorIds:string[]){
    this.require('booking.read',resource);const snapshot=this.snapshot();if(!snapshot.implemented.has(permission))return [];
    const eligible:string[]=[];
    for(const id of [...new Set(actorIds)]){const facts=await this.repository.describeAccount(id);if(!facts)continue;
      if(['booking.read',permission].every(p=>evaluateAccess({identity:facts.identity,permission:p as AccessPermission,resource,now:snapshot.now},facts.rules).allowed))eligible.push(id);
    }
    return eligible;
  }
  async eligibleContractActor(resource: AccessResource, permission: AccessPermission, actorId: string) {
    this.require('contract.read', resource);
    const facts = await this.repository.describeAccount(actorId);
    return Boolean(facts && this.snapshot().implemented.has(permission) && ['contract.read',permission].every(p => evaluateAccess({ identity: facts.identity, permission: p as AccessPermission, resource, now: Date.now() }, facts.rules).allowed));
  }
  /** Internal proof produced only after the provider adapter verifies folder state within this command. */
  async recordPurgeVerification(id: string) {
    this.require('campaign.purge', await this.campaign(id));
    const snapshot = this.snapshot(); const verified = this.purgeVerifications.get(snapshot) ?? new Set<string>();
    verified.add(id); this.purgeVerifications.set(snapshot, verified);
  }
  requirePurgeVerification(id: string) {
    if (!this.purgeVerifications.get(this.snapshot())?.has(id)) throw new ForbiddenException('Xóa vĩnh viễn phải qua lệnh kiểm tra thư mục và quyền trong cùng giao dịch.');
  }
}
