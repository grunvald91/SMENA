import {addDays,parseISODate,formatDate} from './time.js';
import {rubles} from './payroll.js';
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export function reportDate(iso){
 parseISODate(iso);const [year,month,day]=iso.split('-');return `${Number(day)} ${months[Number(month)-1]} ${year}`;
}
export function reportMoment(seconds,timezone='Europe/Moscow'){
 const date=reportDate(formatDate(seconds*1000,timezone));
 const time=new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(seconds*1000));
 return `${date}, ${time}`;
}
export function reportRange(period){
 const last=addDays(period.endExclusive,-1);
 return period.start===last?reportDate(last):`${reportDate(period.start)} — ${reportDate(last)}`;
}
export function formatReport(r){
 const lines=['📊 Отчёт по сменам',reportRange(r.period),''];
 for(const e of r.entries){
  lines.push(`${e.name}: ${e.hours} ч · ${rubles(e.grossKopeks)}${e.bonusKopeks?' (надбавки '+rubles(e.bonusKopeks)+')':''}${e.salesKopeks?' (продажи '+rubles(e.salesKopeks)+')':''}${e.unclosed?' · ⚠️ незакрытых смен: '+e.unclosed:''}`);
 }
 if(r.exceptions?.length){
  lines.push('','Отклонения от графика:');
  for(const item of r.exceptions)lines.push(`${item.name}: ${item.status==='early'?'раньше':'позже'} на ${Math.abs(item.differenceMinutes)} мин; план ${reportMoment(item.plannedEndAt,r.period.tz)}, факт ${reportMoment(item.endedAt,r.period.tz)}. Причина: ${item.closeComment||'не указана'}`);
 }
 if(r.missingAssignments?.length){
  lines.push('','⚠️ Смены без отметки:');
  for(const a of r.missingAssignments)lines.push(`${reportDate(a.workDate)} · ${a.name} · ${a.templateName}`);
 }
 lines.push('',`Итого: ${rubles(r.totals.grossKopeks)}${r.totals.unclosed?' · ⚠️ незакрытых смен: '+r.totals.unclosed:''}`);
 return lines.join('\n');
}
