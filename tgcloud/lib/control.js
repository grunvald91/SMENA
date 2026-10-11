import {db,api,InputFile,BotApiError} from 'sdk';
import {eq,and,isNull,desc,inArray} from 'sdk/db';
import {organizations,locations,employees,shifts,devices,controlRequests,controlSubmissions,auditLog,controlReviews} from '../schema.js';
import {requireOwner,ownerOrg,resolvePhotoQr} from './service.js';
import {describeOrganizationSelection} from './organization-selection-service.js';
import {legacyOwnerForSelection} from './scoped-owner.js';
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
 requireInput(!!request&&!request.cancelledAt,'NOT_FOUND','Запрос контроля не найден или отменён');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,request.orgId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
 requireInput(!!person&&request.targets.some(x=>x.id===person.id),'FORBIDDEN','Этот контроль назначен другому сотруднику');return {request,person};
}
export async function controlContext(tgId){
 const [legacy,state,people]=await Promise.all([ownerOrg(tgId),describeOrganizationSelection(tgId),db.select().from(employees).where(and(eq(employees.tgId,tgId),eq(employees.active,1))).all()]);
 const org=legacyOwnerForSelection(legacy,state);
 const orgIds=[...new Set([...(org?[org.id]:[]),...people.map(x=>x.orgId)])];
 if(!orgIds.length)return {owner:null,tasks:[],requests:[]};
 const rows=await db.select().from(controlRequests).where(inArray(controlRequests.orgId,orgIds)).orderBy(desc(controlRequests.createdAt)).all();
 const allowed=rows.filter(r=>r.orgId===org?.id||people.some(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id)));
 const subs=[];
 for(let i=0;i<allowed.length;i+=150)subs.push(...await db.select().from(controlSubmissions).where(inArray(controlSubmissions.requestId,allowed.slice(i,i+150).map(r=>r.id))).all());
 const reviews=org?await db.select().from(controlReviews).where(eq(controlReviews.orgId,org.id)).all():[];
 const myReviews=[];
 for(let i=0;i<subs.length;i+=150)myReviews.push(...await db.select().from(controlReviews).where(inArray(controlReviews.submissionId,subs.slice(i,i+150).map(s=>s.id))).all());
 const points=await db.select().from(locations).where(inArray(locations.orgId,orgIds)).all();
 const orgs=await db.select().from(organizations).where(inArray(organizations.id,orgIds)).all();
 const decorate=r=>({id:r.id,instruction:r.instruction,deadlineAt:r.deadlineAt,createdAt:r.createdAt,location:points.find(x=>x.id===r.locationId)?.name||'Точка',timezone:orgs.find(x=>x.id===r.orgId)?.timezone||'Europe/Moscow',cancelled:!!r.cancelledAt});
 const tasks=allowed.filter(r=>people.some(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id))).map(r=>{
  const person=people.find(p=>p.orgId===r.orgId&&r.targets.some(t=>t.id===p.id)),sub=subs.find(s=>s.requestId===r.id&&s.employeeId===person.id);
  const review=myReviews.find(x=>x.submissionId===sub?.id);
  return {...decorate(r),status:r.cancelledAt?'Отменено':review?.revision===(sub?.revision||0)&&review?.decision==='rework'?'Доработать: '+review.note:review?.revision===(sub?.revision||0)&&review?.decision==='accepted'?'Принято':controlStatus(r,sub,now()),done:!!r.cancelledAt||sub?.status==='done'&&!(review?.revision===(sub?.revision||0)&&review?.decision==='rework'),blocked:['uploading','uncertain'].includes(sub?.status)};
 });
 const requests=org?allowed.filter(r=>r.orgId===org.id).map(r=>({...decorate(r),notificationDelivered:r.notificationState==='done',notificationState:r.notificationState,recipients:r.targets.map(p=>{
  const sub=subs.find(s=>s.requestId===r.id&&s.employeeId===p.id);const review=reviews.find(x=>x.submissionId===sub?.id),loc=points.find(x=>x.id===r.locationId);
  return {id:p.id,name:p.name,submissionId:sub?.id,revision:sub?.revision||0,state:sub?.status||'pending',review:review?.revision===(sub?.revision||0)?review.decision:null,status:review?.revision===(sub?.revision||0)&&review?.decision==='accepted'?'Принято':review?.revision===(sub?.revision||0)&&review?.decision==='rework'?'Доработать: '+review.note:controlStatus(r,sub,now()),photoCount:sub?.photos?.length||0,comment:sub?.status==='done'?sub.comment:null,
   messageLinks:(sub?.photos||[]).map(p=>groupMessageLink(loc?.chatId,p.messageId)).filter(Boolean)};
 })})):[];
 return {tasks,requests,owner:org?{timezone:org.timezone,locations:points.filter(p=>p.orgId===org.id).map(p=>({id:p.id,name:p.name})),employees:(await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.active,1))).all()).map(p=>({id:p.id,name:p.name}))}:null};
}
export async function createControl(tgId,{requestId,locationId,employeeId,instruction,deadline}){
 const org=await requireOwner(tgId);
 requireInput(id(requestId),'BAD_CONTROL','Некорректный номер запроса');
 const known=await db.select().from(controlRequests).where(eq(controlRequests.id,requestId)).get();
 if(known){requireInput(known.orgId===org.id,'FORBIDDEN','Номер запроса занят');requireInput(known.locationId===Number(locationId)&&known.instruction===instruction?.trim()&&known.deadlineAt===controlDeadline(deadline,org.timezone,known.createdAt)&&(employeeId==='all'||known.targets.length===1&&known.targets[0].id===Number(employeeId)),'CONFLICT','Номер запроса уже использован для другого задания');return {requestId,notificationDelivered:known.notificationState==='done'};}
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
 requireInput(!request.cancelledAt,'CANCELLED','Запрос отменён');
 if(request.notificationState==='done')return true;
 const reserved=await db.update(controlRequests).set({notificationState:'sending',notificationAttemptAt:now()}).where(and(eq(controlRequests.id,requestId),eq(controlRequests.notificationState,'pending'))).run();
 if(reserved.rowsAffected!==1)return false;
 let receipt=null,attempted=false;
 try{
  const [loc,bot]=await Promise.all([db.select().from(locations).where(and(eq(locations.id,request.locationId),eq(locations.orgId,org.id))).get(),api.getMe()]);
  requireInput(!!loc?.chatId,'NO_WORK_CHAT','Группа не привязана');
  const names=request.targets.map(x=>x.name).join(', '),text=`📷 Запрос фотоконтроля\n${loc.name}\nКому: ${names.length>2000?names.slice(0,1997)+'…':names}\nСрок: ${controlTime(request.deadlineAt,org.timezone)}\nЗадание: ${request.instruction}\nОткройте «Фотоконтроль» в Mini App бота и сканируйте QR точки. Фото и комментарий будут опубликованы в этой группе.`;
  attempted=true;
  const message=await api.sendMessage({chat_id:loc.chatId,text,reply_markup:{inline_keyboard:[[{text:'Открыть фотоконтроль',url:`https://t.me/${bot.username}?startapp=control`}]]}});
  receipt={notificationState:'done',messageId:message.message_id};
  await db.update(controlRequests).set(receipt).where(eq(controlRequests.id,requestId)).run();return true;
 }catch(e){
  await db.update(controlRequests).set(receipt||{notificationState:!attempted||e instanceof BotApiError&&e.code>=400&&e.code<500?'pending':'uncertain'}).where(eq(controlRequests.id,requestId)).run();return !!receipt;
 }
}
export async function beginControl(tgId,requestId,token){
 const {request,person}=await recipient(tgId,requestId),qr=await resolvePhotoQr(tgId,token);
 requireInput(qr.orgId===request.orgId&&qr.locationId===request.locationId,'WRONG_LOCATION','Сканируйте QR точки, указанной в задании');
 const device=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Устройство отозвано');
 let sub=await db.select().from(controlSubmissions).where(and(eq(controlSubmissions.requestId,requestId),eq(controlSubmissions.employeeId,person.id))).get();
 const review=sub?await db.select().from(controlReviews).where(eq(controlReviews.submissionId,sub.id)).get():null;
 if(sub?.status==='done'&&review?.revision===(sub?.revision||0)&&review?.decision==='rework'){
  const changed=await db.update(controlSubmissions).set({status:'pending',revision:(sub.revision||0)+1,photos:null,completedAt:null}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'done'),eq(controlSubmissions.revision,sub.revision||0))).run();
  requireInput(changed.rowsAffected===1,'CONFLICT','Контроль изменился');
  await db.update(controlReviews).set({decision:'awaiting',revision:(sub.revision||0)+1}).where(eq(controlReviews.submissionId,sub.id)).run();
  sub={...sub,status:'pending',revision:(sub.revision||0)+1};
 }
 requireInput(!sub||sub.status==='pending','CONTROL_SENT','Ответ уже отправлен или обрабатывается. Проверьте группу.');
 const expiresAt=now()+1200;
 if(sub){const changed=await db.update(controlSubmissions).set({expiresAt,deviceId:qr.deviceId}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'pending'),eq(controlSubmissions.revision,sub.revision||0))).run();requireInput(changed.rowsAffected===1,'CONFLICT','Ответ уже обрабатывается');}
 else{[sub]=await db.insert(controlSubmissions).values({id:nonce(24),requestId,orgId:request.orgId,employeeId:person.id,deviceId:qr.deviceId,createdAt:now(),expiresAt}).returning().run();}
 const org=await db.select().from(organizations).where(eq(organizations.id,request.orgId)).get();
 const loc=await db.select().from(locations).where(eq(locations.id,request.locationId)).get();
 return {submissionId:sub.id,revision:sub.revision||0,requestId,employee:person.name,location:loc.name,instruction:request.instruction,deadlineAt:request.deadlineAt,timezone:org.timezone,expiresAt};
}
export async function completeControl(tgId,submissionId,photos,comment,revision=0){
 requireInput(id(submissionId),'BAD_CONTROL','Некорректная сессия контроля');
 const sub=await db.select().from(controlSubmissions).where(eq(controlSubmissions.id,submissionId)).get();
 requireInput(!!sub,'NOT_FOUND','Сессия не найдена');
 requireInput(revision===(sub.revision||0),'CONFLICT','Задание обновилось. Откройте его заново');
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
 const at=now(),reserved=await db.update(controlSubmissions).set({status:'uploading',comment:note,lastAttemptAt:now()}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'pending'),eq(controlSubmissions.revision,revision))).run();
 requireInput(reserved.rowsAffected===1,'IN_PROGRESS','Фотографии уже отправляются');
 let receipt=null;
 const caption=controlCaption({request,employee:person.name,location:loc.name,timezone:org.timezone,at,comment:note});
 try{
  const reply=request.messageId?{reply_parameters:{message_id:request.messageId,allow_sending_without_reply:true}}:{};
  const files=bytes.map((b,i)=>new InputFile(b,`control-${i+1}.jpg`,{type:'image/jpeg'}));
  const messages=files.length===1?[await api.sendPhoto({chat_id:loc.chatId,photo:files[0],caption,...reply})]:await api.sendMediaGroup({chat_id:loc.chatId,media:files.map((file,i)=>({type:'photo',media:file,...(i===0?{caption}:{})})),...reply});
  const saved=messages.map(m=>({messageId:m.message_id,fileId:m.photo?.at(-1)?.file_id}));
  requireInput(saved.length===files.length&&saved.every(m=>m.messageId&&m.fileId),'TELEGRAM_PHOTO','Telegram не подтвердил все фотографии');
  receipt={status:'done',completedAt:at,photos:saved};
  const savedResult=await db.update(controlSubmissions).set(receipt).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'uploading'),eq(controlSubmissions.revision,revision))).run();requireInput(savedResult.rowsAffected===1,'CONFLICT','Ответ изменился во время отправки');
 }catch(e){
  const recovery=await db.update(controlSubmissions).set(receipt||{status:e instanceof BotApiError&&e.code>=400&&e.code<500?'pending':'uncertain'}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,'uploading'),eq(controlSubmissions.revision,revision))).run();if(!receipt)throw e;requireInput(recovery.rowsAffected===1,'CONFLICT','Состояние изменилось во время отправки. Владелец должен сверить фото в группе.');
 }
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'control.completed',refId:sub.id,at,data:{requestId:request.id,photoCount:bytes.length,late:at>request.deadlineAt}}).run();
 return {done:true,photoCount:bytes.length,late:at>request.deadlineAt};
}

function groupMessageLink(chatId,messageId){return /^-100\d+$/.test(String(chatId))&&Number.isSafeInteger(messageId)?`https://t.me/c/${String(chatId).slice(4)}/${messageId}`:null;}
export async function ownerControlAction(tgId,input){
 const {org,request}=await ownedRequest(tgId,input.requestId);
 requireInput(input.confirmed===true,'CONFIRM_REQUIRED','Подтвердите решение');
 const note=typeof input.note==='string'?input.note.trim():'';
 requireInput(note.length>=5&&note.length<=500,'BAD_REASON','Укажите причину: 5–500 символов');
 if(input.action==='cancel'){
  await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'control.cancelled',refId:request.id,data:{note},at:now()}).run();
  await db.update(controlRequests).set({cancelledAt:now()}).where(eq(controlRequests.id,request.id)).run();return {cancelled:true};
 }
 requireInput(!request.cancelledAt,'CANCELLED','Запрос отменён');
 if(input.action==='notificationMissing'||input.action==='notificationReceived'){
  requireInput(['uncertain','sending'].includes(request.notificationState),'CONFLICT','Уведомление не требует сверки');
  requireInput((request.notificationAttemptAt||request.createdAt)<now()-300,'IN_PROGRESS','Подождите окончания текущей отправки');
  const received=input.action==='notificationReceived';
  if(received)requireInput(Number.isSafeInteger(input.messageId)&&input.messageId>0,'BAD_MESSAGE','Укажите номер сообщения в группе');
  await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'control.notification_resolved',refId:request.id,data:{note,received},at:now()}).run();
  const changed=await db.update(controlRequests).set(received?{notificationState:'done',messageId:input.messageId}:{notificationState:'pending'}).where(and(eq(controlRequests.id,request.id),eq(controlRequests.notificationState,request.notificationState))).run();requireInput(changed.rowsAffected===1,'CONFLICT','Состояние изменилось');return {received};
 }
 const sub=await db.select().from(controlSubmissions).where(and(eq(controlSubmissions.id,input.submissionId),eq(controlSubmissions.requestId,request.id),eq(controlSubmissions.orgId,org.id))).get();requireInput(!!sub,'NOT_FOUND','Ответ не найден');
 requireInput(input.revision===(sub.revision||0),'CONFLICT','Ответ изменился. Обновите данные');
 if(input.action==='deliveryMissing'||input.action==='deliveryReceived'){
  requireInput(['uploading','uncertain'].includes(sub.status),'CONFLICT','Доставка не требует сверки');
  requireInput((sub.lastAttemptAt||sub.createdAt)<now()-300,'IN_PROGRESS','Подождите окончания отправки');
  const received=input.action==='deliveryReceived';
  if(received)requireInput(Array.isArray(input.messageIds)&&input.messageIds.length>0&&input.messageIds.length<=10&&new Set(input.messageIds).size===input.messageIds.length&&input.messageIds.every(n=>Number.isSafeInteger(n)&&n>0),'BAD_MESSAGE','Укажите номера 1–10 сообщений с фото');
  await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:received?'control.delivery_confirmed':'control.retry_allowed',refId:sub.id,data:{note},at:now()}).run();
  const result=await db.update(controlSubmissions).set(received?{status:'done',completedAt:sub.lastAttemptAt||sub.createdAt,photos:input.messageIds.map(messageId=>({messageId,fileId:null}))}:{status:'pending',revision:(sub.revision||0)+1,expiresAt:now()-1}).where(and(eq(controlSubmissions.id,sub.id),eq(controlSubmissions.status,sub.status),eq(controlSubmissions.revision,sub.revision||0))).run();requireInput(result.rowsAffected===1,'CONFLICT','Состояние изменилось');return {received,retryAllowed:!received};
 }
 requireInput(['accept','rework'].includes(input.action),'BAD_ACTION','Неизвестное действие');
 requireInput(sub.status==='done','NOT_DELIVERED','Сначала требуется подтверждённая доставка фото');
 const previous=await db.select().from(controlReviews).where(eq(controlReviews.submissionId,sub.id)).get();
 const decision=input.action==='accept'?'accepted':'rework';
 const item={decision,note,photos:sub.photos,comment:sub.comment,completedAt:sub.completedAt,revision:sub.revision||0,actorTgId:tgId,at:now()};
 const value={submissionId:sub.id,orgId:org.id,decision,note,revision:sub.revision||0,history:[...(previous?.history||[]),item],actorTgId:tgId,updatedAt:now()};
 if(previous){requireInput(previous.decision==='awaiting'||previous.revision!==(sub.revision||0),'ALREADY_REVIEWED','Этот ответ уже проверен');
  const res=await db.update(controlReviews).set(value).where(and(eq(controlReviews.submissionId,sub.id),eq(controlReviews.decision,previous.decision),eq(controlReviews.revision,previous.revision))).run();requireInput(res.rowsAffected===1,'CONFLICT','Решение уже принято');
 }else await db.insert(controlReviews).values(value).run();
 return {decision};
}
