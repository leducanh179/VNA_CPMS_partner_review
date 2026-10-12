import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { z } from 'zod';
import { AccessApplicationService } from '../../access/application/access.application-service';
import { IdentityRepository } from '../../identity/application/identity.repository';
import { generateLocalCredential, hashLocalDemoPassword, hashLocalPassword, localDemoCredentialsEnabled } from '../../identity/application/local-auth-security';
import { BookingSetupRepository, type BookingContactSetup } from './booking-setup.repository';

/** Explicit administrator CLI setup. No public registration or account impersonation endpoint. */
@Injectable()
export class BookingSetupApplicationService {
  constructor(@Inject(BookingSetupRepository)private readonly repository:BookingSetupRepository,@Inject(AccessApplicationService)private readonly access:AccessApplicationService,@Inject(IdentityRepository)private readonly identity:IdentityRepository){}
  async provision(contact:BookingContactSetup,actor:ActorContext){
    const value=z.object({email:z.email(),displayName:z.string().min(1).max(150),organizationName:z.string().min(1).max(200),departmentId:z.string().uuid().nullable(),divisionId:z.string().uuid().nullable(),external:z.boolean()}).strict().parse(contact);
    return this.access.run(actor,async()=>{
      this.access.require('credential.manage');this.access.require('access.manage');
      const demo=localDemoCredentialsEnabled(),password=demo?await this.identity.readLocalDemoDefaultPassword():generateLocalCredential();
      const result=await this.repository.provision(value,demo?await hashLocalDemoPassword(password):await hashLocalPassword(password),!demo,this.access.snapshot().actor);
      return{...result,temporaryPassword:result.created&&!demo?password:null};
    });
  }
}
