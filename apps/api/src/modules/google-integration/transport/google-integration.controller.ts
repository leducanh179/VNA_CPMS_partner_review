import type { ActorContext } from '@cpms/domain';
import { Body, Controller, Get, Inject, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Environment } from '../../../config/environment';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { RequirePermission } from '../../auth/permission.guard';
import { GoogleIntegrationApplicationService } from '../application/google-integration.application-service';
import { GoogleSheetCompareDto, GoogleSheetImportDto, GoogleSheetResultTabDto, GoogleSheetSourceDto, GoogleSpreadsheetUrlDto } from './google-integration.dto';

const googleDtoPipe = (expectedType: new () => object) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true });

@ApiTags('google-integration')
@Controller('integrations/google')
export class GoogleIntegrationController {
  constructor(
    @Inject(GoogleIntegrationApplicationService) private readonly google: GoogleIntegrationApplicationService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get('status') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Show Google configuration and connected account without tokens' })
  status(@CurrentActor() actor: ActorContext) { return this.google.status(actor); }

  @Get('drive/status') @RequirePermission('system.manage') @ApiOperation({ summary: 'Show Campaign Drive integration status without tokens' })
  driveStatus() { return this.google.driveStatus(); }

  @Post('drive/connect') @RequirePermission('system.manage') @ApiOperation({ summary: 'Connect the configured shared Campaign Drive identity' })
  driveConnect(@CurrentActor() actor: ActorContext) { return this.google.beginDriveConnection(actor); }

  @Post('drive/disconnect') @RequirePermission('system.manage') @ApiOperation({ summary: 'Revoke the shared Campaign Drive identity' })
  driveDisconnect(@CurrentActor() actor: ActorContext) { return this.google.disconnectDriveConnection(actor); }

  @Post('connect') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Begin server-side Google OAuth authorization-code flow' })
  connect(@CurrentActor() actor: ActorContext, @Query('returnTo') returnTo?: string) { return this.google.beginConnection(actor, returnTo); }

  @Get('callback') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Validate OAuth state and store encrypted Google tokens' })
  async callback(
    @CurrentActor() actor: ActorContext,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Res() response: Response,
  ) {
    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true });
    try {
      const result = await this.google.completeConnection(actor, code, state, oauthError);
      const target = new URL(result.returnTo, webOrigin);
      target.searchParams.set('google', 'connected');
      response.redirect(303, target.toString());
    } catch {
      let isDriveConnection = false;
      try { isDriveConnection = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf8')).purpose === 'CAMPAIGN_DRIVE'; }
      catch { /* A malformed state is rejected by the service. */ }
      response.redirect(303, isDriveConnection ? `${webOrigin}/admin/system?section=DRIVE&google=error` : `${webOrigin}/campaigns?google=error`);
    }
  }

  @Post('disconnect') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Revoke and remove the current actor Google connection' })
  disconnect(@CurrentActor() actor: ActorContext) { return this.google.disconnect(actor); }

  @Post('spreadsheets/inspect') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Validate a Google Sheets URL and list accessible tabs' })
  inspect(@Body(googleDtoPipe(GoogleSpreadsheetUrlDto)) input: GoogleSpreadsheetUrlDto, @CurrentActor() actor: ActorContext) { return this.google.inspect(actor, input.spreadsheetUrl); }

  @Post('spreadsheets/preview') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Preview one Google Sheet tab through the IV-A engine' })
  preview(@Body(googleDtoPipe(GoogleSheetSourceDto)) input: GoogleSheetSourceDto, @CurrentActor() actor: ActorContext) { return this.google.preview(actor, input); }

  @Post('spreadsheets/import') @RequirePermission('campaign.update') @ApiOperation({ summary: 'Confirm Google Sheet creates and optimistic-lock updates' })
  importSheet(@Body(googleDtoPipe(GoogleSheetImportDto)) input: GoogleSheetImportDto, @CurrentActor() actor: ActorContext) { return this.google.import(actor, input); }

  @Post('spreadsheets/compare') @RequirePermission('campaign.read') @ApiOperation({ summary: 'Compare selected Google Sheet rows with canonical CPMS Campaigns' })
  compare(@Body(googleDtoPipe(GoogleSheetCompareDto)) input: GoogleSheetCompareDto, @CurrentActor() actor: ActorContext) { return this.google.compare(actor, input); }

  @Post('spreadsheets/tabs/diff') @RequirePermission('campaign.update') @ApiOperation({ summary: 'Create an idempotent CPMS_DIFF result tab without modifying the source tab' })
  createDiff(@Body(googleDtoPipe(GoogleSheetResultTabDto)) input: GoogleSheetResultTabDto, @CurrentActor() actor: ActorContext) { return this.google.createDiffTab(actor, input); }

  @Post('spreadsheets/tabs/sync') @RequirePermission('campaign.update') @ApiOperation({ summary: 'Create an idempotent CPMS_SYNC tab from CPMS source-of-truth data' })
  createSync(@Body(googleDtoPipe(GoogleSheetResultTabDto)) input: GoogleSheetResultTabDto, @CurrentActor() actor: ActorContext) { return this.google.createSyncTab(actor, input); }
}
