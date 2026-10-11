import { db, api, InputFile, BotApiError } from 'sdk';
import { eq,and,or,lt,lte,gt,gte,isNull,desc,inArray } from 'sdk/db';
import { organizations,locations,employees,devices,deviceChallenges,qrPasses,shifts,shiftEvents,bonuses,auditLog,photoIntents,shiftTemplates,shiftAssignments,locationPolicies,shiftCorrections,salesEntries,payrollApprovals,assignmentResolutions } from '../schema.js';
import { requireInput,DomainError } from './errors.js';
import { nonce, pairingMessage,verifyDeviceSignature,requireCrypto,validateProofTime,validateDevicePublicKey } from './security.js';
import { reportPeriod,formatDate,startOfLocalDay,addDays } from './time.js';
import { computePreview,rubles } from './payroll.js';
import { decodeSelfie } from './photo.js';
import { minuteOfDay,validateGrace,plannedEndForStart,closingReview,validateCloseComment } from './schedule.js';
import { validateTemplate,templateWindow,chooseAssignment,chooseAutomatic,daysAround } from './roster.js';
import { parseISODate } from './time.js';
import {isShiftToken,parseKioskToken,kioskMessage,kioskDeviceIdFromPublicKey} from './kiosk-token.js';
import {shiftPhotoCaption} from './shift-caption.js';
import {describeOrganizationSelection} from './organization-selection-service.js';
import {applyCorrections,repairOpenCorrection} from './management.js';
import {legacyOwnerForSelection} from './scoped-owner.js';
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
 const legacy=await ownerOrg(tgId);
 requireInput(!!legacy,'FORBIDDEN','Эта операция доступна только владельцу организации');
 const state=await describeOrganizationSelection(tgId);
 const org=legacyOwnerForSelection(legacy,state);
 requireInput(!!org,state.selectionRequired?'ORGANIZATION_REQUIRED':'WRONG_ORGANIZATION',
  'Выберите свой бизнес в меню перед управлением сотрудниками, сменами или отчётами.');
 return org;
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
export async function setLocationName(tgId,locationId,name){
 const org=await requireOwner(tgId);
 requireInput(typeof name==='string'&&name.trim().length>=2&&name.trim().length<=100,'BAD_NAME','Название точки: 2–100 символов');
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Рабочая точка не найдена');
 const updated=name.trim();
 await db.update(locations).set({name:updated}).where(and(eq(locations.id,loc.id),eq(locations.orgId,org.id))).run();
 await audit(org.id,tgId,'location.renamed',loc.id,{previousName:loc.name,name:updated});
 return {id:loc.id,name:updated};
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
export async function createBonus(tgId,employeeTgId,amountKopeks,reason,operationId=null){
 const org=await requireOwner(tgId);
 const person=await db.select().from(employees).where(and(eq(employees.orgId,org.id),eq(employees.tgId,Number(employeeTgId)))).get();
 requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 requireInput(Number.isSafeInteger(amountKopeks)&&amountKopeks>0&&amountKopeks<=1e9,'BAD_BONUS','Сумма надбавки должна быть положительной');
 requireInput(typeof reason==='string'&&reason.trim().length>=3&&reason.length<=200,'BAD_REASON','Укажите причину надбавки');
 if(operationId){requireInput(typeof operationId==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(operationId),'BAD_OPERATION','Некорректный идентификатор операции');const known=await db.select().from(bonuses).where(eq(bonuses.operationId,operationId)).get();if(known){requireInput(known.orgId===org.id&&known.employeeId===person.id&&known.amountKopeks===amountKopeks&&known.reason===reason.trim(),'CONFLICT','Операция уже использована');return known;}}
 let b;try{[b]=await db.insert(bonuses).values({orgId:org.id,employeeId:person.id,date:formatDate(Date.now(),org.timezone),amountKopeks,reason:reason.trim(),actorTgId:tgId,operationId}).returning().run();}catch(e){const known=operationId?await db.select().from(bonuses).where(eq(bonuses.operationId,operationId)).get():null;if(!known)throw e;requireInput(known.orgId===org.id&&known.employeeId===person.id&&known.amountKopeks===amountKopeks&&known.reason===reason.trim(),'CONFLICT','Операция уже использована');return known;}
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
export async function createShiftTemplate(tgId,locationId,name,startTime,endTime,graceMinutes=5){
 const org=await requireOwner(tgId);
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Точка не найдена');
 const values=validateTemplate(name,startTime,endTime,graceMinutes);
 const existing=await db.select().from(shiftTemplates).where(and(eq(shiftTemplates.locationId,loc.id),eq(shiftTemplates.active,1))).all();
 requireInput(!existing.some(t=>t.name.toLocaleLowerCase('ru')===values.name.toLocaleLowerCase('ru')),'ALREADY_EXISTS','Такая смена уже есть на точке');
 const [result]=await db.insert(shiftTemplates).values({...values,orgId:org.id,locationId:loc.id,active:1}).returning().run();
 await audit(org.id,tgId,'shift_template.created',result.id,values);
 return result;
}
export async function updateShiftTemplate(tgId,templateId,name,startTime,endTime,graceMinutes=5){
 const org=await requireOwner(tgId);
 const previous=await db.select().from(shiftTemplates).where(and(eq(shiftTemplates.orgId,org.id),eq(shiftTemplates.id,Number(templateId)),eq(shiftTemplates.active,1))).get();
 requireInput(!!previous,'NOT_FOUND','Тип смены не найден');
 const settings=validateTemplate(name,startTime,endTime,graceMinutes);
 // Freeze existing assignments before changing a reusable template.
 const assigned=await db.select().from(shiftAssignments).where(eq(shiftAssignments.templateId,previous.id)).all();
 for(const a of assigned)if(!a.planSnapshot)await db.update(shiftAssignments).set({planSnapshot:{template:previous,window:templateWindow(a.workDate,previous,org.timezone)}}).where(and(eq(shiftAssignments.id,a.id),isNull(shiftAssignments.planSnapshot))).run();
 await db.update(shiftTemplates).set(settings).where(eq(shiftTemplates.id,previous.id)).run();
 await audit(org.id,tgId,'shift_template.updated',previous.id,{before:{name:previous.name,startTime:previous.startTime,endTime:previous.endTime},after:settings});
 return {id:previous.id,...settings};
}
export async function deleteShiftAssignment(tgId,assignmentId){
 const org=await requireOwner(tgId);
 const assignment=await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.id,Number(assignmentId)),eq(shiftAssignments.orgId,org.id))).get();
 requireInput(!!assignment,'NOT_FOUND','Назначение не найдено');
 const started=await db.select().from(shifts).where(eq(shifts.assignmentId,assignment.id)).get();
 const decision=await db.select().from(assignmentResolutions).where(eq(assignmentResolutions.assignmentId,assignment.id)).get();
 requireInput(!decision,'ALREADY_REVIEWED','Назначение с подтверждённой неявкой или восстановлением хранится в истории');
 requireInput(!started,'ALREADY_STARTED','Нельзя удалить назначение, для которого уже создана смена; нужна корректировка владельца');
 const res=await db.delete(shiftAssignments).where(and(eq(shiftAssignments.id,assignment.id),eq(shiftAssignments.orgId,org.id))).run();
 requireInput(res.rowsAffected===1,'CONFLICT','Не удалось удалить назначение');
 await audit(org.id,tgId,'shift_assignment.deleted',assignment.id,{employeeId:assignment.employeeId,workDate:assignment.workDate});
 return {id:assignment.id,deleted:true};
}
export async function assignShift(tgId,employeeId,templateId,workDate){
 const org=await requireOwner(tgId);parseISODate(workDate);
 const person=await db.select().from(employees).where(and(eq(employees.id,Number(employeeId)),eq(employees.orgId,org.id),eq(employees.active,1))).get();
 requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 const template=await db.select().from(shiftTemplates).where(and(eq(shiftTemplates.id,Number(templateId)),eq(shiftTemplates.orgId,org.id),eq(shiftTemplates.active,1))).get();
 requireInput(!!template,'NOT_FOUND','Тип смены не найден');
 const rows=await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.employeeId,person.id),eq(shiftAssignments.workDate,workDate))).all();
 requireInput(!rows.some(x=>x.templateId===template.id),'ALREADY_EXISTS','Эта смена уже назначена');
 // Avoid overlapping assignments even across adjacent days (overnight shifts).
 const prev=await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.employeeId,person.id),eq(shiftAssignments.workDate,addDays(workDate,-1)))).all();
 const next=await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.employeeId,person.id),eq(shiftAssignments.workDate,addDays(workDate,1)))).all();
 const all=[...rows,...prev,...next];
 if(all.length){
  const templates=await db.select().from(shiftTemplates).where(eq(shiftTemplates.orgId,org.id)).all();
  const byId=new Map(templates.map(t=>[t.id,t]));
  const interval=templateWindow(workDate,template,org.timezone);
  for(const old of all){const current=byId.get(old.templateId);if(!current)continue;
   const w=old.planSnapshot?.window||templateWindow(old.workDate,current,org.timezone);
   requireInput(interval.endAt<=w.startAt || interval.startAt>=w.endAt,'SHIFT_OVERLAP','Смена пересекается с уже назначенной сменой сотрудника');
  }
 }
 const [result]=await db.insert(shiftAssignments).values({orgId:org.id,locationId:template.locationId,employeeId:person.id,templateId:template.id,workDate,createdBy:tgId,createdAt:now(),planSnapshot:{template,window:templateWindow(workDate,template,org.timezone)}}).returning().run();
 await audit(org.id,tgId,'shift_assignment.created',result.id,{employeeId:person.id,templateId:template.id,workDate});
 return result;
}
export async function listRoster(tgId,startDate,endDate){
 const org=await requireOwner(tgId);
 parseISODate(startDate);parseISODate(endDate);
 requireInput(startDate<=endDate,'BAD_DATE','Неверный диапазон');
 const [templates,assignments]=await Promise.all([
  db.select().from(shiftTemplates).where(eq(shiftTemplates.orgId,org.id)).all(),
  db.select().from(shiftAssignments).where(and(eq(shiftAssignments.orgId,org.id),gte(shiftAssignments.workDate,startDate),lte(shiftAssignments.workDate,endDate))).all()
 ]);
 return {templates,assignments};
}
export async function setShiftMode(tgId,locationId,mode){
 const org=await requireOwner(tgId);
 requireInput(['assigned','automatic'].includes(mode),'BAD_MODE','Выберите назначение владельцем или автоматический подбор');
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Точка не найдена');
 const policy=await db.select().from(locationPolicies).where(eq(locationPolicies.locationId,loc.id)).get();
 const value={locationId:loc.id,orgId:org.id,mode,updatedAt:now()};
 if(policy)await db.update(locationPolicies).set(value).where(eq(locationPolicies.locationId,loc.id)).run();
 else await db.insert(locationPolicies).values(value).run();
 await audit(org.id,tgId,'location.shift_mode',loc.id,{mode});return {mode};
}
async function resolveShiftPlan(org,loc,person,scannedAt){
 const [templates,policy,history]=await Promise.all([
  db.select().from(shiftTemplates).where(and(eq(shiftTemplates.orgId,org.id),eq(shiftTemplates.locationId,loc.id),eq(shiftTemplates.active,1))).all(),
  db.select().from(locationPolicies).where(eq(locationPolicies.locationId,loc.id)).get(),
  db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),eq(shifts.locationId,loc.id))).all()
 ]);
 const mode=policy?.mode||(templates.length?'assigned':'automatic');
 if(mode==='automatic'&&!templates.length)return {plannedStartAt:null,plannedEndAt:plannedEndForStart(scannedAt,loc,org.timezone),
  closeGraceMinutes:loc.closeGraceMinutes??5,assignmentId:null,templateId:null,templateName:null,mode,occurrenceKey:null};
 let selected;
 if(mode==='automatic'){
  const used=history.filter(s=>s.occurrenceKey?.startsWith(`auto:${person.id}:`)).map(s=>s.occurrenceKey.slice(`auto:${person.id}:`.length));
  selected=chooseAutomatic(scannedAt,org.timezone,templates,used);
 }else{
  requireInput(templates.length>0,'NO_ASSIGNED_SHIFT','Сначала настройте смены и назначьте сотрудника либо включите автоматический режим');
  const assignments=[];
  for(const date of daysAround(scannedAt,org.timezone))assignments.push(...await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.employeeId,person.id),eq(shiftAssignments.workDate,date),eq(shiftAssignments.locationId,loc.id))).all());
  const absences=await db.select().from(assignmentResolutions).where(eq(assignmentResolutions.orgId,org.id)).all();
  selected=chooseAssignment(scannedAt,org.timezone,assignments,templates,[...history.map(s=>s.assignmentId).filter(x=>x!=null),...absences.map(x=>x.assignmentId)]);
 }
 requireInput(!!selected,'NO_ASSIGNED_SHIFT',mode==='assigned'?'Нет неотработанной назначенной смены. Обратитесь к владельцу.':'Подходящей неотработанной смены нет. Проверьте время смен у владельца.');
 return {plannedStartAt:selected.startAt,plannedEndAt:selected.endAt,closeGraceMinutes:selected.graceMinutes,
  assignmentId:selected.assignmentId,templateId:selected.templateId,templateName:selected.templateName,mode,
  occurrenceKey:mode==='assigned'?`assigned:${selected.assignmentId}`:`auto:${person.id}:${selected.key}`};
}
export async function listLocations(tgId) {
 const org=await requireOwner(tgId);
 const points=await db.select().from(locations).where(eq(locations.orgId,org.id)).all();
 const policies=await db.select().from(locationPolicies).where(eq(locationPolicies.orgId,org.id)).all();
 const templates=await db.select().from(shiftTemplates).where(eq(shiftTemplates.orgId,org.id)).all();
 return points.map(p=>({...p,shiftMode:policies.find(x=>x.locationId===p.id)?.mode||(templates.some(t=>t.locationId===p.id&&t.active)?'assigned':'automatic')}));
}
export async function listEmployees(tgId) {
 const org=await requireOwner(tgId);
 return await db.select().from(employees).where(eq(employees.orgId,org.id)).all();
}
export async function enrollDevice(tgId,locationId,publicJwk,{externalKiosk=false}={}) {
 requireCrypto();const org=await requireOwner(tgId);
 const loc=await db.select().from(locations).where(and(eq(locations.id,Number(locationId)),eq(locations.orgId,org.id))).get();
 requireInput(!!loc,'NOT_FOUND','Рабочая точка не найдена');
 requireInput(publicJwk?.kty==='EC'&&publicJwk?.crv==='P-256'&&typeof publicJwk.x==='string'&&typeof publicJwk.y==='string',
 'BAD_DEVICE_KEY','Неверный публичный ключ устройства');
 // Verify key structure, but enrollment is explicitly owner-authorized. Physical uniqueness is not attested.
 validateDevicePublicKey(publicJwk);
 const previous=await db.select().from(devices).where(and(eq(devices.locationId,loc.id),isNull(devices.revokedAt))).get();
 if(externalKiosk&&previous?.publicJwk?.x===publicJwk.x&&previous?.publicJwk?.y===publicJwk.y){
  requireInput(previous.id===kioskDeviceIdFromPublicKey(publicJwk),'DEVICE_ID_MISMATCH','Ранее устройство привязали через старую процедуру');
  return {id:previous.id,locationId:loc.id,alreadyLinked:true};
 }
 requireInput(!previous,'DEVICE_ALREADY_ACTIVE','К точке уже привязано устройство. Сначала отзовите его ключ.');
 let data={orgId:org.id,locationId:loc.id,publicJwk,registeredBy:tgId,createdAt:now()};
 if(externalKiosk){
  const kioskId=kioskDeviceIdFromPublicKey(publicJwk);
  const found=await db.select().from(devices).where(eq(devices.id,kioskId)).get();
  requireInput(!found,'DEVICE_KEY_REUSED','Ключ устройства уже зарегистрирован или отозван. Создайте новый ключ.');
  data={...data,id:kioskId};
 }
 const [dev]=await db.insert(devices).values(data).returning().run();
 await audit(org.id,tgId,'device.registered',dev.id,{locationId:loc.id,externalKiosk});
 return {id:dev.id,locationId:loc.id};
}
export async function listActiveDevices(tgId){
 const org=await requireOwner(tgId);
 const rows=await db.select().from(devices).where(and(eq(devices.orgId,org.id),isNull(devices.revokedAt))).all();
 return rows.map(d=>({id:d.id,locationId:d.locationId,createdAt:d.createdAt}));
}
export async function ownerRevokeDevice(tgId,locationId,deviceId){
 const org=await requireOwner(tgId);
 requireInput(Number.isSafeInteger(locationId)&&locationId>0&&Number.isSafeInteger(deviceId)&&deviceId>0,'BAD_DEVICE','Некорректное устройство');
 const found=await db.select().from(devices).where(and(
  eq(devices.id,deviceId),eq(devices.locationId,locationId),eq(devices.orgId,org.id),isNull(devices.revokedAt)
 )).get();
 requireInput(!!found,'DEVICE_REVOKED','На выбранной точке нет такого активного устройства');
 const changed=await db.update(devices).set({revokedAt:now()}).where(and(
  eq(devices.id,deviceId),eq(devices.locationId,locationId),eq(devices.orgId,org.id),isNull(devices.revokedAt)
 )).run();
 requireInput(changed.rowsAffected===1,'REPLAY','Устройство уже отозвано');
 await audit(org.id,tgId,'device.owner_revoked',found.id,{locationId,reason:'owner replacement'});
 return {revoked:true,locationId};
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
export async function revokeKioskDevice(tgId,proof){
 const org=await requireOwner(tgId),parsed=parseKioskToken(proof,now(),'revoke');
 const dev=await db.select().from(devices).where(and(eq(devices.id,parsed.deviceId),eq(devices.orgId,org.id),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Устройство не найдено или уже отозвано');
 requireInput(await verifyDeviceSignature(dev.publicJwk,kioskMessage(parsed.payload,'revoke'),parsed.signature),'BAD_SIGNATURE','Код отзыва не принадлежит устройству');
 await db.update(devices).set({revokedAt:now()}).where(and(eq(devices.id,dev.id),isNull(devices.revokedAt))).run();
 await audit(org.id,tgId,'device.revoked',dev.id,{locationId:dev.locationId});return {deviceId:dev.id,revoked:true};
}
export async function resolvePhotoQr(tgId,token){
 requireInput(isShiftToken(token),'BAD_QR','Некорректный код');
 if(token.startsWith('k1_')){
  const parsed=parseKioskToken(token,now());
  const dev=await db.select().from(devices).where(and(eq(devices.id,parsed.deviceId),isNull(devices.revokedAt))).get();
  requireInput(!!dev,'DEVICE_REVOKED','Рабочее устройство не зарегистрировано или отозвано');
  const employee=await db.select().from(employees).where(and(eq(employees.orgId,dev.orgId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
  requireInput(!!employee,'FORBIDDEN','Сотрудник не привязан к организации');
  requireInput(await verifyDeviceSignature(dev.publicJwk,kioskMessage(parsed.payload),parsed.signature),'BAD_SIGNATURE','Подпись QR не принадлежит рабочему устройству');
  const known=await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get();
  if(!known){await db.delete(qrPasses).where(lt(qrPasses.expiresAt,now()-86400)).run();try{await db.insert(qrPasses).values({token,deviceId:dev.id,orgId:dev.orgId,locationId:dev.locationId,createdAt:parsed.issuedAt,expiresAt:parsed.expiresAt}).run();}
   catch(e){if(!await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get())throw e;}}
 }
 const qr=await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get();
 requireInput(!!qr,'BAD_QR','QR не найден');validateProofTime(qr.expiresAt,now());return qr;
}
async function confirmPhotoMessage(intent){
 try{
  const [loc,org,person,shift]=await Promise.all([
   db.select().from(locations).where(eq(locations.id,intent.locationId)).get(),
   db.select().from(organizations).where(eq(organizations.id,intent.orgId)).get(),
   db.select().from(employees).where(eq(employees.id,intent.employeeId)).get(),
   db.select().from(shifts).where(eq(shifts.id,intent.shiftId)).get()]);
  const template=shift?.templateId?await db.select().from(shiftTemplates).where(eq(shiftTemplates.id,shift.templateId)).get():null;
  requireInput(!!loc&&!!org&&!!person&&!!shift,'NOT_FOUND','Данные отметки не найдены');
  const caption=shiftPhotoCaption({action:intent.action,employee:person.name,location:loc.name,templateName:template?.name,eventAt:intent.createdAt,timezone:org.timezone,confirmed:true,shiftId:shift.id,durationSeconds:shift.endedAt?shift.endedAt-shift.startedAt:null,comment:intent.closeComment});
  try{await api.editMessageCaption({chat_id:loc.chatId,message_id:intent.photoMessageId,caption});}
  catch(e){if(!String(e?.message||e).includes('message is not modified'))throw e;}
  return true;
 }catch{return false;}
}
async function saveShiftEvent(record,tgId,action,token,proof,sec,note){
 if(proof?.intentId){
  const event=await db.select().from(shiftEvents).where(eq(shiftEvents.photoIntentId,proof.intentId)).get();
  if(event)return;
 }
 try{await db.insert(shiftEvents).values({shiftId:record.id,actorTgId:tgId,action,at:sec,qrToken:token,photoFileId:proof?.photoFileId||null,note,photoIntentId:proof?.intentId||null}).run();}
 catch(e){if(!proof?.intentId||!await db.select().from(shiftEvents).where(eq(shiftEvents.photoIntentId,proof.intentId)).get())throw e;}
}
function shiftResult(record,action,name){return {action,shiftId:record.id,at:action==='in'?record.startedAt:record.endedAt,name,
 ...(action==='out'?{hours:Number(((record.endedAt-record.startedAt)/3600).toFixed(2)),closeComment:record.closeComment}: {})};}
export async function scanShift(tgId,token,action,proof=null){
 requireInput(validId(tgId),'UNAUTHORIZED','Требуется пользователь Telegram');
 requireInput(action==='in'||action==='out','BAD_ACTION','Ожидается начало или конец смены');
 requireInput(isShiftToken(token),'BAD_QR','Некорректный QR-код');
 // Recovery identifies the committed operation, never creates a second shift.
 let committed=proof?.intentId?await db.select().from(shifts).where(eq(action==='in'?shifts.arrivalIntentId:shifts.departureIntentId,proof.intentId)).get():null;
 if(committed){
  const person=await db.select().from(employees).where(and(eq(employees.id,committed.employeeId),eq(employees.tgId,Number(tgId)))).get();
  requireInput(!!person,'FORBIDDEN','Отметка принадлежит другому сотруднику');
  await saveShiftEvent(committed,tgId,action,token,proof,action==='in'?committed.startedAt:committed.endedAt,proof.closeComment||null);
  return {...shiftResult(committed,action,person.name),alreadyDone:true};
 }
 const qr=await db.select().from(qrPasses).where(eq(qrPasses.token,token)).get()||proof?.qrSnapshot;
 requireInput(!!qr,'BAD_QR','QR-код не найден');validateProofTime(qr.expiresAt,proof?.validatedAt??now());
 const dev=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!dev,'DEVICE_REVOKED','Рабочее устройство отозвано');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,qr.orgId),eq(employees.tgId,Number(tgId)),eq(employees.active,1))).get();
 requireInput(!!person,'FORBIDDEN','Вы не зарегистрированы как сотрудник этой организации');
 let opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();
 if(opened&&await repairOpenCorrection(opened))opened=null;
 const sec=proof?.eventAt??now();
 requireInput(Number.isSafeInteger(sec)&&sec>0&&sec<=now()+5,'BAD_EVENT_TIME','Некорректное время события');
 if(action==='in'){
  requireInput(!opened,'SHIFT_ALREADY_OPEN','У вас уже есть открытая смена');
  const loc=await db.select().from(locations).where(and(eq(locations.id,qr.locationId),eq(locations.orgId,qr.orgId))).get();
  const org=await db.select().from(organizations).where(eq(organizations.id,qr.orgId)).get();
  requireInput(!!loc&&!!org,'BAD_LOCATION','Рабочая точка недоступна');
  const plan=proof?.planSnapshot||await resolveShiftPlan(org,loc,person,sec);
  if(plan.assignmentId!=null){const used=await db.select().from(shifts).where(eq(shifts.assignmentId,plan.assignmentId)).get();requireInput(!used,'SHIFT_ALREADY_WORKED','Эта назначенная смена уже отмечена');}
  const note=validateCloseComment(proof?.closeComment);let record;
  try{[record]=await db.insert(shifts).values({orgId:qr.orgId,locationId:qr.locationId,employeeId:person.id,startedAt:sec,sourceIn:token,
   hourlyKopeksSnapshot:plan.hourlyKopeks??person.hourlyKopeks,shiftBonusKopeksSnapshot:plan.shiftBonusKopeks??person.shiftBonusKopeks??0,
   createdAt:sec,plannedStartAt:plan.plannedStartAt,plannedEndAt:plan.plannedEndAt,closeGraceMinutes:plan.closeGraceMinutes,
   templateId:plan.templateId,assignmentId:plan.assignmentId,occurrenceKey:plan.occurrenceKey||null,arrivalIntentId:proof?.intentId||null}).returning().run();}
  catch(e){
   const same=proof?.intentId?await db.select().from(shifts).where(eq(shifts.arrivalIntentId,proof.intentId)).get():null;
   if(same)record=same;
   else if(await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get())throw new DomainError('SHIFT_ALREADY_OPEN','У вас уже есть открытая смена');
   else if(plan.occurrenceKey&&await db.select().from(shifts).where(eq(shifts.occurrenceKey,plan.occurrenceKey)).get())throw new DomainError('SHIFT_ALREADY_WORKED','Эта смена уже отмечена');
   else throw e;
  }
  await saveShiftEvent(record,tgId,action,token,proof,sec,note);
  return {...shiftResult(record,action,person.name),templateName:plan.templateName};
 }
 requireInput(!!opened,'NO_OPEN_SHIFT','Нет открытой смены');
 requireInput(!proof?.targetShiftId||opened.id===proof.targetShiftId,'SHIFT_CHANGED','Открытая смена изменилась. Сканируйте QR заново');
 requireInput(opened.locationId===qr.locationId,'WRONG_LOCATION','Смена начата на другой точке; требуется исправление владельца');
 requireInput(opened.sourceIn!==token,'SAME_QR','Для ухода необходим новый QR-код');
 requireInput(sec>opened.startedAt,'BAD_DURATION','Окончание должно быть позже начала');
 const review=closingReview(sec,opened.plannedEndAt,opened.closeGraceMinutes??5),comment=validateCloseComment(proof?.closeComment,review);
 const result=await db.update(shifts).set({endedAt:sec,sourceOut:token,closeComment:comment,departureIntentId:proof?.intentId||null}).where(and(eq(shifts.id,opened.id),isNull(shifts.endedAt))).run();
 if(result.rowsAffected!==1){
  const same=proof?.intentId?await db.select().from(shifts).where(eq(shifts.departureIntentId,proof.intentId)).get():null;
  requireInput(!!same,'SHIFT_ALREADY_CLOSED','Эта смена уже закрыта');
  await saveShiftEvent(same,tgId,action,token,proof,same.endedAt,comment);return {...shiftResult(same,action,person.name),alreadyDone:true};
 }
 const record={...opened,endedAt:sec,closeComment:comment};await saveShiftEvent(record,tgId,action,token,proof,sec,comment);
 return {...shiftResult(record,action,person.name),closeReview:review};
}
// A short-lived, authenticated photo intent preserves a 30s QR check while the user
// grants camera permission and takes a picture. A picture is REQUIRED to finish.
export async function beginPhotoShift(tgId,token,action){
 requireInput(validId(tgId),'UNAUTHORIZED','Неизвестный сотрудник');
 requireInput(['in','out'].includes(action),'BAD_ACTION','Укажите приход или уход');
 requireInput(isShiftToken(token),'BAD_QR','Некорректный код');
 const qr=await resolvePhotoQr(tgId,token);
 const device=await db.select().from(devices).where(and(eq(devices.id,qr.deviceId),isNull(devices.revokedAt))).get();
 requireInput(!!device,'DEVICE_REVOKED','Устройство отозвано');
 const loc=await db.select().from(locations).where(and(eq(locations.id,qr.locationId),eq(locations.orgId,qr.orgId))).get();
 requireInput(!!loc?.chatId,'NO_WORK_CHAT','Владелец должен привязать рабочую Telegram-группу');
 const person=await db.select().from(employees).where(and(eq(employees.orgId,qr.orgId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
 requireInput(!!person,'FORBIDDEN','Сотрудник не привязан к организации');
 let opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();
 if(opened&&await repairOpenCorrection(opened))opened=null;
 requireInput(action==='in'?!opened:!!opened,action==='in'?'SHIFT_ALREADY_OPEN':'NO_OPEN_SHIFT',action==='in'?'У вас уже есть открытая смена':'Нет открытой смены');
 if(action==='out')requireInput(opened.locationId===loc.id && opened.sourceIn!==token,'WRONG_LOCATION','Смена открыта на другой точке или этот QR уже использовался');
 const sec=now(),intent={id:nonce(24),qrToken:token,orgId:qr.orgId,locationId:loc.id,
  employeeId:person.id,actorTgId:tgId,action,createdAt:sec,expiresAt:sec+180,status:'pending'};
 const closeReview=action==='out'?closingReview(sec,opened.plannedEndAt,opened.closeGraceMinutes??5):null;
 let templateName=null,planSnapshot=null;
 if(action==='in'){const org=await db.select().from(organizations).where(eq(organizations.id,qr.orgId)).get();
  requireInput(!!org,'BAD_LOCATION','Организация не найдена');
  const plan=await resolveShiftPlan(org,loc,person,sec);templateName=plan.templateName;planSnapshot={...plan,hourlyKopeks:person.hourlyKopeks,shiftBonusKopeks:person.shiftBonusKopeks||0};}
 else if(opened?.templateId){const template=await db.select().from(shiftTemplates).where(eq(shiftTemplates.id,opened.templateId)).get();templateName=template?.name||null;}
 await db.insert(photoIntents).values({...intent,qrSnapshot:{token:qr.token,orgId:qr.orgId,locationId:qr.locationId,deviceId:qr.deviceId,expiresAt:qr.expiresAt},planSnapshot,targetShiftId:opened?.id||null}).run();
 return {intentId:intent.id,expiresAt:intent.expiresAt,location:loc.name,employee:person.name,action,closeReview,templateName,shiftMode:planSnapshot?.mode};
}

export async function completePhotoShift(tgId,intentId,selfieBase64,closeComment){
 requireInput(validId(tgId),'UNAUTHORIZED','Нет Telegram ID');
 requireInput(typeof intentId==='string'&&/^[A-Za-z0-9_-]{32}$/.test(intentId),'BAD_INTENT','Некорректная сессия');
 let intent=await db.select().from(photoIntents).where(and(eq(photoIntents.id,intentId),eq(photoIntents.actorTgId,tgId))).get();
 requireInput(!!intent,'BAD_INTENT','Сессия принадлежит другому пользователю либо не найдена');
 requireInput(intent.expiresAt>now() || intent.status==='sent' || intent.status==='done','EXPIRED','Срок съёмки истёк — сканируйте QR заново');
 if(intent.status==='done')return {action:intent.action,shiftId:intent.shiftId,name:'Сотрудник',photoMessageId:intent.photoMessageId,alreadyDone:true,notificationDelivered:await confirmPhotoMessage(intent)};
 const committed=await db.select().from(shifts).where(eq(intent.action==='in'?shifts.arrivalIntentId:shifts.departureIntentId,intent.id)).get();
 const deviceQr=await db.select().from(qrPasses).where(eq(qrPasses.token,intent.qrToken)).get()||intent.qrSnapshot;
 requireInput(!!deviceQr||!!committed,'BAD_QR','Данные QR отсутствуют. Требуется проверка владельца');
 const device=deviceQr?await db.select().from(devices).where(and(eq(devices.id,deviceQr.deviceId),isNull(devices.revokedAt))).get():null;
 requireInput(!!device||!!committed,'DEVICE_REVOKED','Рабочее устройство больше не активно');
 if(intent.status==='pending'){
  // Validate the reason BEFORE sending anything to the group; never leave a photo
  // for a rejected early/late close. Use the time the QR was scanned.
  let note=validateCloseComment(closeComment);
  if(intent.action==='out'){
   const opened=await db.select().from(shifts).where(and(eq(shifts.employeeId,intent.employeeId),isNull(shifts.endedAt))).get();
   requireInput(!!opened&&opened.locationId===intent.locationId&&(!intent.targetShiftId||opened.id===intent.targetShiftId),'NO_OPEN_SHIFT','Смена не найдена или уже закрыта');
   const review=closingReview(intent.createdAt,opened.plannedEndAt,opened.closeGraceMinutes??5);
   note=validateCloseComment(closeComment,review);
  }
  const bytes=decodeSelfie(selfieBase64);
  const reserved=await db.update(photoIntents).set({status:'uploading',closeComment:note,lastAttemptAt:now()}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'pending'))).run();
  requireInput(reserved.rowsAffected===1,'IN_PROGRESS','Фотография уже обрабатывается');
  let receipt=null,attempted=false;
  try{
   const loc=await db.select().from(locations).where(eq(locations.id,intent.locationId)).get();
   requireInput(!!loc?.chatId,'NO_WORK_CHAT','Не привязана рабочая группа');
   const person=await db.select().from(employees).where(and(eq(employees.id,intent.employeeId),eq(employees.tgId,tgId),eq(employees.active,1))).get();
   requireInput(!!person,'FORBIDDEN','Сотрудник не активен');
   const shift=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();
   if(intent.action==='in'){requireInput(!shift,'SHIFT_ALREADY_OPEN','У вас уже есть открытая смена');const plan=intent.planSnapshot;if(plan?.assignmentId)requireInput(!await db.select().from(shifts).where(eq(shifts.assignmentId,plan.assignmentId)).get(),'SHIFT_ALREADY_WORKED','Назначенная смена уже отмечена');if(plan?.occurrenceKey)requireInput(!await db.select().from(shifts).where(eq(shifts.occurrenceKey,plan.occurrenceKey)).get(),'SHIFT_ALREADY_WORKED','Эта смена уже отмечена');}
   let template=intent.action==='out'&&shift?.templateId?await db.select().from(shiftTemplates).where(eq(shiftTemplates.id,shift.templateId)).get():null;
   if(intent.action==='in'){const org=await db.select().from(organizations).where(eq(organizations.id,intent.orgId)).get();
    const plan=intent.planSnapshot||await resolveShiftPlan(org,loc,person,intent.createdAt);
    if(plan.templateId)template=await db.select().from(shiftTemplates).where(eq(shiftTemplates.id,plan.templateId)).get();}
   const org=await db.select().from(organizations).where(eq(organizations.id,intent.orgId)).get();
   attempted=true;
   const photo=await api.sendPhoto({chat_id:loc.chatId,
    photo:new InputFile(bytes,'shift-selfie.jpg',{type:'image/jpeg'}),
    caption:shiftPhotoCaption({action:intent.action,employee:person.name,location:loc.name,templateName:template?.name,eventAt:intent.createdAt,timezone:org.timezone,comment:note})});
   const fileId=photo.photo?.at(-1)?.file_id;
   requireInput(!!fileId&&!!photo.message_id,'TELEGRAM_PHOTO','Telegram не вернул подтверждение фотографии');
   receipt={status:'sent',photoFileId:fileId,photoMessageId:photo.message_id};
   await db.update(photoIntents).set(receipt).where(eq(photoIntents.id,intent.id)).run();
  }catch(e){
   // A confirmed Telegram receipt may be saved again; never send the image again.
   const state=receipt||{status:!attempted||e instanceof BotApiError&&e.code>=400&&e.code<500?'pending':'uncertain'};
   await db.update(photoIntents).set(state).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'uploading'))).run();
   if(!receipt)throw e;
  }
 }
 intent=await db.select().from(photoIntents).where(eq(photoIntents.id,intentId)).get();
 requireInput(intent.status==='sent',intent.status==='cancelled'?'CANCELLED':'DELIVERY_UNCERTAIN',intent.status==='cancelled'?'Отправка отменена владельцем. Сканируйте новый QR.':'Доставка не подтверждена. Владелец должен сверить фотографию в группе и восстановить отметку в табеле.');
 const result=await scanShift(tgId,intent.qrToken,intent.action,{intentId:intent.id,validatedAt:intent.createdAt,eventAt:intent.createdAt,photoFileId:intent.photoFileId,closeComment:intent.closeComment,planSnapshot:intent.planSnapshot,targetShiftId:intent.targetShiftId,qrSnapshot:intent.qrSnapshot});
 await db.update(photoIntents).set({status:'done',shiftId:result.shiftId}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,'sent'))).run();
 return {...result,photoMessageId:intent.photoMessageId,notificationDelivered:await confirmPhotoMessage({...intent,shiftId:result.shiftId})};
}

/** Owner-only dashboard: never return this to group chat or employee. */
export async function dashboardOverview(tgId,args=[],stamp=Date.now()){
 const org=await requireOwner(tgId);
 const period=reportPeriod(args,stamp,org.timezone);
 const start=period.start,end=addDays(period.end,-1);
 const [points,team,templates,roster,history,preview]=await Promise.all([
  listLocations(tgId),listEmployees(tgId),
  db.select().from(shiftTemplates).where(eq(shiftTemplates.orgId,org.id)).all(),
  db.select().from(shiftAssignments).where(and(eq(shiftAssignments.orgId,org.id),gte(shiftAssignments.workDate,start),lte(shiftAssignments.workDate,end))).all(),
  db.select().from(shifts).where(eq(shifts.orgId,org.id)).all(),
  makeReport(tgId,args,stamp)
 ]);
 const corrections=await db.select().from(shiftCorrections).where(eq(shiftCorrections.orgId,org.id)).all();
 const allEffective=applyCorrections(history,corrections);
 const effectiveHistory=allEffective.filter(s=>s.startedAt*1000<period.endMs&&(s.endedAt==null||s.endedAt*1000>=period.startMs));
 const pendingPhotos=await db.select().from(photoIntents).where(and(eq(photoIntents.orgId,org.id),inArray(photoIntents.status,['sent','uploading','uncertain']))).all();
 const approvals=await db.select().from(payrollApprovals).where(and(eq(payrollApprovals.orgId,org.id),eq(payrollApprovals.periodStart,period.start),eq(payrollApprovals.periodEnd,period.end))).orderBy(desc(payrollApprovals.createdAt)).all();
 const byTemplate=new Map(templates.map(t=>[t.id,t]));
 const startEvents=[];
 for(let i=0;i<history.length;i+=200){
  startEvents.push(...await db.select().from(shiftEvents).where(and(eq(shiftEvents.action,'in'),inArray(shiftEvents.shiftId,history.slice(i,i+200).map(s=>s.id)))).all());
 }
 const commentsByShift=new Map(startEvents.map(e=>[e.shiftId,e.note]));
 const absences=await db.select().from(assignmentResolutions).where(eq(assignmentResolutions.orgId,org.id)).all();
 const attendance=[];
 for(const a of roster){
  const template=byTemplate.get(a.templateId);if(!template)continue;
  const w=a.planSnapshot?.window||templateWindow(a.workDate,template,org.timezone);
  const actual=allEffective.find(s=>s.assignmentId===a.id);
  const absence=absences.find(x=>x.assignmentId===a.id&&x.decision==='absent');
  const state=absence?'absent':actual?actual.endedAt?'completed':'open':w.endAt*1000<stamp?'missing':'upcoming';
  attendance.push({assignmentId:a.id,workDate:a.workDate,employeeId:a.employeeId,locationId:a.locationId,
   templateId:a.templateId,templateName:a.planSnapshot?.template?.name||template.name,plannedStartAt:actual?.plannedStartAt??w.startAt,plannedEndAt:actual?.plannedEndAt??w.endAt,
   shiftId:actual?.id??null,actualStartAt:actual?.startedAt??null,actualEndAt:actual?.endedAt??null,
   status:state,absenceReason:absence?.reason||null,closeComment:actual?.closeComment??null});
 }
 attendance.sort((a,b)=>a.plannedStartAt-b.plannedStartAt||a.employeeId-b.employeeId);
 return {organization:{id:org.id,name:org.name,timezone:org.timezone},period:preview.period,
  locations:points,employees:team,templates,assignments:attendance,
  approvals:approvals.map(a=>({id:a.id,createdAt:a.createdAt,totalKopeks:a.snapshot.totals.grossKopeks,current:JSON.stringify(a.snapshot)===JSON.stringify(preview)})),
  pendingPhotos:pendingPhotos.map(i=>({id:i.id,employeeId:i.employeeId,locationId:i.locationId,action:i.action,status:i.status,at:i.createdAt})),
  shifts:effectiveHistory.map(s=>({id:s.id,employeeId:s.employeeId,locationId:s.locationId,templateId:s.templateId,
   startedAt:s.startedAt,endedAt:s.endedAt,plannedStartAt:s.plannedStartAt,plannedEndAt:s.plannedEndAt,
   startComment:commentsByShift.get(s.id),closeComment:s.closeComment,correction:s.correction||null})),
  preview,summary:{scheduled:attendance.length,missing:attendance.filter(x=>x.status==='missing').length,
   completed:effectiveHistory.filter(s=>s.endedAt!=null).length,unclosed:effectiveHistory.filter(s=>s.endedAt==null).length,
   deviations:preview.exceptions.length,workedHours:Number((preview.totals.seconds/3600).toFixed(2)),grossKopeks:preview.totals.grossKopeks}};
}
export async function makeReport(tgId,args=[],stamp=Date.now()){
 const org=await requireOwner(tgId), period=reportPeriod(args,stamp,org.timezone);
 const [people,rawRecords,extras,corrections,sales]=await Promise.all([
  db.select().from(employees).where(eq(employees.orgId,org.id)).all(),
  db.select().from(shifts).where(eq(shifts.orgId,org.id)).all(),
  db.select().from(bonuses).where(and(eq(bonuses.orgId,org.id),gte(bonuses.date,period.start),lt(bonuses.date,period.end))).all(),
  db.select().from(shiftCorrections).where(eq(shiftCorrections.orgId,org.id)).all(),
  db.select().from(salesEntries).where(and(eq(salesEntries.orgId,org.id),gte(salesEntries.date,period.start),lt(salesEntries.date,period.end))).all()
 ]);
 const records=applyCorrections(rawRecords,corrections).filter(s=>s.startedAt*1000<period.endMs&&(s.endedAt==null||s.endedAt*1000>=period.startMs));
 const preview=computePreview({employees:people,shifts:records,bonuses:extras,sales,period});
 const [assigned,templates]=await Promise.all([
  db.select().from(shiftAssignments).where(and(eq(shiftAssignments.orgId,org.id),gte(shiftAssignments.workDate,period.start),lt(shiftAssignments.workDate,period.end))).all(),
  db.select().from(shiftTemplates).where(eq(shiftTemplates.orgId,org.id)).all()
 ]);
 const byId=new Map(templates.map(t=>[t.id,t]));
 const absences=await db.select().from(assignmentResolutions).where(eq(assignmentResolutions.orgId,org.id)).all();
 preview.absences=absences.filter(x=>x.decision==='absent'&&assigned.some(a=>a.id===x.assignmentId)).map(x=>({assignmentId:x.assignmentId,reason:x.reason}));
 preview.missingAssignments=[];
 for(const a of assigned){
  const template=byId.get(a.templateId);if(!template)continue;
  const expected=a.planSnapshot?.window||templateWindow(a.workDate,template,org.timezone);
  if(expected.endAt*1000>stamp||rawRecords.some(s=>s.assignmentId===a.id)||absences.some(x=>x.assignmentId===a.id&&x.decision==='absent'))continue;
  preview.missingAssignments.push({assignmentId:a.id,workDate:a.workDate,employeeId:a.employeeId,
   name:people.find(p=>p.id===a.employeeId)?.name||'Сотрудник',templateName:a.planSnapshot?.template?.name||template.name,plannedStartAt:expected.startAt,plannedEndAt:expected.endAt});
 }
 preview.missingAssignments.sort((a,b)=>a.assignmentId-b.assignmentId);preview.absences.sort((a,b)=>a.assignmentId-b.assignmentId);
 return preview;
}
export async function findProblems(tgId,stamp=Date.now()) {
 const org=await requireOwner(tgId),todayMs=startOfLocalDay(formatDate(stamp,org.timezone),org.timezone);
 const people=await db.select().from(employees).where(eq(employees.orgId,org.id)).all();
 const pending=await db.select().from(shifts).where(and(eq(shifts.orgId,org.id),isNull(shifts.endedAt),lt(shifts.startedAt,Math.floor(todayMs/1000)))).orderBy(desc(shifts.startedAt)).limit(100).all();
 return pending.map(s=>({shiftId:s.id,employeeId:s.employeeId,name:people.find(e=>e.id===s.employeeId)?.name||'Неизвестный сотрудник',startedAt:s.startedAt,timezone:org.timezone}));
}
export {formatReport} from './report-format.js';
