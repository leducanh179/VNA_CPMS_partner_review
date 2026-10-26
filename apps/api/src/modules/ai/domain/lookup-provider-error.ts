export class LookupProviderError extends Error {
  constructor(public readonly uncertain: boolean, public readonly reason = 'PROVIDER_FAILURE') { super('Không hoàn tất được lượt AI. Chi phí đã phát sinh vẫn được ghi nhận.'); }
}
