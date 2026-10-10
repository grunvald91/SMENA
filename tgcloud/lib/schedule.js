import { requireInput } from './errors.js';
import { addDays, formatDate, zonedParts } from './time.js';

const TIME_PATTERN=/^([01]\d|2[0-3]):([0-5]\d)$/;
export function minuteOfDay(value){
  requireInput(typeof value==='string' && TIME_PATTERN.test(value),'BAD_HOURS','Время в формате ЧЧ:ММ');
  const [h,m]=value.split(':').map(Number);
  return h*60+m;
}
export function validateGrace(value){
  requireInput(Number.isSafeInteger(value)&&value>=0&&value<=180,'BAD_GRACE','Допуск должен быть от 0 до 180 минут');
  return value;
}
function utcAtLocalTime(date, minutes, timezone){
  const d=new Date(`${date}T00:00:00Z`);
  const guess=d.getTime()+minutes*60000;
  let actual=guess;
  for(let i=0;i<6;i++){
    const p=zonedParts(actual,timezone);
    const asUTC=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const next=actual-(asUTC-guess);
    if(next===actual)break;
    actual=next;
  }
  const p=zonedParts(actual,timezone);
  requireInput(formatDate(actual,timezone)===date && p.hour*60+p.minute===minutes,'BAD_LOCAL_TIME','Время отсутствует в выбранном часовом поясе');
  return Math.floor(actual/1000);
}
/** Snapshot the expected shift ending; choose the nearest planned start for overnight arrivals. */
export function plannedEndForStart(startedAt, location, timezone){
  if(!location?.plannedStartTime || !location?.plannedEndTime)return null;
  const startMinute=minuteOfDay(location.plannedStartTime);
  const endMinute=minuteOfDay(location.plannedEndTime);
  requireInput(startMinute!==endMinute,'BAD_HOURS','Время начала и конца должно различаться');
  const localDate=formatDate(startedAt*1000,timezone);
  const candidates=[-1,0,1].map(offset=>{
    const day=addDays(localDate,offset);
    return {day,start:utcAtLocalTime(day,startMinute,timezone)};
  });
  candidates.sort((a,b)=>Math.abs(a.start-startedAt)-Math.abs(b.start-startedAt));
  const day=candidates[0].day;
  return utcAtLocalTime(addDays(day,endMinute<=startMinute?1:0),endMinute,timezone);
}
/** Compute from the QR scan time, not the eventual Telegram photo upload time. */
export function closingReview(actualAt,plannedEndAt,graceMinutes=5){
  if(plannedEndAt==null)return {status:'no_schedule',required:false,plannedEndAt:null,differenceMinutes:null,graceMinutes:null};
  validateGrace(graceMinutes);
  const differenceSeconds=actualAt-plannedEndAt;
  const required=Math.abs(differenceSeconds)>graceMinutes*60;
  return {status:!required?'on_time':differenceSeconds<0?'early':'late',required,
    plannedEndAt,differenceMinutes:Math.round(differenceSeconds/60),graceMinutes};
}
export function validateCloseComment(comment, review){
  const note=typeof comment==='string'?comment.trim():'';
  requireInput(note.length<=500,'BAD_CLOSE_COMMENT','Комментарий не должен превышать 500 символов');
  requireInput(!review?.required || note.length>=5,'CLOSE_COMMENT_REQUIRED','При раннем или позднем уходе объясните причину (от 5 до 500 символов)');
  return note||null;
}
