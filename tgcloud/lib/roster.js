import {requireInput} from './errors.js';
import {minuteOfDay} from './schedule.js';
import {addDays,formatDate,zonedParts} from './time.js';

export function validateTemplate(name,startTime,endTime,graceMinutes=5){
 requireInput(typeof name==='string' && name.trim().length>=2 && name.trim().length<=60,'BAD_TEMPLATE','Название смены: 2–60 символов');
 requireInput(minuteOfDay(startTime)!==minuteOfDay(endTime),'BAD_HOURS','Время начала и конца не совпадает');
 requireInput(Number.isSafeInteger(graceMinutes)&&graceMinutes>=0&&graceMinutes<=180,'BAD_GRACE','Допуск 0–180 минут');
 return {name:name.trim(),startTime,endTime,graceMinutes};
}
export function templateWindow(workDate,template,timezone){
 const start=minuteOfDay(template.startTime),end=minuteOfDay(template.endTime);
 requireInput(start!==end,'BAD_HOURS','Некорректная смена');
 const toUtc=(day,minute)=>{
  // Convert via local-midnight plus iterative timezone correction, including DST.
  const localDate=Date.parse(day+'T00:00:00Z')+minute*60000;
  let guess=localDate;
  for(let i=0;i<5;i++){
   const p=zonedParts(guess,timezone);
   const displayed=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
   const correction=displayed-localDate;
   if(!correction)break;
   guess-=correction;
  }
  const p=zonedParts(guess,timezone);
  requireInput(formatDate(guess,timezone)===day && p.hour*60+p.minute===minute,'BAD_LOCAL_TIME','Время смены невозможно в часовом поясе');
  return Math.floor(guess/1000);
 };
 return {startAt:toUtc(workDate,start),endAt:toUtc(addDays(workDate,end<=start?1:0),end)};
}

/** Only employee-specific assignments may resolve a check-in when multiple templates exist. */
export function chooseAssignment(scannedAt,timezone,assignments,templates){
 const byId=new Map(templates.map(t=>[t.id,t]));
 const candidates=assignments.filter(a=>byId.has(a.templateId)).map(a=>{
  const template=byId.get(a.templateId);
  const w=templateWindow(a.workDate,template,timezone);
  return {...w,assignmentId:a.id,templateId:template.id,templateName:template.name,graceMinutes:template.graceMinutes??5,
   differenceSeconds:scannedAt-w.startAt};
 }).filter(c=>c.differenceSeconds >= -3*3600 && c.differenceSeconds<=8*3600)
   .sort((a,b)=>Math.abs(a.differenceSeconds)-Math.abs(b.differenceSeconds));
 if(!candidates.length)return null;
 if(candidates.length>1 && Math.abs(Math.abs(candidates[0].differenceSeconds)-Math.abs(candidates[1].differenceSeconds))<60)
  requireInput(false,'AMBIGUOUS_SHIFT','Две смены близки по времени; уточните назначение у руководителя');
 return candidates[0];
}
export function daysAround(seconds,timezone){
 const today=formatDate(seconds*1000,timezone);
 return [addDays(today,-1),today,addDays(today,1)];
}
