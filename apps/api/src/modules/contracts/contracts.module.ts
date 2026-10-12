import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { QcttCatalogModule } from '../qctt-catalog/qctt-catalog.module';
import { INVENTORY_CONSUMPTION_PROVIDER,SPREADSHEET_DOCUMENT_PORT } from '@cpms/integrations';
import { ExcelJsSpreadsheetAdapter } from '../campaign/infrastructure/exceljs-spreadsheet.adapter';
import { ContractsExchangeApplicationService } from './application/contracts-exchange.application-service';
import { ContractsController } from './transport/contracts.controller';
import { ContractsApplicationService } from './application/contracts.application-service';
import { ContractsRepository } from './application/contracts.repository';
import { PrismaContractsRepository } from './infrastructure/prisma-contracts.repository';
import { BookingCoreModule } from '../booking/booking-core.module';
import { BookingConsumptionProvider } from '../booking/infrastructure/booking-consumption.provider';
import { ContractManagementApplicationService } from './application/contract-management.application-service';
import { ContractFormDraftApplicationService } from './application/contract-form-draft.application-service';
import { ContractFormDraftRepository } from './application/contract-form-draft.repository';
import { PrismaContractFormDraftRepository } from './infrastructure/prisma-contract-form-draft.repository';
import { ContractFormDraftController } from './transport/contract-form-draft.controller';

@Module({ imports:[BookingCoreModule,DirectoryModule,QcttCatalogModule],controllers:[ContractsController,ContractFormDraftController],providers:[ContractsApplicationService,ContractManagementApplicationService,ContractsExchangeApplicationService,ContractFormDraftApplicationService,
  {provide:SPREADSHEET_DOCUMENT_PORT,useClass:ExcelJsSpreadsheetAdapter},
  { provide:ContractsRepository,useClass:PrismaContractsRepository },
  { provide:ContractFormDraftRepository,useClass:PrismaContractFormDraftRepository },
  { provide:INVENTORY_CONSUMPTION_PROVIDER,useExisting:BookingConsumptionProvider }],exports:[ContractsApplicationService,ContractManagementApplicationService,ContractsRepository] })
export class ContractsModule {}
