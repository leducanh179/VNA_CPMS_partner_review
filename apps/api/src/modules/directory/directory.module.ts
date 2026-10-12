import { Module } from '@nestjs/common';
import { DirectoryApplicationService } from './application/directory.application-service';
import { DirectoryRepository } from './application/directory.repository';
import { PrismaDirectoryRepository } from './infrastructure/prisma-directory.repository';
import { DirectoryController } from './transport/directory.controller';
@Module({controllers:[DirectoryController],providers:[DirectoryApplicationService,{provide:DirectoryRepository,useClass:PrismaDirectoryRepository}],exports:[DirectoryRepository,DirectoryApplicationService]})
export class DirectoryModule{}
