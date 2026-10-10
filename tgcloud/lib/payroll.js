import { overlapSeconds } from './time.js';
import { requireInput } from './errors.js';
import { closingReview } from './schedule.js';
// Monetary values in integer kopeks. This is a PREVIEW, not statutory payroll or net pay.
export function computePreview({employees,shifts,bonuses=[],period}) {
  const entries=employees.map(emp=>{
    const finished=shifts.filter(s=>s.employeeId===emp.id && s.endedAt!==null);
    const incomplete=shifts.filter(s=>s.employeeId===emp.id && s.endedAt===null && s.startedAt*1000<period.endMs);
    let seconds=0,baseKopeks=0,automaticKopeks=0;
    for(const s of finished) {
      requireInput(s.endedAt>=s.startedAt,'CORRUPT_SHIFT','Ошибка времени смены');
      const worked=overlapSeconds(s.startedAt,s.endedAt,period.startMs,period.endMs);
      seconds+=worked;
      baseKopeks+=Math.round(worked*(s.hourlyKopeksSnapshot??emp.hourlyKopeks??0)/3600);
      if(s.endedAt*1000>=period.startMs && s.endedAt*1000<period.endMs) automaticKopeks+=(s.shiftBonusKopeksSnapshot||0);
    }
    const bonusKopeks=automaticKopeks+bonuses.filter(b=>b.employeeId===emp.id).reduce((n,b)=>n+b.amountKopeks,0);
    return {employeeId:emp.id,name:emp.name,seconds,hours:Number((seconds/3600).toFixed(2)),
      baseKopeks,bonusKopeks,grossKopeks:baseKopeks+bonusKopeks,unclosed:incomplete.length};
  });
  const exceptions=[];
 for(const s of shifts){
  if(s.endedAt==null||s.plannedEndAt==null||s.endedAt*1000<period.startMs||s.endedAt*1000>=period.endMs)continue;
  const review=closingReview(s.endedAt,s.plannedEndAt,s.closeGraceMinutes??5);
  if(review.required)exceptions.push({shiftId:s.id,employeeId:s.employeeId,name:employees.find(e=>e.id===s.employeeId)?.name||'Сотрудник',
    status:review.status,differenceMinutes:review.differenceMinutes,plannedEndAt:s.plannedEndAt,endedAt:s.endedAt,closeComment:s.closeComment||null});
 }
 exceptions.sort((a,b)=>a.endedAt-b.endedAt);
 const sum=field=>entries.reduce((total,e)=>total+e[field],0);
  return {period:{start:period.start,endExclusive:period.end,tz:period.tz},entries,exceptions,
    totals:{seconds:sum('seconds'),baseKopeks:sum('baseKopeks'),bonusKopeks:sum('bonusKopeks'),grossKopeks:sum('grossKopeks'),unclosed:sum('unclosed')}};
}
export function rubles(kopeks){return (kopeks/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';}
