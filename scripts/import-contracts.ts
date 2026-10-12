import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../apps/api/src/app.module';
import { ContractsApplicationService } from '../apps/api/src/modules/contracts/application/contracts.application-service';
import { ContractsExchangeApplicationService } from '../apps/api/src/modules/contracts/application/contracts-exchange.application-service';
import { IdentityApplicationService } from '../apps/api/src/modules/identity/application/identity.application-service';

/** Portable CLI: credentials and reports stay private; every write enters the Application Service. */
async function main() {
  const args=process.argv.slice(2);const option=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
  const credentialFile=process.env.CPMS_IMPORT_CREDENTIAL_FILE;
  if(!credentialFile)throw Error('Đặt CPMS_IMPORT_CREDENTIAL_FILE tới JSON riêng chứa email/password; không đặt mật khẩu trên command line.');
  const credentials=JSON.parse(await readFile(credentialFile,'utf8')) as {email:string;password:string};
  const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const identity=app.get(IdentityApplicationService);const login=await identity.login(credentials.email,credentials.password,'127.0.0.1');
    const actor=identity.actor(login.session);const contracts=app.get(ContractsApplicationService);const exchange=app.get(ContractsExchangeApplicationService);
    const directory=path.resolve('private-local/contracts-v1');await mkdir(directory,{recursive:true});
    if(args.includes('--apply')) {
      const id=option('--preview-id');if(!id)throw Error('Apply cần --preview-id đã đối soát.');
      const result=await contracts.importApply(id,{idempotencyKey:option('--idempotency-key')??randomUUID(),acknowledgeWarnings:args.includes('--acknowledge-warnings')},actor);
      await writeFile(path.join(directory,`apply-${id}.json`),JSON.stringify(result,null,2));
      console.log(JSON.stringify({contractId:result.contract.id,version:result.contract.recordVersion,slots:result.slots.length,allocations:result.allocations.length}));
    } else {
      const file=option('--snapshot');if(!file)throw Error('Preview cần --snapshot <JSON hoặc XLSX>.');
      const bytes=await readFile(file);if(bytes.length>8*1024*1024)throw Error('Snapshot tối đa 8 MB.');
      const preview=file.toLowerCase().endsWith('.xlsx')?await exchange.previewFile({fileName:path.basename(file),contentBase64:bytes.toString('base64'),sourceId:option('--source-id'),locale:option('--locale')},actor):await exchange.previewJson(JSON.parse(bytes.toString('utf8')),actor);
      const report=path.join(directory,`preview-${preview.id}.json`);await writeFile(report,JSON.stringify(preview,null,2));
      console.log(JSON.stringify({previewId:preview.id,mode:preview.mode,counts:preview.counts,warnings:preview.warnings.length,blocking:preview.blocking.length,report}));
    }
    await identity.logout(login.session);
  } finally { await app.close(); }
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Nhập hợp đồng thất bại.');process.exitCode=1;});
