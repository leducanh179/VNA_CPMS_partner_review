import { Body, Controller, Module, Patch, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiBody, SwaggerModule } from '@nestjs/swagger';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CreateCampaignDto } from './create-campaign.dto';
import { UpdateCampaignDto } from './update-campaign.dto';
import { BatchSaveCampaignsDto } from './batch-save-campaigns.dto';
import { BulkTransitionCampaignsDto } from './bulk-transition-campaigns.dto';

@Controller('campaigns')
class OpenApiTestController {
  @Post()
  @ApiBody({ type: CreateCampaignDto })
  create(@Body() input: CreateCampaignDto) {
    return input;
  }

  @Patch(':id')
  @ApiBody({ type: UpdateCampaignDto })
  update(@Body() input: UpdateCampaignDto) {
    return input;
  }

  @Post('batch-save')
  @ApiBody({ type: BatchSaveCampaignsDto })
  batchSave(@Body() input: BatchSaveCampaignsDto) {
    return input;
  }

  @Post('bulk-transition')
  @ApiBody({ type: BulkTransitionCampaignsDto })
  bulkTransition(@Body() input: BulkTransitionCampaignsDto) {
    return input;
  }
}

@Module({ controllers: [OpenApiTestController] })
class OpenApiTestModule {}

describe('CreateCampaignDto OpenAPI schema', () => {
  it('can generate a schema without relying on implicit decorator metadata', async () => {
    const app = await NestFactory.create(OpenApiTestModule, { logger: false });

    try {
      const document = SwaggerModule.createDocument(app, {
        openapi: '3.0.0',
        info: { title: 'test', version: '1.0.0' },
        paths: {},
      });

      expect(document.components?.schemas?.CreateCampaignDto).toMatchObject({
        type: 'object',
        required: ['name', 'levelCode'],
        properties: {
          name: { type: 'string' },
          levelCode: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('publishes the lifecycle state and nullable dates for Campaign updates', async () => {
    const app = await NestFactory.create(OpenApiTestModule, { logger: false });

    try {
      const document = SwaggerModule.createDocument(app, {
        openapi: '3.0.0',
        info: { title: 'test', version: '1.0.0' },
        paths: {},
      });

      expect(document.components?.schemas?.UpdateCampaignDto).toMatchObject({
        type: 'object',
        required: ['expectedVersion'],
        properties: {
          name: { type: 'string' },
          requestingUnit: { type: 'string' },
          lifecycleState: { type: 'string' },
          startDate: { type: 'string', format: 'date', nullable: true },
          endDate: { type: 'string', format: 'date', nullable: true },
          expectedVersion: { type: 'number', minimum: 1 },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('publishes bounded batch-save and bulk-transition contracts', async () => {
    const app = await NestFactory.create(OpenApiTestModule, { logger: false });

    try {
      const document = SwaggerModule.createDocument(app, {
        openapi: '3.0.0',
        info: { title: 'test', version: '1.0.0' },
        paths: {},
      });

      expect(document.components?.schemas?.BatchSaveCampaignsDto).toMatchObject({
        type: 'object',
        required: ['items'],
        properties: { items: { type: 'array', maxItems: 50 } },
      });
      expect(document.components?.schemas?.BulkTransitionCampaignsDto).toMatchObject({
        type: 'object',
        required: ['ids', 'lifecycleState'],
        properties: {
          ids: { type: 'array', maxItems: 50 },
          lifecycleState: { type: 'string' },
        },
      });
    } finally {
      await app.close();
    }
  });
});
