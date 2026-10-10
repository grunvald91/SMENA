export function shiftPhotoCaption({action,employee,location,eventAt,timezone='Europe/Moscow',confirmed=false,durationSeconds}){
 const time=new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(eventAt*1000));
 const zone=new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,timeZoneName:'shortOffset'}).formatToParts(new Date(eventAt*1000)).find(x=>x.type==='timeZoneName')?.value||timezone;
 const lines=[`${confirmed?'✅':'⏳'} ${action==='in'?'Приход':'Уход'}`,employee,location,`${time} (${zone})`];
 if(confirmed){
  if(action==='out'&&Number.isFinite(durationSeconds)){const minutes=Math.floor(durationSeconds/60);lines.push(`Отработано: ${Math.floor(minutes/60)} ч ${minutes%60} мин`);}
 }else lines.push('Отметка ещё не подтверждена');
 return lines.join('\n');
}
