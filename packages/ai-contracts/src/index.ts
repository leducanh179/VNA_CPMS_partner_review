export const AI_MODES = ['OFF', 'MOCK'] as const;
export type AiMode = (typeof AI_MODES)[number];

export interface CampaignIntakeRequest {
  sourceText: string;
  allowedRequestingUnits: readonly string[];
}

export interface CampaignIntakeProposal {
  name: string | null;
  requestingUnit: string | null;
  objective: string | null;
  startDate: string | null;
  endDate: string | null;
  warnings: readonly string[];
  requiresHumanConfirmation: true;
}

export interface AiProvider {
  readonly providerName: string;
  previewCampaignIntake(request: CampaignIntakeRequest): Promise<CampaignIntakeProposal>;
}

export class MockAiProvider implements AiProvider {
  readonly providerName = 'mock';

  async previewCampaignIntake(request: CampaignIntakeRequest): Promise<CampaignIntakeProposal> {
    const normalized = request.sourceText.trim().replace(/\s+/g, ' ');
    const candidateUnit = request.allowedRequestingUnits.find((unit) =>
      normalized.toLocaleLowerCase('vi').includes(unit.toLocaleLowerCase('vi')),
    );

    return {
      name: normalized.length > 0 ? normalized.slice(0, 120) : null,
      requestingUnit: candidateUnit ?? null,
      objective: null,
      startDate: null,
      endDate: null,
      warnings: ['Mock proposal only; no network call was made and no data was persisted.'],
      requiresHumanConfirmation: true,
    };
  }
}
