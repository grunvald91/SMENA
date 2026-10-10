import { db, api, InputFile } from 'sdk';
import { eq,and,or,lt,lte,gt,gte,isNull,desc } from 'sdk/db';
import { organizations,locations,employees,devices,deviceChallenges,qrPasses,shifts,shiftEvents,bonuses,auditLog,photoIntents } from '../schema.js';
import { requireInput,DomainError } from './errors.js';
import { nonce, pairingMessage,verifyDeviceSignature,requireCrypto,validateProofTime } from './security.js';
import { reportPeriod,formatDate,startOfLocalDay } from './time.js';
import { computePreview,rubles } from './payroll.js';
import { decodeSelfie } from './photo.js';
import { minuteOfDay,validateGrace,plannedEndForStart,closingReview,validateCloseComment } from './schedule.js';
const now=()=>Math.floor(Date.now()/1000);
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
async function audit(orgId,tgId,action,refId,data={}) {
 await db.insert(auditLog).values({orgId,actorTgId:tgId,action,refId:String(refId||''),data,at:now()}).run();
}
export async function ownerOrg(tgId) {
 requireInput(validId(tgId),'UNAUTHORIZED','Требуется пользователь Telegram');
 return await db.select().from(organizations).where(eq(organizations.ownerTgId,Number(tgId))).get();
}
export async function requireOwner(tgId){
 const org=await ownerOrg(tgId);requireInput(!!org,'FORBIDDEN','Эта операция доступна только владельцу организации');return org;
}
export async function setup(tgId,name){
 requireInput(validId(tgId),'UNAUTHORIZED','Нет Telegram ID');
 requireInput(typeof name==='string'&&name.trim().length>=2&&name.length<=100,'BAD_NAME','Название организации: 2–100 символов');
 requireInput(!(await ownerOrg(tgId)),'ALREADY_EXISTS','Организация уже существует');
 const [org]=await db.insert(organizations).values({ownerTgId:tgId,name:name.trim(),createdAt:now()}).returning().run();
 await audit(org.id,tgId,'organization.created',org.id);return org;
}
export async function bindChat(tgId,chatId,name){
 const org=await requireOwner(tgId);
 requireInput(Number.isSafeInteger(chatId)&&chatId<0,'BAD_CHAT','Команда должна быть в рабочей группе');
 const linked=await db.select().from(locations).where(eq(locations.chatId,chatId)).get();
 requireInput(!linked,'ALREADY_BOUND','Эта группа уже связана с рабочей точкой');
 const [loc]=await db.insert(locations).values({orgId:org.id,name:(name||'Точка').slice(0,100),chatId}).returning().run();
 await audit(org.id,tgId,'location.bound',loc.id,{chatId});return loc;
}
export async function addEmployee(tgId,employeeTgId,name,hourlyKopeks){
 const org=await requireOwner(tgId);
 requireInput(validId(employeeTgId),'BAD_USER','Некорректный Telegram ID');
 requireInput(typeof name==='string'&&name.trim().length>=2&&name.length<=100,'BAD_NAME','Нужно имя сотрудника');
 requireInput(Number.isSafeInteger(hourlyKopeks)&&hourlyKopeks>=0&&hourlyKopeks<=1e9,'BAD_RATE','Недопустимая ставка');
 const existing=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,Number(employeeTgId)))).get();
 requireInput(!existing,'ALREADY_EXISTS','Сотрудник уже добавлен');
 const [person]=await db.insert(employees).values({orgId:org.id,tgId:Number(employeeTgId),name:name.trim(),hourlyKopeks,shiftBonusKopeks:0,active:1}).returning().run();
 await audit(org.id,tgId,'employee.created',person.id,{tgId:employeeTgId,hourlyKopeks});return person;
}
export async function changeRate(tgId,personTgId,hourlyKopeks) {
 const org=await requireOwner(tgId);
 const person=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,Number(personTgId)))).get();
 requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 requireInput(Number.isSafeInteger(hourlyKopeks)&&hourlyKopeks>=0&&hourlyKopeks<=1e9,'BAD_RATE','Недопустимая ставка');
 await db.update(employees).set({hourlyKopeks}).where(eq(employees.id,person.id)).run();
 await audit(org.id,tgId,'employee.rate_changed',person.id,{before:person.hourlyKopeks,after:hourlyKopeks});return person;
}
export async function setShiftBonus(tgId,personTgId,shiftBonusKopeks) {
 const org=await requireOwner(tgId);
 const person=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,Number(personTgId)))).get();
 requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 requireInput(Number.isSafeInteger(shiftBonusKopeks)&&shiftBonusKopeks>=0&&shiftBonusKopeks<=1e9,'BAD_BONUS','Недопустимая надбавка');
 await db.update(employees).set({shiftBonusKopeks}).where(eq(employees.id,person.id)).run();
 await audit(org.id,tgId,'employee.shift_bonus_changed',person.id,{before:person.shiftBonusKopeks,after:shiftBonusKopeks});return person;
}
export async function createBonus(tgId,employeeTgId,amountKopeks,reason){
 const org=await requireOwner(tgId);
 const person=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,Number(employeeTgId)))).get();
 requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 requireInput(Number.isSafeInteger(amountKopeks)&&amountKopeks>0&&amountKopeks<=1e9,'BAD_BONUS','Сумма надбавки должна быть положительной');
 requireInput(typeof reason==='string'&&reason.trim().length>=3&&reason.length<=200,'BAD_REASON','Укажите причину надбавки');
 const [b]=await db.insert(bonuses).values({orgId:org.id,employeeId:person.id,date:formatDate(Date.now(),org.timezone),amountKopeks,reason:reason.trim(),actorTgId:tgId}).returning().run();
 await audit(org.id,tgId,'bonus.added',b.id,{employeeId:person.id,amountKopeks,reason});return b;
}
export async function setLocationHours(tgId,locationId,startTime,endTime,graceMinutes=5){
 const org=await requireOwner(tgId);
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Рабочая точка не найдена');
 const start=minuteOfDay(startTime),end=minuteOfDay(endTime);
 requireInput(start!==end,'BAD_HOURS','Начало и конец смены не могут совпадать');
 validateGrace(graceMinutes);
 await db.update(locations).set({plannedStartTime:startTime,plannedEndTime:endTime,closeGraceMinutes:graceMinutes}).where(eq(locations.id,loc.id)).run();
 await audit(org.id,tgId,'location.hours_changed',loc.id,{before:{start:loc.plannedStartTime,end:loc.plannedEndTime,grace:loc.closeGraceMinutes},after:{start:startTime,end:endTime,grace:graceMinutes}});
 return {locationId:loc.id,startTime,endTime,graceMinutes};
}
export async function listLocations(tgId) {
 const org=await requireOwner(tgId);
 return await db.select().from(locations).where(eq(locations.orgId,org.id)).all();
}
export async function listEmployees(tgId) {
 const org=await requireOwner(tgId);
 return await db.select().from(employees).where(eq(employees.orgId,org.id)).all();
}
export async function enrollDevice(tgId,locationId,publicJwk) {
 requireCrypto();const org=await requireOwner(tgId);
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Рабочая точка не найдена');
 requireInput(publicJwk?.kty==='EC'&&publicJwk?.crv==='P-256'&&typeof publicJwk.x==='string'&&typeof publicJwk.y==='string',
 'BAD_DEVICE_KEY','Неверный публичный ключ устройства');
 // Verify key structure, but enrollment is explicitly owner-authorized. Physical uniqueness is not attested.
 try {await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:publicJwk.x,y:publicJwk.y,ext:true},
    {name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch {throw new DomainError('BAD_DEVICE_KEY','Не удалось проверить ключ устройства');}
 const previous=await db.select().from(devices).where(and(eq(devices.locationId,loc.id),isNull(devices.revokedAt))).get();
 requireInput(!previous,'DEVICE_ALREADY_ACTIVE','У точки уже есть активное устройство. Для замены сначала отзовите его ключ на старом устройстве. При утере потребуется отдельное восстановление.');
 const [dev]=await db.insert(devices).values({orgId:org.id,locationId:loc.id,publicJwk,registeredBy:tgId,createdAt:now()}).returning().run();
 await audit(org.id,tgId,'device.registered',dev.id,{locationId:loc.id});
 return {id:dev.id,locationId:loc.id};
}
export async function getDeviceChallenge(tgId,deviceId) {
 const org=await requireOwner(tgId);
 const dev=await db.select().from(devices).where(and(eq(devices.id,Number(deviceId)),eq(devices.orgId,org.id),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Устройство не зарегистрировано или отозвано');
 const sec=now();
 await db.delete(deviceChallenges).where(lt(deviceChallenges.expiresAt,sec-86400)).run();
 await db.delete(qrPasses).where(lt(qrPasses.expiresAt,sec-86400)).run();
 const record={id:nonce(18),deviceId:dev.id,nonce:nonce(24),expiresAt:sec+20};
 await db.insert(deviceChallenges).values(record).run();
 return {id:record.id,nonce:record.nonce,message:pairingMessage(record.id,record.nonce),expiresAt:record.expiresAt};
}
export async function issueQr(tgId,deviceId,challengeId,signature){
 requireCrypto();const org=await requireOwner(tgId);
 const dev=await db.select().from(devices).where(and(eq(devices.id,Number(deviceId)),eq(devices.orgId,org.id),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Устройство отозвано');
 const challenge=await db.select().from(deviceChallenges).where(and(eq(deviceChallenges.id,challengeId),eq(deviceChallenges.deviceId,dev.id))).get();
 requireInput(challenge&&!challenge.usedAt,'BAD_CHALLENGE','Нет действительного запроса устройства');
 validateProofTime(challenge.expiresAt,now());
 requireInput(await verifyDeviceSignature(dev.publicJwk,pairingMessage(challenge.id,challenge.nonce),signature),
  'BAD_SIGNATURE','Подпись не принадлежит зарегистрированному устройству');
 const consumed=await db.update(deviceChallenges).set({usedAt:now()}).where(and(eq(deviceChallenges.id,challengeId),isNull(deviceChallenges.usedAt))).run();
 requireInput(consumed.rowsAffected===1,'REPLAY','Запрос уже использован');
 const token=nonce(24), sec=now();
 await db.insert(qrPasses).values({token,deviceId:dev.id,orgId:org.id,locationId:dev.locationId,createdAt:sec,expiresAt:sec+30}).run();
 return {token,expiresAt:sec+30,locationId:dev.locationId};
}
export async function revokeDevice(tgId,deviceId,challengeId,signature){
 requireCrypto();const org=await requireOwner(tgId);
 const dev=await db.select().from(devices).where(and(eq(devices.id,Number(deviceId)),eq(devices.orgId,org.id),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Устройство уже отозвано');
 const challenge=await db.select().from(deviceChallenges).where(and(eq(deviceChallenges.id,challengeId),eq(deviceChallenges.deviceId,dev.id))).get();
 requireInput(!!challenge&&!challenge.usedAt,'BAD_CHALLENGE','Нет действительного запроса устройства');
 validateProofTime(challenge.expiresAt,now());
 requireInput(await verifyDeviceSignature(dev.publicJwk,pairingMessage(challenge.id,challenge.nonce),signature),
 'BAD_SIGNATURE','Подпись не принадлежит зарегистрированному устройству');
 const consumed=await db.update(deviceChallenges).set({usedAt:now()}).where(and(eq(deviceChallenges.id,challengeId),isNull(deviceChallenges.usedAt))).run();
 requireInput(consumed.rowsAffected===1,'REPLAY','Запрос уже использован');
 await db.update(devices).set({revokedAt:now()}).where(and(eq(devices.id,dev.id),isNull(devices.revokedAt))).run();
 await audit(org.id,tgId,'device.revoked',dev.id,{locationId:dev.locationId});
 return {deviceId:dev.id,revoked:true};
}
export async function scanShift(tgId,token,action,proof=null){
 requireInput(validId(tgId),'UNAUTHORIZED','Требуется пользователь Telegram');
 requireInput(action==='in'||action==='out','BAD_ACTION','Ожидается начало или конец смены');
 requireInput(typeof token==='string'&&/^[A-Za-z0-9_-]{32}$/.test(token),'BAD_QR','Некорректный QR-код');
 const qr=await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get();
 requireInput(!!qr,'BAD_QR','QR-код не найден');validateProofTime(qr.expiresAt,proof?.validatedAt??now());
 const dev=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Рабочее устройство отозвано');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,qr.orgId),eq(employees.tgId,Number(tgId)),eq(employees.active,1))).get();
 requireInput(!!person,'FORBIDDEN','Вы не зарегистрированы как сотрудник этой организации');
 const opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();
 const sec=proof?.eventAt??now();
 requireInput(Number.isSafeInteger(sec)&&sec>0&&sec<=now()+5,'BAD_EVENT_TIME','Некорректное время события');
 if(action==='in') {
   requireInput(!opened,'SHIFT_ALREADY_OPEN','У вас уже есть открытая смена');
   const loc=await db.select().from(locations).where(and(eq(locations.id,qr.locationId),eq(locations.orgId,qr.orgId))).get();
   const org=await db.select().from(organizations).where(eq(organizations.id,qr.orgId)).get();
   requireInput(!!loc&&!!org,'BAD_LOCATION','Рабочая точка недоступна');
   const plannedEndAt=plannedEndForStart(sec,loc,org.timezone);
   let record;
   try {[record]=await db.insert(shifts).values({orgId:qr.orgId,locationId:qr.locationId,employeeId:person.id,startedAt:sec,sourceIn:token,hourlyKopeksSnapshot:person.hourlyKopeks,shiftBonusKopeksSnapshot:person.shiftBonusKopeks||0,createdAt:sec,plannedEndAt,closeGraceMinutes:loc.closeGraceMinutes??5}).returning().run();}
   catch {throw new DomainError('SHIFT_ALREADY_OPEN','Не удалось начать смену: возможно, она уже открыта');}
   await db.insert(shiftEvents).values({shiftId:record.id,actorTgId:tgId,action:'in',at:sec,qrToken:token,photoFileId:proof?.photoFileId||null}).run();
   return {action,shiftId:record.id,at:sec,name:person.name};
 }
 requireInput(!!opened,'NO_OPEN_SHIFT','Нет открытой смены');
 requireInput(opened.locationId===qr.locationId,'WRONG_LOCATION','Смена начата на другой точке; требуется исправление владельца');
 requireInput(opened.sourceIn!==token,'SAME_QR','Для ухода необходим новый QR-код');
 requireInput(sec>opened.startedAt,'BAD_DURATION','Окончание должно быть позже начала');
 const review=closingReview(sec,opened.plannedEndAt,opened.closeGraceMinutes??5);
 const comment=validateCloseComment(proof?.closeComment,review);
 const result=await db.update(shifts).set({endedAt:sec,sourceOut:token,closeComment:comment}).where(and(eq(shifts.id,opened.id),isNull(shifts.endedAt))).run();
 requireInput(result.rowsAffected===1,'SHIFT_ALREADY_CLOSED','Эта смена уже закрыта');
 await db.insert(shiftEvents).values({shiftId:opened.id,actorTgId:tgId,action:'out',at:sec,qrToken:token,photoFileId:proof?.photoFileId||null,note:comment}).run();
 return {action,shiftId:opened.id,at:sec,name:person.name,hours:Number(((sec-opened.startedAt)/3600).toFixed(2)),closeReview:review,closeComment:comment};
}
// A short-lived, authenticated photo intent preserves a 30s QR check while the user
// grants camera permission and takes a picture. A picture is REQUIRED to finish.
export async function beginPhotoShift(tgId,token,action){
 requireInput(validId(tgId),'UNAUTHORIZED','Неизвестный сотрудник');
 requireInput(['in','out'].includes(action),'BAD_ACTION','Укажите приход или уход');
 requireInput(typeof token==='string'&&/^[A-Za-z0-9_-]{32}$/.test(token),'BAD_QR','Некорректный код');
 const qr=await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get();
 requireInput(!!qr,'BAD_QR','QR не найден');validateProofTime(qr.expiresAt,now());
 const device=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Устройство отозвано');
 const loc=await db.select().from(locations).where(and(eq(locations.id,qr.locationId),eq(locations.orgId,qr.orgId))).get();
 requireInput(!!loc?.chatId,'NO_WORK_CHAT','Владелец должен привязать рабочую Telegram-группу');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,qr.orgId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
 requireInput(!!person,'FORBIDDEN','Сотрудник не привязан к организации');
 const opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();
 requireInput(action==='in'?!opened:!!opened,action==='in'?'SHIFT_ALREADY_OPEN':'NO_OPEN_SHIFT',action==='in'?'У вас уже есть открытая смена':'Нет открытой смены');
 if(action==='out')requireInput(opened.locationId===loc.id && opened.sourceIn!==token,'WRONG_LOCATION','Смена открыта на другой точке или этот QR уже использовался');
 const sec=now(),intent={id:nonce(24),qrToken:token,orgId:qr.orgId,locationId:loc.id,
  employeeId:person.id,actorTgId:tgId,action,createdAt:sec,expiresAt:sec+180,status:'pending'};
 await db.insert(photoIntents).values(intent).run();
 const closeReview=action==='out'?closingReview(sec,opened.plannedEndAt,opened.closeGraceMinutes??5):null;
 return {intentId:intent.id,expiresAt:intent.expiresAt,location:loc.name,employee:person.name,action,closeReview};
}

export async function completePhotoShift(tgId,intentId,selfieBase64,closeComment){
 requireInput(validId(tgId),'UNAUTHORIZED','Нет Telegram ID');
 requireInput(typeof intentId==='string'&&/^[A-Za-z0-9_-]{32}$/.test(intentId),'BAD_INTENT','Некорректная сессия');
 let intent=await db.select().from(photoIntents).where(and(eq(photoIntents.id,intentId),eq(photoIntents.actorTgId,tgId))).get();
 requireInput(!!intent,'BAD_INTENT','Сессия принадлежит другому пользователю либо не найдена');
 requireInput(intent.expiresAt>now() || intent.status==='sent' || intent.status==='done','EXPIRED','Срок съёмки истёк — сканируйте QR заново');
 if(intent.status==='done')return {action:intent.action,shiftId:intent.shiftId,name:'Сотрудник',photoMessageId:intent.photoMessageId,alreadyDone:true};
 const deviceQr=await db.select().from(qrPasses).where(eq(qrPasses.token,intent.qrToken)).get();
 const device=await db.select().from(devices).where(and(eq(devices.id,deviceQr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Рабочее устройство больше не активно');
 if(intent.status==='pending'){
  // Validate the reason BEFORE sending anything to the group; never leave a photo
  // for a rejected early/late close. Use the time the QR was scanned.
  let note=null;
  if(intent.action==='out'){
   const opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,intent.employeeId),isNull(shifts.endedAt))).get();
   requireInput(!!opened&&opened.locationId===intent.locationId,'NO_OPEN_SHIFT','Смена не найдена или уже закрыта');
   const review=closingReview(intent.createdAt,opened.plannedEndAt,opened.closeGraceMinutes??5);
   note=validateCloseComment(closeComment,review);
  }
  const bytes=decodeSelfie(selfieBase64);
  const reserved=await db.update(photoIntents).set({status:'uploading',closeComment:note}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'pending'))).run();
  requireInput(reserved.rowsAffected===1,'IN_PROGRESS','Фотография уже обрабатывается');
  try{
   const loc=await db.select().from(locations).where(eq(locations.id,intent.locationId)).get();
   requireInput(!!loc?.chatId,'NO_WORK_CHAT','Не привязана рабочая группа');
   const person=await db.select().from(employees).where(and(eq(employees.id,intent.employeeId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
   requireInput(!!person,'FORBIDDEN','Сотрудник не активен');
   const photo=await api.sendPhoto({chat_id:loc.chatId,
    photo:new InputFile(bytes,'shift-selfie.jpg',{type:'image/jpeg'}),
    caption:`📷 ServGo Смена · ${intent.action==='in'?'Приход':'Уход'}\n${person.name} · ${loc.name}\nФото-подтверждение; запись смены проверяется системой.`});
   const fileId=photo.photo?.at(-1)?.file_id;
   requireInput(!!fileId&&!!photo.message_id,'TELEGRAM_PHOTO','Telegram не вернул подтверждение фотографии');
   await db.update(photoIntents).set({status:'sent',photoFileId:fileId,photoMessageId:photo.message_id}).where(eq(photoIntents.id,intent.id)).run();
  }catch(e){
   // If Telegram accepted the photo but the subsequent database write failed, a retry
   // can send a duplicate. This limitation needs end-to-end recovery testing.
   await db.update(photoIntents).set({status:'pending'}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'uploading'))).run();
   throw e;
  }
 }
 intent=await db.select().from(photoIntents).where(eq(photoIntents.id,intentId)).get();
 requireInput(intent.status==='sent','IN_PROGRESS','Операция ещё обрабатывается');
 const result=await scanShift(tgId,intent.qrToken,intent.action,{validatedAt:intent.createdAt,eventAt:intent.createdAt,photoFileId:intent.photoFileId,closeComment:intent.closeComment});
 await db.update(photoIntents).set({status:'done',shiftId:result.shiftId}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'sent'))).run();
 return {...result,photoMessageId:intent.photoMessageId};
}

export async function makeReport(tgId,args=[],stamp=Date.now()){
 const org=await requireOwner(tgId), period=reportPeriod(args,stamp,org.timezone);
 const [people,records,extras]=await Promise.all([
  db.select().from(employees).where(eq(employees.orgId,org.id)).all(),
  db.select().from(shifts).where(and(eq(shifts.orgId,org.id),lt(shifts.startedAt,Math.floor(period.endMs/1000)),
   or(isNull(shifts.endedAt),gt(shifts.endedAt,Math.floor(period.startMs/1000))))).all(),
  db.select().from(bonuses).where(and(eq(bonuses.orgId,org.id),gte(bonuses.date,period.start),lt(bonuses.date,period.end))).all()
 ]);
 return computePreview({employees:people,shifts:records,bonuses:extras,period});
}
export async function findProblems(tgId,stamp=Date.now()) {
 const org=await requireOwner(tgId),todayMs=startOfLocalDay(formatDate(stamp,org.timezone),org.timezone);
 const people=await db.select().from(employees).where(eq(employees.orgId,org.id)).all();
 const pending=await db.select().from(shifts).where(and(eq(shifts.orgId,org.id),isNull(shifts.endedAt),lt(shifts.startedAt,Math.floor(todayMs/1000)))).orderBy(desc(shifts.startedAt)).limit(100).all();
 return pending.map(s=>({shiftId:s.id,employeeId:s.employeeId,name:people.find(e=>e.id===s.employeeId)?.name||'Неизвестный сотрудник',startedAt:s.startedAt}));
}
export function formatReport(r){
 let lines=[`📊 ServGo Смена — предварительное начисление`, `Период: ${r.period.start} — до ${r.period.endExclusive} (не включая)`, `Часовой пояс: ${r.period.tz}`,''];
 for(const e of r.entries){lines.push(`${e.name}: ${e.hours} ч × ставка = ${rubles(e.baseKopeks)}; надбавки ${rubles(e.bonusKopeks)}; итого ${rubles(e.grossKopeks)}${e.unclosed?' ⚠️ незакрытых смен: '+e.unclosed:''}`);}
 if(r.exceptions?.length){
  lines.push('',`📝 Отклонения от графика (${r.exceptions.length}):`);
  for(const item of r.exceptions){
   const when=sec=>new Date(sec*1000).toLocaleString('ru-RU',{timeZone:r.period.tz,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
   lines.push(`#${item.shiftId} ${item.name}: ${item.status==='early'?'раньше':'позже'} на ${Math.abs(item.differenceMinutes)} мин; план ${when(item.plannedEndAt)}, факт ${when(item.endedAt)}. Причина: ${item.closeComment||'⚠️ не указана'}`);
  }
 }
 lines.push('',`Всего: ${rubles(r.totals.grossKopeks)}; незакрытых смен: ${r.totals.unclosed}`,
  'Без НДФЛ, других удержаний, коэффициентов и юридического расчёта зарплаты. Требуется проверка бухгалтером.');
 return lines.join('\n');
}
