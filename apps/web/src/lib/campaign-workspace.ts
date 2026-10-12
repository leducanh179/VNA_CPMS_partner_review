import type {
  CampaignBatchResult,
  CampaignBatchSaveItem,
  CampaignLifecycleState,
  CampaignDeleteResult,
  CampaignSummary,
  CreateCampaignCommand,
  UpdateCampaignCommand,
} from '@cpms/domain';
import {
  batchSaveCampaigns,
  bulkTransitionCampaigns,
  createCampaign,
  getCampaign,
  getCampaigns,
  moveCampaignToTrash,
  restoreCampaign,
  deleteCampaignPermanently,
  updateCampaign,
} from './api';

export interface CampaignGateway {
  list(trash?: boolean): Promise<CampaignSummary[]>;
  get(id: string): Promise<CampaignSummary>;
  create(command: CreateCampaignCommand): Promise<CampaignSummary>;
  update(id: string, command: UpdateCampaignCommand): Promise<CampaignSummary>;
  batchSave(items: CampaignBatchSaveItem[]): Promise<CampaignBatchResult>;
  bulkTransition(ids: string[], lifecycleState: CampaignLifecycleState): Promise<CampaignBatchResult>;
  moveToTrash(id: string): Promise<CampaignSummary>;
  restore(id: string): Promise<CampaignSummary>;
  deletePermanently(id: string): Promise<CampaignDeleteResult>;
}

export interface CampaignWorkspaceSnapshot {
  campaigns: readonly CampaignSummary[];
  trashCampaigns: readonly CampaignSummary[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

type Listener = () => void;

const apiGateway: CampaignGateway = {
  list: getCampaigns,
  get: getCampaign,
  create: createCampaign,
  update: updateCampaign,
  batchSave: batchSaveCampaigns,
  bulkTransition: bulkTransitionCampaigns,
  moveToTrash: moveCampaignToTrash,
  restore: restoreCampaign,
  deletePermanently: deleteCampaignPermanently,
};

export class CampaignWorkspaceStore {
  private state: CampaignWorkspaceSnapshot = {
    campaigns: [],
    trashCampaigns: [],
    loading: false,
    initialized: false,
    error: null,
  };

  private readonly listeners = new Set<Listener>();
  private accessGeneration = 0;

  constructor(private readonly gateway: CampaignGateway) {}

  snapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async load(force = false) {
    if (this.state.loading || (this.state.initialized && !force)) return;
    const isInitialLoad = !this.state.initialized;
    const generation = this.accessGeneration;
    this.setState({ ...this.state, loading: true, error: null });
    try {
      const campaigns = await this.listWithStartupRetry(isInitialLoad ? 5 : 1);
      if (generation !== this.accessGeneration) return;
      this.setState({ ...this.state, campaigns, loading: false, initialized: true, error: null });
    } catch (error) {
      if (generation !== this.accessGeneration) return;
      this.setState({
        ...this.state,
        loading: false,
        initialized: true,
        error: this.errorMessage(error),
      });
    }
  }

  async loadOne(id: string, force = false) {
    const existing = this.state.campaigns.find((campaign) => campaign.id === id);
    if (existing && !force) return existing;
    const generation = this.accessGeneration;

    this.setState({ ...this.state, loading: true, error: null });
    try {
      const campaign = await this.gateway.get(id);
      if (generation !== this.accessGeneration) throw new Error('Quyền đã thay đổi trong lúc tải hồ sơ. Hãy tải lại.');
      this.upsert(campaign);
      return campaign;
    } catch (error) {
      if (generation === this.accessGeneration) this.setState({ ...this.state, campaigns: this.state.campaigns.filter((row) => row.id !== id), trashCampaigns: this.state.trashCampaigns.filter((row) => row.id !== id), loading: false, error: this.errorMessage(error) });
      throw error;
    }
  }

  async create(command: CreateCampaignCommand) {
    const campaign = await this.gateway.create(command);
    this.upsert(campaign);
    return campaign;
  }

  async loadTrash() {
    const generation = this.accessGeneration;
    this.setState({ ...this.state, loading: true, error: null });
    try {
      const trashCampaigns = await this.gateway.list(true);
      if (generation !== this.accessGeneration) return this.state.trashCampaigns;
      this.setState({ ...this.state, trashCampaigns, loading: false, initialized: true, error: null });
      return trashCampaigns;
    } catch (error) {
      if (generation === this.accessGeneration) this.setState({ ...this.state, loading: false, error: this.errorMessage(error) });
      throw error;
    }
  }

  async update(id: string, command: UpdateCampaignCommand) {
    const campaign = await this.gateway.update(id, command);
    this.upsert(campaign);
    return campaign;
  }

  async reloadAccess() {
    const generation = ++this.accessGeneration;
    this.setState({ ...this.state, loading: true, error: null });
    try {
      const [campaigns, trashCampaigns] = await Promise.all([this.gateway.list(), this.gateway.list(true)]);
      if (generation === this.accessGeneration) this.setState({ campaigns, trashCampaigns, loading: false, initialized: true, error: null });
    } catch (error) {
      if (generation === this.accessGeneration) this.setState({ campaigns: [], trashCampaigns: [], loading: false, initialized: true, error: this.errorMessage(error) });
    }
  }

  async batchSave(items: CampaignBatchSaveItem[]) {
    const result = await this.gateway.batchSave(items);
    this.upsertMany(result.items.flatMap((item) => item.campaign ? [item.campaign] : []));
    return result;
  }

  async bulkTransition(ids: string[], lifecycleState: CampaignLifecycleState) {
    const result = await this.gateway.bulkTransition(ids, lifecycleState);
    this.upsertMany(result.items.flatMap((item) => item.campaign ? [item.campaign] : []));
    return result;
  }

  async moveToTrash(id: string) {
    const campaign = await this.gateway.moveToTrash(id);
    this.setState({
      ...this.state,
      campaigns: this.state.campaigns.filter((item) => item.id !== id),
      trashCampaigns: [campaign, ...this.state.trashCampaigns.filter((item) => item.id !== id)],
      error: null,
    });
    return campaign;
  }

  async restore(id: string) {
    const campaign = await this.gateway.restore(id);
    this.setState({
      ...this.state,
      campaigns: [campaign, ...this.state.campaigns.filter((item) => item.id !== id)],
      trashCampaigns: this.state.trashCampaigns.filter((item) => item.id !== id),
      error: null,
    });
    return campaign;
  }

  async deletePermanently(id: string) {
    const result = await this.gateway.deletePermanently(id);
    this.setState({ ...this.state, trashCampaigns: this.state.trashCampaigns.filter((item) => item.id !== id), error: null });
    return result;
  }

  clearError() {
    if (this.state.error) this.setState({ ...this.state, error: null });
  }

  private upsert(campaign: CampaignSummary) {
    this.upsertMany([campaign]);
  }

  private upsertMany(nextCampaigns: CampaignSummary[]) {
    if (nextCampaigns.length === 0) return;
    const nextIds = new Set(nextCampaigns.map((campaign) => campaign.id));
    const campaigns = [...nextCampaigns.filter((campaign) => !campaign.isDeleted), ...this.state.campaigns.filter((item) => !nextIds.has(item.id))]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const trashCampaigns = [...nextCampaigns.filter((campaign) => campaign.isDeleted), ...this.state.trashCampaigns.filter((item) => !nextIds.has(item.id))]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.setState({ ...this.state, campaigns, trashCampaigns, loading: false, initialized: true, error: null });
  }

  private setState(state: CampaignWorkspaceSnapshot) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Không thể tải dữ liệu chiến dịch.';
  }

  private async listWithStartupRetry(attempts: number) {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.gateway.list();
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }
}

export function createCampaignWorkspaceStore(gateway: CampaignGateway = apiGateway) {
  return new CampaignWorkspaceStore(gateway);
}

export function selectRecentCampaigns(snapshot: CampaignWorkspaceSnapshot, limit = 5) {
  return snapshot.campaigns.slice(0, limit);
}

export function selectCockpitCampaigns(snapshot: CampaignWorkspaceSnapshot) {
  return snapshot.campaigns;
}

export function selectDashboardMetrics(snapshot: CampaignWorkspaceSnapshot) {
  return {
    total: snapshot.campaigns.length,
    drafts: snapshot.campaigns.filter((campaign) => campaign.lifecycleState === 'DRAFT').length,
    running: snapshot.campaigns.filter((campaign) => campaign.lifecycleState === 'RUNNING').length,
    ready: snapshot.campaigns.filter((campaign) => ['PLANNING', 'READY_TO_LAUNCH'].includes(campaign.lifecycleState)).length,
  };
}
