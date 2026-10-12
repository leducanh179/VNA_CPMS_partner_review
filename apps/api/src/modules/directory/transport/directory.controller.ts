import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DirectoryApplicationService } from '../application/directory.application-service';
@ApiTags('directory-notes-v1')
@Controller()
export class DirectoryController {
  constructor(@Inject(DirectoryApplicationService) private readonly service:DirectoryApplicationService){}
  @Get('directory/people') people(@Query() query:Record<string,string>){return this.service.people(query);}
  @Post('directory/sync/preview') @HttpCode(200) preview(@Body() body:unknown){return this.service.synchronize(body,false);}
  @Post('directory/sync/apply') @HttpCode(200) sync(@Body() body:unknown){return this.service.synchronize(body,true);}
  @Get('directory/suppliers') suppliers(@Query() query:Record<string,string>){return this.service.suppliers(query);}
  @Post('directory/suppliers') @HttpCode(200) saveSupplier(@Body() body:unknown){return this.service.saveSupplier(body);}
  @Get('personal-notes') notes(){return this.service.notes();}
  @Post('personal-notes') @HttpCode(200) saveNote(@Body() body:unknown){return this.service.saveNote(body);}
  @Post('personal-notes/:id/delete') @HttpCode(200) deleteNote(@Param('id') id:string,@Body() body:unknown){return this.service.deleteNote(id,body);}
}
