import type { InventoryConsumptionProvider, InventoryConsumptionSample, InventoryConsumptionScope } from '@cpms/integrations';

export class ZeroConsumptionProvider implements InventoryConsumptionProvider {
  async read(scopes: readonly InventoryConsumptionScope[], asOf: string): Promise<InventoryConsumptionSample> {
    return { asOf, mode: 'ZERO_DEMO', source: 'ZeroConsumptionProvider', values: Object.fromEntries(scopes.map(scope => [scope.allocationId,
      { booked: { qty: '0', amount: '0' }, vendorConfirmed: { qty: '0', amount: '0' }, approved: { qty: '0', amount: '0' }, accepted: { qty: '0', amount: '0' }, committed: { qty: '0', amount: '0' } }])) };
  }
}
