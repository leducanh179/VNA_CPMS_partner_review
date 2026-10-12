import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DemoActorMiddleware } from './demo-actor.middleware';
import { PermissionGuard } from './permission.guard';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  providers: [DemoActorMiddleware, { provide: APP_GUARD, useClass: PermissionGuard }],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DemoActorMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
