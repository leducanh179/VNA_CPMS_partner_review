import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { bookingExactSum, type ActorContext, type BookingView, type SupplyAnalytics } from '@cpms/domain';
import type { ContractsApplicationService } from '../src/modules/contracts/application/contracts.application-service';

/** Uses a Booking saved by the application and reloaded from PostgreSQL. */
export async function verifyContractAnalytics(app: INestApplication, contracts: ContractsApplicationService, row: BookingView, actor: ActorContext) {
  const q = { period: 'CURRENT', grain: 'DAY', from: '2026-09-10', to: '2026-09-20', slotIds: [row.slotId] };
  const daily = await contracts.analytics(row.contractId, q, actor);
  assert.equal(daily.version, 1); assert.equal(daily.buckets[0]!.used, '3');
  assert.equal(bookingExactSum(daily.buckets.map(b => b.used)), '10');
  assert.equal(daily.summaries[0]!.usedPercent, '20');
  const wire = await fetch(`${await app.getUrl()}/api/contracts/${row.contractId}/analytics/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
  assert.equal(wire.status, 200); const body = await wire.json() as SupplyAnalytics;
  assert.equal(body.buckets[0]!.used, '3'); assert.equal(body.summaries[0]!.total, '50');
  assert.equal(body.query.stage, 'booked');
  assert.equal(body.finance?.selected.net, '1000');
  assert.equal(body.finance?.selected.gross, '1080');
  assert.equal(bookingExactSum(body.finance!.campaigns.flatMap(c => c.bookings.map(b => b.value.net!))), body.finance!.selected.net);
  const acceptedMoney = await contracts.analytics(row.contractId, { ...q, stage:'accepted' }, actor);
  assert.deepEqual(acceptedMoney.finance.periods[0]!.available, body.finance!.periods[0]!.available);
  assert(new Prisma.Decimal(body.buckets[0]!.timeRemaining!).plus(body.buckets[0]!.used).eq(body.buckets[0]!.timeTotal!));
  assert(new Prisma.Decimal(body.buckets[0]!.timeUsedPercent!).plus(body.buckets[0]!.timeRemainingPercent!).eq(100));
  assert.notEqual(body.buckets[0]!.timeRemaining, body.buckets[0]!.remaining);
  assert.equal(bookingExactSum(body.buckets.map(b => b.timeTotal!)), body.summaries[0]!.selectedTotal);
  const disjoint = await contracts.analytics(row.contractId, { period: 'CURRENT', mode: 'DISCRETE', grain: 'DAY', keys: ['2026-09-12', '2026-09-10', '2026-09-10'] }, actor);
  assert.equal(disjoint.buckets.length, 2); assert.equal(disjoint.summaries[0]!.usedSelected, '3.7');
  for (const grain of ['WEEK', 'MONTH', 'QUARTER', 'YEAR']) {
    const response = await contracts.analytics(row.contractId, { period: 'ALL', grain }, actor);
    assert.equal(response.summaries[0]!.used, '10'); assert.equal(bookingExactSum(response.buckets.map(b => b.used)), '10');
  }
  await assert.rejects(contracts.analytics(row.contractId, { mode: 'DISCRETE', grain: 'MONTH', keys: ['2026-09-10'] }, actor));
  await assert.rejects(contracts.analytics(row.contractId, { asOf: '2020-01-01' }, actor));
  await assert.rejects(contracts.analytics(row.contractId, q, { ...actor, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
}
