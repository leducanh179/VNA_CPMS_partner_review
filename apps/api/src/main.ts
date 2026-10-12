import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import 'reflect-metadata';
import { AppModule } from './app.module';
import type { Environment } from './config/environment';
import { configureTrustedProxy } from './config/trusted-proxy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const config = app.get(ConfigService<Environment, true>);
  configureTrustedProxy(app.getHttpAdapter().getInstance(), config.get('NODE_ENV', { infer: true }));

  app.setGlobalPrefix('api');
  // 8 MB XLSX becomes about 10.7 MB in base64; keep the existing limit on other routes.
  app.use('/api/contracts/import/file-preview', json({ limit: '12mb' }));
  app.use(json({ limit: '10mb' }));
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('CPMS API')
    .setDescription('Portable CPMS modular-monolith API')
    .setVersion('0.1.0')
    .build();
  if (config.get('AUTH_MODE', { infer: true }) === 'OPEN_DEMO') SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(config.get('API_PORT', { infer: true }), '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[CPMS API] Startup failed: ${message}`);
  process.exitCode = 1;
});
