export function shiftPhotoCaption({action,employee,location,templateName,eventAt,timezone='Europe/Moscow',confirmed=false,shiftId,durationSeconds}){
 const time=new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(eventAt*1000));
 const lines=[`${confirmed?'✅':'⏳'} ServGo Смена · ${action==='in'?'Начало смены':'Окончание смены'}`,`${employee} · ${location}${templateName?' · '+templateName:''}`,`Время: ${time} (${timezone})`];
 if(confirmed){lines.push(`Отметка подтверждена · смена #${shiftId}`);
  if(action==='out'&&Number.isFinite(durationSeconds)){const minutes=Math.floor(durationSeconds/60);lines.push(`Отработано: ${Math.floor(minutes/60)} ч ${minutes%60} мин`);}
 }else lines.push('Фото получено; запись смены проверяется системой.');
 return lines.join('\n');
}
