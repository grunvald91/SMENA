import {db} from 'sdk';
import {eq,and,isNull,desc} from 'sdk/db';
import {employees,shifts,shiftCorrections,employeeSalesRules,salesEntries,auditLog,photoIntents,payrollApprovals,shiftAssignments,shiftTemplates,assignmentResolutions} from '../schema.js';
import {requireOwner,completePhotoShift,assignShift,makeReport} from './service.js';
import {requireInput} from './errors.js';
import {templateWindow} from './roster.js';
import {parseISODate,formatDate,addDays} from './time.js';
const now=()=>Math.floor(Date.now()/1000);
export function operationId(id){requireInput(typeof id==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(id),'BAD_OPERATION','Некорректный идентификатор операции');return id;}
function note(value){requireInput(typeof value==='string'&&value.trim().length>=5&&value.trim().length<=500,'BAD_REASON','Укажите причину: 5–500 символов');return value.trim();}
function confirmed(value){requireInput(value===true,'CONFIRM_REQUIRED','Подтвердите изменение');}
export function applyCorrections(records,corrections){
 return records.map(s=>{const latest=corrections.filter(c=>c.shiftId===s.id).sort((a,b)=>b.version-a.version)[0];
  return latest?{...s,startedAt:latest.startedAt,endedAt:latest.endedAt,correction:{id:latest.id,version:latest.version,reason:latest.reason},closeComment:latest.reason}:s;
 });
}
export async function repairOpenCorrection(shift){
 const c=await db.select().from(shiftCorrections).where(eq(shiftCorrections.shiftId,shift.id)).orderBy(desc(shiftCorrections.version)).get();
 if(c&&shift.endedAt==null)await db.update(shifts).set({endedAt:c.endedAt,sourceOut:`correction:${c.id}`,closeComment:c.reason}).where(and(eq(shifts.id,shift.id),isNull(shifts.endedAt))).run();
 return c;
}
export async function correctShift(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);operationId(input.requestId);
 const reason=note(input.reason),start=Number(input.startedAt),end=Number(input.endedAt);
 requireInput(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>0&&end>start&&end<=now()+5,'BAD_TIME','Проверьте начало и конец смены');
 const raw=await db.select().from(shifts).where(and(eq(shifts.id,Number(input.shiftId)),eq(shifts.orgId,org.id))).get();
 requireInput(!!raw,'NOT_FOUND','Смена не найдена');
 const known=await db.select().from(shiftCorrections).where(eq(shiftCorrections.id,input.requestId)).get();
 if(known){requireInput(known.orgId===org.id&&known.shiftId===raw.id&&known.startedAt===start&&known.endedAt===end&&known.reason===reason,'CONFLICT','Операция уже использована');await repairOpenCorrection(raw);return known;}
 const corrections=await db.select().from(shiftCorrections).where(eq(shiftCorrections.orgId,org.id)).all();
 requireInput(raw.endedAt!=null||end>raw.startedAt,'BAD_TIME','Уход открытой смены должен быть позже зафиксированного прихода');
 const effective=applyCorrections([raw],corrections)[0],version=effective.correction?.version||0;
 requireInput(input.baseVersion===version,'CONFLICT','Смена изменилась. Обновите данные перед исправлением');
 const others=applyCorrections(await db.select().from(shifts).where(eq(shifts.employeeId,raw.employeeId)).all(),corrections);
 requireInput(!others.some(s=>s.id!==raw.id&&start<(s.endedAt??now())&&end>s.startedAt),'SHIFT_OVERLAP','Исправление пересекается с другой сменой сотрудника');
 const value={id:input.requestId,orgId:org.id,shiftId:raw.id,version:version+1,startedAt:start,endedAt:end,before:{startedAt:effective.startedAt,endedAt:effective.endedAt},reason,actorTgId:tgId,createdAt:now()};
 try{await db.insert(shiftCorrections).values(value).run();}catch(e){const same=await db.select().from(shiftCorrections).where(eq(shiftCorrections.id,value.id)).get();if(!same)throw e;requireInput(same.orgId===org.id&&same.shiftId===raw.id&&same.startedAt===start&&same.endedAt===end&&same.reason===reason,'CONFLICT','Операция уже использована');}
 await repairOpenCorrection(raw);return value;
}
export async function setEmployeeActive(tgId,employeeId,active,confirmation){
 const org=await requireOwner(tgId);confirmed(confirmation);requireInput(typeof active==='boolean','BAD_EMPLOYEE','Некорректный статус');
 const person=await db.select().from(employees).where(and(eq(employees.id,Number(employeeId)),eq(employees.orgId,org.id))).get();requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 if(!active){const open=await db.select().from(shifts).where(and(eq(shifts.employeeId,person.id),isNull(shifts.endedAt))).get();requireInput(!open,'OPEN_SHIFT','Сначала закройте или исправьте открытую смену');}
 await db.update(employees).set({active:active?1:0}).where(eq(employees.id,person.id)).run();
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'employee.active',refId:String(person.id),data:{active},at:now()}).run();return {active};
}
export async function salesContext(tgId){
 const org=await requireOwner(tgId);const [rules,entries]=await Promise.all([db.select().from(employeeSalesRules).where(eq(employeeSalesRules.orgId,org.id)).all(),db.select().from(salesEntries).where(eq(salesEntries.orgId,org.id)).orderBy(desc(salesEntries.createdAt)).limit(200).all()]);return {rules,entries};
}
export async function setSalesRule(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);
 const person=await db.select().from(employees).where(and(eq(employees.id,Number(input.employeeId)),eq(employees.orgId,org.id))).get();requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 requireInput(Number.isSafeInteger(input.rateBasisPoints)&&input.rateBasisPoints>=0&&input.rateBasisPoints<=10000,'BAD_RATE','Процент должен быть от 0 до 100');
 const previous=await db.select().from(employeeSalesRules).where(eq(employeeSalesRules.employeeId,person.id)).get();
 const value={employeeId:person.id,orgId:org.id,rateBasisPoints:input.rateBasisPoints,updatedAt:now()};
 if(previous)await db.update(employeeSalesRules).set(value).where(eq(employeeSalesRules.employeeId,person.id)).run();else await db.insert(employeeSalesRules).values(value).run();
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'sales.rate',refId:String(person.id),data:{before:previous?.rateBasisPoints||0,after:value.rateBasisPoints},at:now()}).run();return value;
}
export async function addSalesEntry(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);operationId(input.requestId);const reason=note(input.reason);
 const previous=await db.select().from(salesEntries).where(eq(salesEntries.id,input.requestId)).get();
 if(previous){requireInput(previous.orgId===org.id&&previous.reason===reason&&previous.employeeId===Number(input.employeeId)&&previous.date===input.date&&previous.amountKopeks===input.amountKopeks&&previous.refundOf===(input.refundOf||null),'CONFLICT','Операция уже использована');return previous;}
 parseISODate(input.date);requireInput(input.date<=formatDate(Date.now(),org.timezone),'FUTURE_DATE','Продажи не могут быть в будущем');
 const person=await db.select().from(employees).where(and(eq(employees.id,Number(input.employeeId)),eq(employees.orgId,org.id))).get();requireInput(!!person,'NOT_FOUND','Сотрудник не найден');
 let value;
 if(input.refundOf){
  const sale=await db.select().from(salesEntries).where(and(eq(salesEntries.id,input.refundOf),eq(salesEntries.orgId,org.id),eq(salesEntries.employeeId,person.id))).get();
  requireInput(!!sale&&sale.amountKopeks>0&&!sale.refundOf,'BAD_REFUND','Продажа для возврата не найдена');
  requireInput(input.amountKopeks===-sale.amountKopeks&&input.date>=sale.date,'BAD_REFUND','Возврат должен полностью отменять исходную продажу');
  requireInput(!await db.select().from(salesEntries).where(eq(salesEntries.refundOf,sale.id)).get(),'ALREADY_REFUNDED','Продажа уже возвращена');
  value={amountKopeks:-sale.amountKopeks,rateBasisPointsSnapshot:sale.rateBasisPointsSnapshot,commissionKopeks:-sale.commissionKopeks,refundOf:sale.id};
 }else{
  requireInput(Number.isSafeInteger(input.amountKopeks)&&input.amountKopeks>0&&input.amountKopeks<=1e9,'BAD_AMOUNT','Проверьте сумму продаж');
  const rule=await db.select().from(employeeSalesRules).where(eq(employeeSalesRules.employeeId,person.id)).get();requireInput(rule?.rateBasisPoints>0,'NO_SALES_RATE','Сначала установите процент сотруднику');
  value={amountKopeks:input.amountKopeks,rateBasisPointsSnapshot:rule.rateBasisPoints,commissionKopeks:Math.round(input.amountKopeks*rule.rateBasisPoints/10000),refundOf:null};
 }
 const entry={...value,id:input.requestId,orgId:org.id,employeeId:person.id,date:input.date,reason,actorTgId:tgId,createdAt:now()};try{await db.insert(salesEntries).values(entry).run();}catch(e){const same=await db.select().from(salesEntries).where(eq(salesEntries.id,entry.id)).get();if(!same)throw e;requireInput(same.orgId===entry.orgId&&same.employeeId===entry.employeeId&&same.date===entry.date&&same.amountKopeks===entry.amountKopeks&&same.refundOf===entry.refundOf&&same.reason===entry.reason,'CONFLICT','Операция уже использована');return same;}return entry;
}
export async function resolveAttendance(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);const reason=note(input.reason);
 const intent=await db.select().from(photoIntents).where(and(eq(photoIntents.id,input.intentId),eq(photoIntents.orgId,org.id))).get();requireInput(!!intent,'NOT_FOUND','Отметка не найдена');
 requireInput(['uncertain','uploading'].includes(intent.status),'CONFLICT','Доставка уже разрешена или отметка не требует проверки');
 requireInput((intent.lastAttemptAt||intent.createdAt)<now()-300,'IN_PROGRESS','Подождите окончания текущей отправки');
 const received=input.action==='received';requireInput(received||input.action==='missing','BAD_ACTION','Выберите получено или не доставлено');
 if(received)requireInput(Number.isSafeInteger(input.messageId)&&input.messageId>0,'BAD_MESSAGE','Укажите номер сообщения с фотографией в рабочей группе');
 await db.insert(auditLog).values({orgId:org.id,actorTgId:tgId,action:'attendance.delivery_resolved',refId:intent.id,data:{action:input.action,reason,messageId:received?input.messageId:null},at:now()}).run();
 const changed=await db.update(photoIntents).set(received?{status:'sent',photoMessageId:input.messageId}:{status:'cancelled'}).where(and(eq(photoIntents.id,intent.id),eq(photoIntents.status,intent.status))).run();requireInput(changed.rowsAffected===1,'CONFLICT','Отметка изменилась');if(received)return completePhotoShift(intent.actorTgId,intent.id);return {received};
}

export async function resumeAttendance(tgId,intentId){
 const org=await requireOwner(tgId),intent=await db.select().from(photoIntents).where(and(eq(photoIntents.id,intentId),eq(photoIntents.orgId,org.id))).get();
 requireInput(!!intent&&['sent','done'].includes(intent.status),'NOT_FOUND','Нет сохранённой доставки для восстановления');
 return completePhotoShift(intent.actorTgId,intent.id);
}

export async function assignRange(tgId,input){
 await requireOwner(tgId);confirmed(input.confirmed);parseISODate(input.start);parseISODate(input.end);
 requireInput(input.start<=input.end&&input.end<=addDays(input.start,30),'BAD_PERIOD','Выберите до 31 дня');
 requireInput(Array.isArray(input.employeeIds)&&input.employeeIds.length>0&&input.employeeIds.length<=30&&input.employeeIds.every(Number.isSafeInteger),'BAD_EMPLOYEE','Выберите от 1 до 30 сотрудников');
 const count=(parseISODate(input.end)-parseISODate(input.start))/86400000+1;requireInput(count*new Set(input.employeeIds).size<=100,'BAD_PERIOD','За один запрос можно назначить до 100 смен; разделите график на части');
 const result={created:0,existing:0,conflicts:[]};
 for(let date=input.start;date<=input.end;date=addDays(date,1))for(const person of [...new Set(input.employeeIds)]){
  try{await assignShift(tgId,person,input.templateId,date);result.created++;}
  catch(e){if(e.code==='ALREADY_EXISTS')result.existing++;else if(e.code==='SHIFT_OVERLAP')result.conflicts.push({employeeId:person,date});else throw e;}
 }
 return result;
}

export async function approvePayroll(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);operationId(input.requestId);
 requireInput(typeof input.month==='string'&&/^\d{4}-\d{2}$/.test(input.month),'BAD_PERIOD','Выберите месяц');
 const existing=await db.select().from(payrollApprovals).where(eq(payrollApprovals.id,input.requestId)).get();
 if(existing){requireInput(existing.orgId===org.id&&existing.periodStart===input.month+'-01'&&JSON.stringify(existing.snapshot)===input.expected,'CONFLICT','Операция уже использована');return existing;}
 const preview=await makeReport(tgId,[input.month]);
 requireInput(JSON.stringify(preview)===input.expected,'STALE_PAYROLL','Расчёт изменился. Обновите и проверьте его перед подтверждением');
 requireInput(preview.totals.unclosed===0&&preview.missingAssignments.length===0,'UNRESOLVED','Сначала исправьте незакрытые смены и пропущенные отметки');
 const pending=await db.select().from(photoIntents).where(eq(photoIntents.orgId,org.id)).all();requireInput(!pending.some(i=>['sent','uploading','uncertain'].includes(i.status)),'UNRESOLVED','Сначала восстановите незавершённые фотоотметки в табеле');
 const value={id:input.requestId,orgId:org.id,periodStart:preview.period.start,periodEnd:preview.period.endExclusive,snapshot:preview,actorTgId:tgId,createdAt:now()};
 try{await db.insert(payrollApprovals).values(value).run();}catch(e){const same=await db.select().from(payrollApprovals).where(eq(payrollApprovals.id,value.id)).get();if(!same)throw e;requireInput(same.orgId===value.orgId&&JSON.stringify(same.snapshot)===input.expected,'CONFLICT','Операция уже использована');return same;}return value;
}

export async function resolveMissingShift(tgId,input){
 const org=await requireOwner(tgId);confirmed(input.confirmed);operationId(input.requestId);const reason=note(input.reason);
 const a=await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.id,Number(input.assignmentId)),eq(shiftAssignments.orgId,org.id))).get();requireInput(!!a,'NOT_FOUND','Назначение не найдено');
 requireInput(['absent','worked'].includes(input.decision),'BAD_ACTION','Выберите неявку или восстановление отметки');
 const absent=await db.select().from(assignmentResolutions).where(eq(assignmentResolutions.assignmentId,a.id)).get();
 if(absent){requireInput(absent.requestId===input.requestId&&absent.reason===reason&&absent.decision===input.decision&&JSON.stringify(absent.payload)===JSON.stringify({startedAt:input.startedAt??null,endedAt:input.endedAt??null,hourlyKopeks:input.hourlyKopeks??null,shiftBonusKopeks:input.shiftBonusKopeks??null}),'CONFLICT','Решение уже сохранено');if(absent.decision==='absent')return absent;}
 const known=await db.select().from(shifts).where(eq(shifts.assignmentId,a.id)).get();
 if(known){requireInput(input.decision==='worked'&&known.sourceIn===`manual:${input.requestId}`&&known.startedAt===input.startedAt&&known.endedAt===input.endedAt&&known.hourlyKopeksSnapshot===input.hourlyKopeks&&known.shiftBonusKopeksSnapshot===input.shiftBonusKopeks&&known.closeComment===reason,'CONFLICT','Назначение уже отмечено');return known;}
 const template=await db.select().from(shiftTemplates).where(eq(shiftTemplates.id,a.templateId)).get();requireInput(!!template,'NOT_FOUND','Тип смены не найден');
 const w=a.planSnapshot?.window||templateWindow(a.workDate,template,org.timezone);requireInput(w.endAt<now(),'IN_PROGRESS','Смена по графику ещё не закончилась');
 const pending=await db.select().from(photoIntents).where(and(eq(photoIntents.employeeId,a.employeeId),eq(photoIntents.action,'in'))).all();
 requireInput(!pending.some(i=>['sent','uploading','uncertain'].includes(i.status)||i.status==='pending'&&i.expiresAt>now()),'IN_PROGRESS','Сначала восстановите незавершённую фотоотметку');
 if(input.decision==='absent'){
  const value={assignmentId:a.id,orgId:org.id,decision:'absent',requestId:input.requestId,payload:{startedAt:input.startedAt??null,endedAt:input.endedAt??null,hourlyKopeks:input.hourlyKopeks??null,shiftBonusKopeks:input.shiftBonusKopeks??null},reason,actorTgId:tgId,createdAt:now()};await db.insert(assignmentResolutions).values(value).run();return value;
 }
 const start=input.startedAt,end=input.endedAt;
 requireInput(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>0&&end>start&&end<=now(),'BAD_TIME','Проверьте фактическое время');
 requireInput(Number.isSafeInteger(input.hourlyKopeks)&&input.hourlyKopeks>=0&&input.hourlyKopeks<=10000000&&Number.isSafeInteger(input.shiftBonusKopeks)&&input.shiftBonusKopeks>=0&&input.shiftBonusKopeks<=100000000,'BAD_RATE','Подтвердите ставку и надбавку в копейках');
 const corrections=await db.select().from(shiftCorrections).where(eq(shiftCorrections.orgId,org.id)).all();
 const other=applyCorrections(await db.select().from(shifts).where(eq(shifts.employeeId,a.employeeId)).all(),corrections);
 requireInput(!other.some(s=>start<(s.endedAt??now())&&end>s.startedAt),'SHIFT_OVERLAP','Время пересекается с другой сменой');
 const value={orgId:org.id,locationId:a.locationId,employeeId:a.employeeId,assignmentId:a.id,templateId:a.templateId,occurrenceKey:`assigned:${a.id}`,sourceIn:`manual:${input.requestId}`,sourceOut:`manual:${input.requestId}`,startedAt:start,endedAt:end,createdAt:now(),hourlyKopeksSnapshot:input.hourlyKopeks,shiftBonusKopeksSnapshot:input.shiftBonusKopeks,plannedStartAt:w.startAt,plannedEndAt:w.endAt,closeGraceMinutes:a.planSnapshot?.template?.graceMinutes??template.graceMinutes,closeComment:reason};
 if(!absent)await db.insert(assignmentResolutions).values({assignmentId:a.id,orgId:org.id,decision:'worked',requestId:input.requestId,payload:{startedAt:start,endedAt:end,hourlyKopeks:input.hourlyKopeks,shiftBonusKopeks:input.shiftBonusKopeks},reason,actorTgId:tgId,createdAt:now()}).run();
 const [record]=await db.insert(shifts).values(value).returning().run();
 return record;
}
