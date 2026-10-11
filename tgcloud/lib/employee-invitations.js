import {db,api} from 'sdk';
import {eq,and,desc,lt} from 'sdk/db';
import {employeeJoinInvites,employeeJoinRequests,employees,organizations,auditLog} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput,DomainError} from './errors.js';
import {nonce} from './security.js';
import {APPROVAL_STALE_SECONDS,staleApprovalAction} from './employee-approval-recovery.js';
const now=()=>Math.floor(Date.now()/1000);
const valid=id=>Number.isSafeInteger(id)&&id>0;
async function audit(orgId,actor,action,ref){
 await db.insert(auditLog).values({orgId,actorTgId:actor,action,refId:String(ref),at:now(),data:{}}).run();
}
export async function createEmployeeInvite(tgId){
 const org=await requireOwner(tgId),bot=await api.getMe(),token=nonce(16);
 requireInput(typeof bot?.username==='string'&&/^[A-Za-z0-9_]{5,32}$/.test(bot.username),
  'NO_BOT_USERNAME','Не удалось получить имя бота');
 const issued=now(),expiresAt=issued+14*86400;
 await db.insert(employeeJoinInvites).values({token,orgId:org.id,createdBy:tgId,createdAt:issued,expiresAt}).run();
 await audit(org.id,tgId,'employee.invite_created',org.id);
 return {organization:org.name,url:`https://t.me/${bot.username}?start=join_${token}`,expiresAt};
}
export async function startEmployeeJoin(tgId,token){
 requireInput(valid(tgId),'UNAUTHORIZED','Требуется Telegram ID');
 requireInput(typeof token==='string'&&/^[A-Za-z0-9_-]{22}$/.test(token),'BAD_INVITE','Некорректная ссылка приглашения');
 const invite=await db.select().from(employeeJoinInvites).where(eq(employeeJoinInvites.token,token)).get();
 requireInput(invite&&invite.expiresAt>now()&&!invite.revokedAt,'EXPIRED_INVITE','Приглашение недействительно или истекло');
 const org=await db.select().from(organizations).where(eq(organizations.id,invite.orgId)).get();
 requireInput(!!org,'NOT_FOUND','Организация не найдена');
 const existing=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,tgId))).get();
 if(existing?.active)return {kind:'joined',organization:org.name};
 let request=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.userTgId,tgId)
 )).get();
 if(request?.status==='approved')throw new DomainError('INACTIVE_EMPLOYEE','Сотрудник ранее был подключён. Если доступ закрыт, обратитесь к владельцу для повторной активации.');
 if(request?.status==='pending')return {kind:'pending',organization:org.name};
 if(request?.status==='rejected')throw new DomainError('REJECTED','Ранее заявка была отклонена. Обратитесь к владельцу.');
 if(!request){
  [request]=await db.insert(employeeJoinRequests).values({
   orgId:org.id,userTgId:tgId,name:'',status:'draft',createdAt:now(),updatedAt:now()
  }).returning().run();
 }else await db.update(employeeJoinRequests).set({updatedAt:now()}).where(eq(employeeJoinRequests.id,request.id)).run();
 return {kind:'name',id:request.id,organization:org.name};
}
export async function submitEmployeeName(tgId,requestId,name){
 requireInput(valid(tgId)&&valid(requestId),'UNAUTHORIZED','Нет действительной заявки');
 requireInput(typeof name==='string'&&name.trim().length>=2&&name.trim().length<=100,
  'BAD_NAME','Напишите имя и фамилию: от 2 до 100 символов');
 const request=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.id,requestId),eq(employeeJoinRequests.userTgId,tgId),eq(employeeJoinRequests.status,'draft')
 )).get();
 requireInput(!!request,'NO_JOIN','Заявка устарела. Повторите переход по приглашению.');
 const changed=await db.update(employeeJoinRequests).set({name:name.trim(),status:'pending',updatedAt:now()}).where(and(
  eq(employeeJoinRequests.id,requestId),eq(employeeJoinRequests.userTgId,tgId),eq(employeeJoinRequests.status,'draft')
 )).run();
 requireInput(changed.rowsAffected===1,'REPLAY','Заявка уже обработана');
 await audit(request.orgId,tgId,'employee.join_requested',request.id);
 const org=await db.select().from(organizations).where(eq(organizations.id,request.orgId)).get();
 return {requestId:request.id,organization:org?.name||'Организация',ownerTgId:org?.ownerTgId,name:name.trim()};
}
export async function pendingEmployeeRequests(tgId){
 const org=await requireOwner(tgId);
 // Reconcile interrupted approvals when the owner opens the request list.
 // No scheduler and no automatic retry of a currently running request.
 const interrupted=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'approving'),
  lt(employeeJoinRequests.updatedAt,now()-APPROVAL_STALE_SECONDS)
 )).limit(20).all();
 for(const req of interrupted){
  const person=await db.select().from(employees).where(and(
   eq(employees.orgId,org.id),eq(employees.tgId,req.userTgId)
  )).get();
  const action=staleApprovalAction(req,person,now());
  if(!action)continue;
  const changed=await db.update(employeeJoinRequests).set({
   status:action,updatedAt:now(),...(action==='approved'?{reviewedBy:tgId,reviewedAt:now()}:{})
  }).where(and(eq(employeeJoinRequests.id,req.id),eq(employeeJoinRequests.orgId,org.id),
   eq(employeeJoinRequests.status,'approving'),eq(employeeJoinRequests.updatedAt,req.updatedAt))).run();
  if(changed.rowsAffected===1)await audit(org.id,tgId,'employee.approval_recovered',req.id);
 }
 const rows=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'pending')
 )).orderBy(desc(employeeJoinRequests.createdAt)).limit(10).all();
 return rows.map(r=>({id:r.id,name:r.name,createdAt:r.createdAt}));
}
export async function checkPendingEmployee(tgId,requestId){
 const org=await requireOwner(tgId);
 requireInput(valid(requestId),'BAD_JOIN','Некорректная заявка');
 const req=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.id,requestId),eq(employeeJoinRequests.status,'pending')
 )).get();
 requireInput(!!req,'NOT_FOUND','Заявка уже обработана или недоступна');
 return {id:req.id,name:req.name,organization:org.name};
}
export async function rejectEmployeeRequest(tgId,requestId){
 const org=await requireOwner(tgId);
 const existing=await checkPendingEmployee(tgId,requestId);
 const changed=await db.update(employeeJoinRequests).set({status:'rejected',reviewedBy:tgId,reviewedAt:now(),updatedAt:now()})
 .where(and(eq(employeeJoinRequests.id,requestId),eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'pending'))).run();
 requireInput(changed.rowsAffected===1,'REPLAY','Заявка уже обработана');
 await audit(org.id,tgId,'employee.join_rejected',requestId);
 return existing;
}
export async function approveEmployeeRequest(tgId,requestId,hourlyKopeks){
 const org=await requireOwner(tgId);
 requireInput(Number.isSafeInteger(hourlyKopeks)&&hourlyKopeks>=0&&hourlyKopeks<=1e9,
  'BAD_RATE','Укажите ставку в рублях за час, например 350');
 const req=await db.select().from(employeeJoinRequests).where(and(
  eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.id,requestId),eq(employeeJoinRequests.status,'pending')
 )).get();
 requireInput(!!req,'NOT_FOUND','Заявка уже обработана или недоступна');
 // Claim pending approval before employee mutation: a competing reject/approve
 // may not alter the same request. No external payment or Telegram send here.
 const claimed=await db.update(employeeJoinRequests).set({status:'approving',updatedAt:now()}).where(and(
  eq(employeeJoinRequests.id,req.id),eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'pending')
 )).run();
 requireInput(claimed.rowsAffected===1,'REPLAY','Заявка уже обрабатывается');
 let person;
 try{
  person=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,req.userTgId))).get();
  if(!person){
   [person]=await db.insert(employees).values({orgId:org.id,tgId:req.userTgId,name:req.name,
    hourlyKopeks,shiftBonusKopeks:0,active:1}).returning().run();
  }else{
   await db.update(employees).set({active:1,hourlyKopeks}).where(and(eq(employees.id,person.id),eq(employees.orgId,org.id))).run();
  }
  const changed=await db.update(employeeJoinRequests).set({status:'approved',reviewedBy:tgId,reviewedAt:now(),updatedAt:now()})
   .where(and(eq(employeeJoinRequests.id,req.id),eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'approving'))).run();
  requireInput(changed.rowsAffected===1,'REPLAY','Заявка уже обработана');
 }catch(error){
  // Safe retry on transient failures; employee unique index prevents duplicates.
  await db.update(employeeJoinRequests).set({status:'pending',updatedAt:now()}).where(and(
   eq(employeeJoinRequests.id,req.id),eq(employeeJoinRequests.orgId,org.id),eq(employeeJoinRequests.status,'approving')
  )).run();
  throw error;
 }
 await audit(org.id,tgId,'employee.join_approved',req.id);
 return {organization:org.name,name:req.name,userTgId:req.userTgId,employeeId:person.id};
}
