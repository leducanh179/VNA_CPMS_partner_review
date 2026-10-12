import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@cpms/domain';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BookingSetupRepository, type BookingContactSetup } from '../application/booking-setup.repository';

@Injectable()
export class PrismaBookingSetupRepository extends BookingSetupRepository {
  constructor(@Inject(PrismaService) private readonly prisma:PrismaService){super();}
  async provision(contact:BookingContactSetup,passwordHash:string,mustChangePassword:boolean,actor:ActorContext){
    const db=this.prisma.database;const email=contact.email.toLowerCase();let account=await db.actor.findUnique({where:{loginEmail:email}});const created=!account;
    if(!account){
      let departmentId=contact.departmentId,divisionId=contact.divisionId;
      if(contact.external){const org=await db.employmentOrgUnit.upsert({where:{identityKey:`booking-contact:${contact.organizationName}`},create:{identityKey:`booking-contact:${contact.organizationName}`,sourceName:contact.organizationName,kind:'DEPARTMENT',sourceProvider:'BOOKING_CONTACT'},update:{}});departmentId=org.id;divisionId=null;}
      const department=departmentId?await db.employmentOrgUnit.findUnique({where:{id:departmentId}}):null;const division=divisionId?await db.employmentOrgUnit.findUnique({where:{id:divisionId}}):null;
      if(!department?.isActive||department.kind!=='DEPARTMENT'||divisionId&&(!division?.isActive||division.parentId!==department.id))throw new BadRequestException('Cần xác định đúng CQĐV cho tài khoản đặt chỗ.');
      let person=await db.personnelDirectoryEntry.findFirst({where:{email:{equals:email,mode:'insensitive'},isActive:true}});
      if(!person)person=await db.personnelDirectoryEntry.create({data:{employeeCode:`CONTACT:${email}`,fullName:contact.displayName,email,organizationName:department.sourceName,departmentName:division?.sourceName??null,sourceProvider:'BOOKING_CONTACT',sourceReference:'User-supplied booking contact; contact key is not an HR employee code',displayGroup:'BOOKING_CONTACT'}});
      account=await db.actor.create({data:{key:`booking-contact:${email}`,displayName:person.fullName,loginEmail:email,accountKind:'PERSONNEL',personnelEmployeeCode:person.employeeCode,employment:{create:{departmentId:department.id,divisionId,displayGroup:'BOOKING_CONTACT'}},credential:{create:{passwordHash,mustChangePassword}},roles:{create:{roleCode:contact.external?'VENDOR':'SLOT_OPERATOR'}}}});
    }
    if(!account.isActive)throw new BadRequestException('Tài khoản liên hệ đang ngừng hoạt động; không tự kích hoạt lại.');
    let changed=created;
    for(const permissionCode of ['booking.read','booking.report',...(contact.external?['booking.create','booking.update','booking.delete','booking.restore','booking.purge','booking.submit','booking.confirm']:['booking.approve','booking.report.approve']),...(created?['campaign.read']:[])]){
      const module=permissionCode.split('.')[0]!.toUpperCase(),scopeKey=JSON.stringify(['MODULE',module,null,null,null]);
      const old=await db.accountPermissionOverride.findUnique({where:{actorId_permissionCode_scopeKey:{actorId:account.id,permissionCode,scopeKey}}});
      if(old)continue;
      await db.accountPermissionOverride.create({data:{actorId:account.id,permissionCode,scopeKey,scopeType:'MODULE',module,effect:'ALLOW',relation:module==='BOOKING'?'ASSIGNED':'ALL'}});changed=true;
    }
    if(changed){await db.actor.update({where:{id:account.id},data:{authzVersion:{increment:1}}});await db.accessPolicyState.upsert({where:{key:'access'},create:{key:'access'},update:{recordVersion:{increment:1}}});await db.auditEvent.create({data:{actorId:actor.id,originalActorId:actor.session?.originalActorId??actor.id,contextMode:actor.session?.mode??'DIRECT',action:'booking.contact.setup',entityType:'actor',entityId:account.id,payload:{email,created,source:'BOOKING_CONTACT',permissions:'Booking ASSIGNED; new contacts Campaign read'}}});}
    return{id:account.id,created};
  }
}
