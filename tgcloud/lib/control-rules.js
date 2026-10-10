import {requireInput} from './errors.js';
import {startOfLocalDay,zonedParts} from './time.js';
import {decodeSelfie} from './photo.js';
export const MAX_CONTROL_PHOTOS=10;
export function controlDeadline(value,timezone,now){
 requireInput(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),'BAD_DEADLINE','Укажите дату и время срока');
 const [date,time]=value.split('T'),[h,m]=time.split(':').map(Number);
 requireInput(h<24&&m<60,'BAD_DEADLINE','Некорректное время');
 // Iterative offset conversion, then round-trip: nonexistent local DST times fail closed.
 const desired=new Date(value+'Z').getTime();let ms=startOfLocalDay(date,timezone)+h*3600000+m*60000;
 for(let i=0;i<4;i++){const p=zonedParts(ms,timezone);const actual=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);ms+=desired-actual;}
 const p=zonedParts(ms,timezone);
 requireInput(`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`===value,'BAD_DEADLINE','Это время не существует в часовом поясе организации');
 const seconds=Math.floor(ms/1000);
 requireInput(seconds>now&&seconds<=now+31*86400,'BAD_DEADLINE','Срок должен быть в будущем, не дальше 31 дня');return seconds;
}
export function controlPhotos(photos){
 requireInput(Array.isArray(photos)&&photos.length>=1&&photos.length<=MAX_CONTROL_PHOTOS,'BAD_PHOTOS','Сделайте от 1 до 10 фотографий');
 const bytes=photos.map(decodeSelfie);
 requireInput(bytes.reduce((n,p)=>n+p.length,0)<=1000000,'BAD_PHOTOS','Серия слишком большая — уменьшите количество фотографий');return bytes;
}
export function controlStatus(request,submission,now){
 if(submission?.status==='done')return submission.completedAt>request.deadlineAt?'Получено с опозданием':'Получено вовремя';
 if(submission?.status==='uploading'||submission?.status==='uncertain')return 'Проверьте доставку в группе';
 return now>request.deadlineAt?'Просрочено — ожидается ответ':'Ожидается ответ';
}
export function controlTime(seconds,timezone){return new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(new Date(seconds*1000));}
export function controlCaption({request,employee,location,timezone,at,comment}){
 return [`📷 Фотоконтроль`,employee,location,`Отправлено: ${controlTime(at,timezone)}`,`Срок: ${controlTime(request.deadlineAt,timezone)}${at>request.deadlineAt?' · С опозданием':''}`,`Задание: ${request.instruction.length>120?request.instruction.slice(0,117)+'…':request.instruction}`,comment?`Комментарий: ${comment}`:null].filter(Boolean).join('\n');
}
