import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ExcelJsSpreadsheetAdapter } from '../campaign/infrastructure/exceljs-spreadsheet.adapter';
import { DirectoryImportApplicationService } from './application/directory-import.application-service';
import { PersonnelBootstrapApplicationService, PersonnelBootstrapRepository } from './application/personnel-bootstrap.application-service';
import { PrismaPersonnelBootstrapRepository } from './infrastructure/prisma-directory.repository';

/** Local CLI composition root. No HTTP server and no public bootstrap endpoint. */
@Module({ imports: [PrismaModule], providers: [ExcelJsSpreadsheetAdapter,
  { provide: PersonnelBootstrapRepository, useClass: PrismaPersonnelBootstrapRepository },
  { provide: PersonnelBootstrapApplicationService, inject: [ExcelJsSpreadsheetAdapter, PersonnelBootstrapRepository],
    useFactory: (spreadsheets: ExcelJsSpreadsheetAdapter, repository: PersonnelBootstrapRepository) =>
      new PersonnelBootstrapApplicationService(new DirectoryImportApplicationService(spreadsheets), repository) },
] })
export class PersonnelProvisioningModule {}
