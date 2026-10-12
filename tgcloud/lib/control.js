import {db,api,InputFile,BotApiError} from 'sdk';
import {eq,and,isNull,desc,inArray} from 'sdk/db';
import {organizations,locations,employees,shifts,devices,controlRequests,controlSubmissions,auditLog} from '../schema.js';
import {requireOwner,ownerOrg,resolvePhotoQr} from './service.js';
import {capturePublishedPhoto} from './ai-media.js';
import {requireInput} from './errors.js';
import {nonce} from './security.js';
import {validateCloseComment} from './schedule.js';
import {controlDeadline,controlPhotos,controlStatus,controlTime,controlCaption} from './control-rules.js';
const now=()=>Math.floor(Date.now()/1000);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{32}$/.test(x);
async function ownedRequest(tgId,requestId){
 const org=await requireOwner(tgId);
 const request=await db.select().from(controlRequests).where(and(eq(controlRequests.id,requestId),eq(controlRequests.orgId,org.id))).get();
 requireInput(!!request,'NOT_FOUND','Запрос контроля не найден');return {org,request};
}
async function recipient(tgId,requestId){
 requireInput(Number.isSafeInteger(tgId)&&tgId>0&&id(requestId),'BAD_CONTROL','Некорректный запрос контроля');
 const request=await db.select().from(controlRequests).where(eq(controlRequests.id,requestId)).get();
 requireInput(!!request,'NOT_FOUND','Запрос контроля не найден');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,request.orgId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
 requireInput(!!person&&request.targets.some(x=>x.id===person.id),'FORBIDDEN','Этот контроль назначен другому сотруднику');return {request,person};
}
export async function controlContext(tgId){
 const org=await ownerOrg(tgId),people=await db.select().from(employees).where(and(eq(employees.tgId,tgId),eq(employees.active,1))).all();
 const orgIds=[...new Set([...(org?[org.id]:[]),...people.map(x=>x.orgId)])];
 if(!orgIds.length)return {owner:null,tasks:[],requests:[]};
 const rows=await db.select().from(controlRequests).where(inArray(controlRequests.orgId,orgIds)).orderBy(desc(controlRequests.createdAt)).limit(200).all();
 const allowed=rows.filter(r=>r.orgId===org?.id||people.some(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id)));
 const subs=allowed.length?await db.select().from(controlSubmissions).where(inArray(controlSubmissions.requestId,allowed.map(r=>r.id))).all():[];
 const points=await db.select().from(locations).where(inArray(locations.orgId,orgIds)).all();
 const orgs=await db.select().from(organizations).where(inArray(organizations.id,orgIds)).all();
 const decorate=r=>({id:r.id,instruction:r.instruction,deadlineAt:r.deadlineAt,createdAt:r.createdAt,location:points.find(x=>x.id===r.locationId)?.name||'Точка',timezone:orgs.find(x=>x.id===r.orgId)?.timezone||'Europe/Moscow'});
 const tasks=allowed.filter(r=>people.some(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id))).map(r=>{
  const person=people.find(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id)),sub=subs.find(s=>s.requestId===r.id&&s.employeeId===person.id);
  return {...decorate(r),status:controlStatus(r,sub,now()),done:sub?.status==='done',blocked:['uploading','uncertain'].includes(sub?.status)};
 });
 const requests=org?allowed.filter(r=>r.orgId===org.id).map(r=>({...decorate(r),notificationDelivered:r.notificationState==='done',recipients:r.targets.map(p=>{
  const sub=subs.find(s=>s.requestId===r.id&&s.employeeId===p.id);return {name:p.name,status:controlStatus(r,sub,now()),photoCount:sub?.photos?.length||0,comment:sub?.status==='done'?sub.comment:null};
 })})):[];
 return {tasks,requests,owner:org?{timezone:org.timezone,locations:points.filter(p=>p.orgId===org.id).map(p=>({id:p.id,name:p.name})),employees:(await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.active,1))).all()).map(p=>({id:p.id,name:p.name}))}:null};
}
export async function createControl(tgId,{requestId,locationId,employeeId,instruction,deadline}){
 const org=await requireOwner(tgId);
 requireInput(id(requestId),'BAD_CONTROL','Некорректный номер запроса');
 const known=await db.select().from(controlRequests).where(eq(controlRequests.id,requestId)).get();
 if(known){requireInput(known.orgId===org.id,'FORBIDDEN','Номер запроса занят');return {requestId,notificationDelivered:known.notificationState==='done'};}
 requireInput(typeof instruction==='string'&&instruction.trim().length>=3&&instruction.length<=300,'BAD_INSTRUCTION','Задание: 3–300 символов');
 const deadlineAt=controlDeadline(deadline,org.timezone,now());
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc?.chatId,'BAD_LOCATION','Выберите точку с привязанной группой');
 let people;
 if(employeeId==='all'){
  const open=await db.select().from(shifts).where(and(eq(shifts.orgId,org.id),eq(shifts.locationId,loc.id),isNull(shifts.endedAt))).all();
  people=open.length?await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.active,1),inArray(employees.id,open.map(s=>s.employeeId)))).all():[];
 }else{
  requireInput(Number.isSafeInteger(Number(employeeId))&&Number(employeeId)>0,'BAD_EMPLOYEE','Выберите сотрудника');
  people=await db.select().from(employees).where(and(eq(employees.id,Number(employeeId)),eq(employees.orgId,org.id),eq(employees.active,1))).all();
 }
 requireInput(people.length>0,'NO_EMPLOYEES','Нет выбранных сотрудников. Для «всех на смене» нужны открытые смены на этой точке.');
 await db.insert(controlRequests).values({id:requestId,orgId:org.id,locationId:loc.id,instruction:instruction.trim(),deadlineAt,targets:people.map(p=>({id:p.id,name:p.name})),createdBy:tgId,createdAt:now()}).run();
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'control.requested',refId:requestId,at:now(),data:{locationId:loc.id,recipients:people.length,deadlineAt}}).run();
 return {requestId,notificationDelivered:await notifyControl(tgId,requestId)};
}
export async function notifyControl(tgId,requestId){
 const {org,request}=await ownedRequest(tgId,requestId);
 if(request.notificationState==='done')return true;
 const reserved=await db.update(controlRequests).set({notificationState:'sending'}).where(and(eq(controlRequests.id,requestId),eq(controlRequests.notificationState,'pending'))).run();
 if(reserved.rowsAffected!==1)return false;
 try{
  const [loc,bot]=await Promise.all([db.select().from(locations).where(and(eq(locations.id,request.locationId),eq(locations.orgId,org.id))).get(),api.getMe()]);
  requireInput(!!loc?.chatId,'NO_WORK_CHAT','Группа не привязана');
  const names=request.targets.map(x=>x.name).join(', '),text=`📷 Запрос фотоконтроля\n${loc.name}\nКому: ${names.length>2000?names.slice(0,1997)+'…':names}\nСрок: ${controlTime(request.deadlineAt,org.timezone)}\nЗадание: ${request.instruction}\nОткройте «Фотоконтроль» в Mini App бота и сканируйте QR точки. Фото и комментарий будут опубликованы в этой группе.`;
  const message=await api.sendMessage({chat_id:loc.chatId,text,reply_markup:{inline_keyboard:[[{text:'Открыть фотоконтроль',url:`https://t.me/${bot.username}?startapp=control`}]]}});
  await db.update(controlRequests).set({notificationState:'done',messageId:message.message_id}).where(eq(controlRequests.id,requestId)).run();return true;
 }catch(e){
  await db.update(controlRequests).set({notificationState:e instanceof BotApiError&&e.code>=400&&e.code<500?'pending':'uncertain'}).where(eq(controlRequests.id,requestId)).run();return false;
 }
}
export async function beginControl(tgId,requestId,token){
 const {request,person}=await recipient(tgId,requestId),qr=await resolvePhotoQr(tgId,token);
 requireInput(qr.orgId===request.orgId&&qr.locationId===request.locationId,'WRONG_LOCATION','Сканируйте QR точки, указанной в задании');
 const device=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Устройство отозвано');
 let sub=await db.select().from(controlSubmissions).where(and(eq(controlSubmissions.requestId,requestId),eq(controlSubmissions.employeeId,person.id))).get();
 requireInput(!sub||sub.status==='pending','CONTROL_SENT','Ответ уже отправлен или обрабатывается. Проверьте группу.');
 const expiresAt=now()+1200;
 if(sub){await db.update(controlSubmissions).set({expiresAt,deviceId:qr.deviceId}).where(eq(controlSubmissions.id,sub.id)).run();}
 else{[sub]=await db.insert(controlSubmissions).values({id:nonce(24),requestId,orgId:request.orgId,employeeId:person.id,deviceId:qr.deviceId,createdAt:now(),expiresAt}).returning().run();}
 const org=await db.select().from(organizations).where(eq(organizations.id,request.orgId)).get();
 const loc=await db.select().from(locations).where(eq(locations.id,request.locationId)).get();
 return {submissionId:sub.id,requestId,employee:person.name,location:loc.name,instruction:request.instruction,deadlineAt:request.deadlineAt,timezone:org.timezone,expiresAt};
}
export async function completeControl(tgId,submissionId,photos,comment){
 requireInput(id(submissionId),'BAD_CONTROL','Некорректная сессия контроля');
 const sub=await db.select().from(controlSubmissions).where(eq(controlSubmissions.id,submissionId)).get();
 requireInput(!!sub,'NOT_FOUND','Сессия не найдена');
 const {request,person}=await recipient(tgId,sub.requestId);
 requireInput(person.id===sub.employeeId,'FORBIDDEN','Сессия принадлежит другому сотруднику');
 if(sub.status==='done')return {done:true,photoCount:sub.photos.length,late:sub.completedAt>request.deadlineAt,alreadyDone:true};
 requireInput(sub.status==='pending','DELIVERY_UNCERTAIN','Ответ обрабатывается или доставка неизвестна. Проверьте группу с владельцем; повторная отправка заблокирована, чтобы не дублировать фотографии.');
 requireInput(sub.expiresAt>now(),'EXPIRED','Срок съёмки истёк. Сканируйте QR и сделайте новые снимки.');
 const device=await db.select().from(devices).where(and(eq(devices.id,sub.deviceId),eq(devices.orgId,request.orgId),eq(devices.locationId,request.locationId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Рабочее устройство отозвано — нужна новая проверка QR');
 const note=validateCloseComment(comment),bytes=controlPhotos(photos);
 const loc=await db.select().from(locations).where(and(eq(locations.id,request.locationId),eq(locations.orgId,request.orgId))).get();
 const org=await db.select().from(organizations).where(eq(organizations.id,request.orgId)).get();
 requireInput(!!loc?.chatId&&!!org,'NO_WORK_CHAT','Группа не привязана');
 const at=now(),reserved=await db.update(controlSubmissions).set({status:'uploading',comment:note}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'pending'))).run();
 requireInput(reserved.rowsAffected===1,'IN_PROGRESS','Фотографии уже отправляются');
 const caption=controlCaption({request,employee:person.name,location:loc.name,timezone:org.timezone,at,comment:note});
 let saved=[];
 try{
  const reply=request.messageId?{reply_parameters:{message_id:request.messageId,allow_sending_without_reply:true}}:{};
  const files=bytes.map((b,i)=>new InputFile(b,`control-${i+1}.jpg`,{type:'image/jpeg'}));
  const messages=files.length===1?[await api.sendPhoto({chat_id:loc.chatId,photo:files[0],caption,...reply})]:await api.sendMediaGroup({chat_id:loc.chatId,media:files.map((file,i)=>({type:'photo',media:file,...(i===0?{caption}:{})})),...reply});
  saved=messages.map(m=>({messageId:m.message_id,fileId:m.photo?.at(-1)?.file_id}));
  requireInput(saved.length===files.length&&saved.every(m=>m.messageId&&m.fileId),'TELEGRAM_PHOTO','Telegram не подтвердил все фотографии');
  await db.update(controlSubmissions).set({status:'done',completedAt:at,photos:saved}).where(eq(controlSubmissions.id,sub.id)).run();
 }catch(e){
  await db.update(controlSubmissions).set({status:e instanceof BotApiError&&e.code>=400&&e.code<500?'pending':'uncertain'}).where(eq(controlSubmissions.id,sub.id)).run();throw e;
 }
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'control.completed',refId:sub.id,at,data:{requestId:request.id,photoCount:bytes.length,late:at>request.deadlineAt}}).run();
 // AI observation must never turn a successful photo-control delivery into a failure.
 try{for(const p of saved){await capturePublishedPhoto({orgId:org.id,chatId:loc.chatId,messageId:p.messageId,employeeTgId:tgId,fileId:p.fileId,caption,at});}}
 catch(e){console.error('AI control media capture failed',e?.code||e?.name||'unknown');}
 return {done:true,photoCount:bytes.length,late:at>request.deadlineAt};
}
