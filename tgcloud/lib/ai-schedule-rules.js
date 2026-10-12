// Pure clock and threshold policy. Russia/Moscow stays UTC+03:00; using
// Intl.DateTimeFormat avoids relying on the Serverless host's timezone.
export const MOSCOW_TIMEZONE='Europe/Moscow';
export const NIGHTLY_HOUR_MSK=3;
export const DEEP_MESSAGE_THRESHOLD=30;
export function moscowClock(atMs){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:MOSCOW_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(atMs));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)};
}
export function deepAnalysisDecision({pendingMessages=0,pendingChanges=0,nowMs=Date.now(),
 lastNightlyDate=null,nightlyHour=NIGHTLY_HOUR_MSK,threshold=DEEP_MESSAGE_THRESHOLD}={}){
 const current=moscowClock(nowMs);
 const pending=pendingMessages+pendingChanges;
 const nightlyWindow=current.hour>=nightlyHour&&lastNightlyDate!==current.date;
 const reachedThreshold=pending>=threshold;
 return {trigger:pending>0&&(reachedThreshold||nightlyWindow),nightlyWindow,
  reachedThreshold,moscowDate:current.date,reason:pending===0?'empty':
   reachedThreshold?'threshold':nightlyWindow?'nightly':'waiting'};
}
