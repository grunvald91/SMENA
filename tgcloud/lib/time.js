import { DomainError, requireInput } from './errors.js';
const formatterCache = new Map();
function fmt(tz) {
  if (!formatterCache.has(tz)) formatterCache.set(tz, new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }));
  return formatterCache.get(tz);
}
export function zonedParts(ms,tz) {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return {year:parts.year, month:parts.month, day:parts.day, hour:parts.hour, minute:parts.minute, second:parts.second};
}
export function formatDate(ms,tz) {
  const p=zonedParts(ms,tz);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
export function parseISODate(s) {
  requireInput(/^\d{4}-\d{2}-\d{2}$/.test(s||''),'BAD_DATE','Дата должна быть YYYY-MM-DD');
  const d = new Date(`${s}T00:00:00Z`);
  requireInput(!Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===s,'BAD_DATE','Некорректная дата');
  return d;
}
export function addDays(s,n) {
  const d=parseISODate(s); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);
}
export function startOfLocalDay(s,tz) {
  const d=parseISODate(s);
  const guess=d.getTime();
  let target=guess;
  for (let i=0;i<4;i++) {
    const p=zonedParts(target,tz);
    const localAsUTC=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const correction=localAsUTC-guess;
    const next=target-correction;
    if (next===target) break;
    target=next;
  }
  requireInput(formatDate(target,tz)===s,'BAD_TIMEZONE','Не удалось вычислить начало суток');
  return target;
}
export function reportPeriod(args=[],nowMs=Date.now(),tz='Europe/Moscow') {
  const today=formatDate(nowMs,tz);
  let start, end;
  if (args.length===0) { start=today.slice(0,7)+'-01'; end=addDays(today,1); }
  else if(args.length===1 && /^\d{4}-\d{2}$/.test(args[0])) {
    start=args[0]+'-01'; parseISODate(start);
    const [y,m]=args[0].split('-').map(Number);
    const monthAfter=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
    end=monthAfter;
  } else if(args.length===2){start=args[0];parseISODate(start);parseISODate(args[1]);end=addDays(args[1],1);}
  else throw new DomainError('BAD_PERIOD','Используйте /report, /report YYYY-MM или /report YYYY-MM-DD YYYY-MM-DD');
  requireInput(start<end,'BAD_PERIOD','Начало периода должно быть раньше конца');
  requireInput(start<=today,'FUTURE_PERIOD','Нельзя рассчитывать будущий период');
  return {start,end,startMs:startOfLocalDay(start,tz),endMs:startOfLocalDay(end,tz),tz};
}
export function ceilToSecond(ms) {return Math.floor(ms/1000);}
export function overlapSeconds(fromSec,toSec,windowStartMs,windowEndMs) {
  const start=Math.max(fromSec*1000,windowStartMs), end=Math.min(toSec*1000,windowEndMs);
  return Math.max(0,Math.floor((end-start)/1000));
}
