import type { MarketCatalogItem } from '@cpms/domain';
import { describe, expect, it } from 'vitest';
import { CatalogApplicationService } from './catalog.application-service';
import type { CatalogRepository } from './catalog.repository';

const markets: MarketCatalogItem[] = Array.from({ length: 27 }, (_, index) => ({
  code: `M${String(index + 1).padStart(2, '0')}`,
  name: `Market ${index + 1}`,
  regionCode: index < 8 ? 'EUR' : 'OTHER',
  displayOrder: index + 1,
  isActive: true,
}));

const repository = {
  listActiveMarkets: async () => markets,
  listActiveMarketsByRegion: async (regionCode: string) => markets.filter((market) => market.regionCode === regionCode),
  findActiveMarkets: async (codes: string[]) => markets.filter((market) => codes.includes(market.code)),
} as unknown as CatalogRepository;

describe('CatalogApplicationService market snapshots', () => {
  it('expands Global into a 27-market snapshot and keeps arrays structured', async () => {
    const service = new CatalogApplicationService(repository);
    await expect(service.resolveMarketSelection(undefined, 'GLOBAL', undefined)).resolves.toMatchObject({
      marketCodes: markets.map((market) => market.code), origin: 'GLOBAL', selectionCode: 'GLOBAL',
    });
  });

  it('expands a region and rejects an unknown custom market code', async () => {
    const service = new CatalogApplicationService(repository);
    await expect(service.resolveMarketSelection(undefined, 'REGION', 'eur')).resolves.toMatchObject({
      marketCodes: markets.slice(0, 8).map((market) => market.code), origin: 'REGION', selectionCode: 'EUR',
    });
    await expect(service.resolveMarketSelection(['M01', 'UNKNOWN'], 'CUSTOM', undefined)).rejects.toThrow('UNKNOWN');
    await expect(service.resolveMarketSelection([], 'CUSTOM', undefined)).rejects.toThrow('at least one market code');
  });
});
