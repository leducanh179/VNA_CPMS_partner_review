import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();
  // Prisma's subclass accessor receiver is the raw client, which has no generated model proxies.
  // A public empty extension retains the same engine while providing its generated model delegates.
  private readonly rootDatabase = this.$extends({}) as unknown as Prisma.TransactionClient;

  /** Repositories participating in one application command share this exact PostgreSQL transaction. */
  get database(): Prisma.TransactionClient { return this.transactionContext.getStore() ?? this.rootDatabase; }

  /** Legacy static operations keep atomicity when nested inside an authorized application command. */
  async batchTransaction<T extends Prisma.PrismaPromise<unknown>[]>(operations: [...T]): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
    if (!this.transactionContext.getStore()) return this.$transaction(operations) as Promise<{ [K in keyof T]: Awaited<T[K]> }>;
    const results: unknown[] = [];
    for (const operation of operations) results.push(await operation);
    return results as { [K in keyof T]: Awaited<T[K]> };
  }

  async inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const existing = this.transactionContext.getStore();
    if (existing) return operation(existing);
    return this.$transaction((transaction) => this.transactionContext.run(transaction, () => operation(transaction)), { maxWait: 15_000, timeout: 120_000 });
  }

  /** Access checks and all related writes/audit serialize with role/account/assignment revocation. */
  async withSecurityLock<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.inTransaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cpms:security'))`;
      return operation(transaction);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
