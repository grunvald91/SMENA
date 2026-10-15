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

// Ongoing interval outranks an early arrival for a future shift.
function logicalCandidate(scannedAt,candidates){
 const ranked=candidates.map(c=>({...c,rank:scannedAt>=c.startAt&&scannedAt<c.endAt?0:scannedAt<c.startAt?1:2}))
  .filter(c=>c.rank===0 || (c.rank===1&&c.startAt-scannedAt<=3*3600) || (c.rank===2&&scannedAt-c.endAt<=3600))
  .sort((a,b)=>a.rank-b.rank||Math.abs(a.startAt-scannedAt)-Math.abs(b.startAt-scannedAt)||a.templateId-b.templateId);
 return ranked[0]||null;
}
export function chooseAssignment(scannedAt,timezone,assignments,templates,usedIds=[]){
 const byId=new Map(templates.map(t=>[t.id,t]));
 const candidates=assignments.filter(a=>byId.has(a.templateId)&&!usedIds.includes(a.id)).map(a=>{
  const current=byId.get(a.templateId),t=a.planSnapshot?.template||current,w=a.planSnapshot?.window||templateWindow(a.workDate,t,timezone);
  return {...w,assignmentId:a.id,templateId:t.id,templateName:t.name,graceMinutes:t.graceMinutes??5,workDate:a.workDate};
 });
 return logicalCandidate(scannedAt,candidates);
}
export function chooseAutomatic(scannedAt,timezone,templates,usedKeys=[]){
 const candidates=daysAround(scannedAt,timezone).flatMap(workDate=>templates.map(t=>{
  const w=templateWindow(workDate,t,timezone),key=`${t.id}:${workDate}`;
  return {...w,assignmentId:null,templateId:t.id,templateName:t.name,graceMinutes:t.graceMinutes??5,workDate,key};
 })).filter(c=>!usedKeys.includes(c.key));
 return logicalCandidate(scannedAt,candidates);
}
export function daysAround(seconds,timezone){
 const today=formatDate(seconds*1000,timezone);
 return [addDays(today,-1),today,addDays(today,1)];
}
