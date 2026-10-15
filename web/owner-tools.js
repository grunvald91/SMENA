import {formatDate,zonedParts,startOfLocalDay} from '../tgcloud/lib/time.js';
export function createOwnerTools({e,call,msg,refresh,confirmAction}){
 const operationId=()=>crypto.randomUUID().replaceAll('-','');
 const field=(label,type='text',value='')=>{const input=e('input',{type,value});return {input,el:e('label',{className:'field'},label,input)};};
 const select=(label,items)=>{const input=e('select',{},...items.map(p=>e('option',{value:p.id},p.name)));return {input,el:e('label',{className:'field'},label,input)};};
 const localTime=(sec,tz)=>{const p=zonedParts(sec*1000,tz);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;};
 const parseTime=(value,tz)=>{const [date,t]=value.split('T');if(!date||!t)throw Error('Выберите дату и время');const [h,m]=t.split(':').map(Number);let sec=startOfLocalDay(date,tz)/1000+h*3600+m*60;for(let i=0;i<4;i++){const p=zonedParts(sec*1000,tz);const wanted=Date.parse(value+'Z')/1000;sec+=wanted-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)/1000;}if(localTime(sec,tz)!==value)throw Error('Время не существует в часовом поясе бизнеса');return sec;};
 function form(items,label,run){const button=e('button',{type:'submit'},label),el=e('form',{className:'form-grid'},...items,button);el.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;try{await run();}catch(x){msg(x.message,true);}finally{button.disabled=false;}});return el;}
 function modes(d){return e('section',{className:'panel'},e('h3',{},'Как выбирать смену'),...d.locations.map(loc=>{
  const mode=select(loc.name,[{id:'automatic',name:'Автоматически по времени'},{id:'assigned',name:'По назначениям владельца'}]);mode.input.value=loc.shiftMode;
  return form([mode.el,e('p',{className:'muted'},'Автоматически: текущая смена, затем ближайшая. Без типов смен — фактический приход и уход. Назначения: сотрудник отмечает смену из графика владельца.')],'Сохранить режим',async()=>{await call('ownerShiftMode',{locationId:loc.id,mode:mode.input.value});await refresh();msg('Режим сохранён');});
 }));}
 function corrections(d){const box=e('section',{className:'panel'},e('h3',{},'Исправить табель'));
  const person=select('Смена',d.shifts.toSorted((a,b)=>b.startedAt-a.startedAt).map(s=>({id:s.id,name:`${d.employees.find(p=>p.id===s.employeeId)?.name||'Сотрудник'} · ${localTime(s.startedAt,d.organization.timezone).replace('T',' ')}${s.endedAt?'':' · не закрыта'}`})));
  if(!d.shifts.length){box.append(e('p',{},'Отметок пока нет.'));return box;}
  const start=field('Приход','datetime-local'),end=field('Уход','datetime-local'),reason=field('Причина исправления');let id=operationId();
  const fill=()=>{const s=d.shifts.find(s=>s.id===Number(person.input.value));start.input.value=localTime(s.startedAt,d.organization.timezone);end.input.value=localTime(s.endedAt||Math.floor(Date.now()/1000),d.organization.timezone);id=operationId();};person.input.addEventListener('change',fill);fill();
  box.append(form([person.el,start.el,end.el,reason.el],'Подтвердить исправление',async()=>{
   const s=d.shifts.find(s=>s.id===Number(person.input.value));
   const input={action:'correct',requestId:id,shiftId:s.id,baseVersion:s.correction?.version||0,startedAt:parseTime(start.input.value,d.organization.timezone),endedAt:parseTime(end.input.value,d.organization.timezone),reason:reason.input.value,confirmed:true};
   if(!await confirmAction('Изменить табель и пересчитать начисления? Причина будет сохранена.'))return;
   await call('ownerOperations',input);await refresh();msg('Исправление сохранено');
  }));return box;
 }

 function missing(d){const box=e('section',{className:'panel'},e('h3',{},'Пропущенные отметки'));
  if(!d.preview.missingAssignments.length)box.append(e('p',{},'Нет неразобранных пропусков.'));
  for(const a of d.preview.missingAssignments){const p=d.employees.find(p=>p.id===a.employeeId),card=e('section',{className:'control-card'},e('p',{},`${a.name} · ${a.workDate} · ${a.templateName}`));
   const decision=select('Решение',[{id:'worked',name:'Работал: восстановить время'},{id:'absent',name:'Неявка: без начисления'}]);
   const start=field('Фактический приход','datetime-local',localTime(a.plannedStartAt,d.organization.timezone)),end=field('Фактический уход','datetime-local',localTime(a.plannedEndAt,d.organization.timezone)),rate=field('Подтвердите ставку, ₽/час','number',(p.hourlyKopeks/100).toFixed(2)),bonus=field('Подтвердите надбавку за смену, ₽','number',(p.shiftBonusKopeks/100).toFixed(2)),reason=field('Причина / основание решения');rate.input.step=bonus.input.step='0.01';const id=operationId();
   card.append(form([decision.el,start.el,end.el,rate.el,bonus.el,reason.el],'Подтвердить решение',async()=>{const worked=decision.input.value==='worked';const input={action:'resolveMissing',assignmentId:a.assignmentId,requestId:id,decision:decision.input.value,reason:reason.input.value,confirmed:true,...(worked?{startedAt:parseTime(start.input.value,d.organization.timezone),endedAt:parseTime(end.input.value,d.organization.timezone),hourlyKopeks:Math.round(Number(rate.input.value)*100),shiftBonusKopeks:Math.round(Number(bonus.input.value)*100)}:{})};if(!await confirmAction(worked?'Сохранить подтверждённое владельцем время и начисления без фотоотметки?':'Зафиксировать неявку без начисления?'))return;await call('ownerOperations',input);await refresh();msg('Решение сохранено');}));box.append(card);
  }return box;
 }
 function recovery(d){const box=e('section',{className:'panel'},e('h3',{},'Отметки, требующие восстановления'));
  if(!d.pendingPhotos.length)box.append(e('p',{},'Нет незавершённых отправок.'));
  for(const i of d.pendingPhotos){const card=e('section',{className:'control-card'},e('p',{},`${d.employees.find(p=>p.id===i.employeeId)?.name||'Сотрудник'} · ${i.action==='in'?'приход':'уход'} · ${localTime(i.at,d.organization.timezone).replace('T',' ')}`));
   if(i.status==='sent')card.append(e('button',{onclick:async()=>{try{await call('ownerOperations',{action:'resumeAttendance',intentId:i.id});await refresh();msg('Отметка восстановлена');}catch(x){msg(x.message,true);}}},'Восстановить сохранённую отметку'));
   else{const decision=select('Доставка',[{id:'missing',name:'Фото в группе отсутствует'},{id:'received',name:'Фото получено в группе'}]),message=field('Номер сообщения с фото (если получено)','number'),reason=field('Основание решения');
    card.append(form([decision.el,message.el,reason.el,e('p',{className:'muted'},'Доступно через 5 минут после начала отправки. Номер сообщения — последнее число в ссылке на сообщение Telegram.')],'Подтвердить после проверки группы',async()=>{if(!await confirmAction('Подтвердить результат сверки с рабочей группой?'))return;await call('ownerOperations',{action:'resolveAttendance',intentId:i.id,decision:decision.input.value,messageId:Number(message.input.value),reason:reason.input.value,confirmed:true});await refresh();msg(decision.input.value==='received'?'Отметка подтверждена':'Отправка отменена. Сотрудник может сканировать новый QR.');}));}
   box.append(card);
  }return box;
 }
 function team(d){const box=e('section',{className:'panel'},e('h3',{},'Доступ сотрудников'));
  d.employees.forEach(p=>box.append(e('div',{className:'control-card'},e('p',{},`${p.name} · ${p.active?'активен':'доступ закрыт'}`),e('button',{className:'outline',onclick:async()=>{try{if(!await confirmAction(`${p.active?'Закрыть':'Восстановить'} доступ ${p.name}? История сохраняется.`))return;await call('ownerOperations',{action:'active',employeeId:p.id,active:!p.active,confirmed:true});await refresh();}catch(x){msg(x.message,true);}}},p.active?'Закрыть доступ':'Восстановить доступ'))));return box;
 }
 function bulk(d){const box=e('section',{className:'panel'},e('h3',{},'Назначить смены на несколько дней'));
  if(!d.templates.some(t=>t.active)||!d.employees.some(p=>p.active)){box.append(e('p',{},'Сначала добавьте активных сотрудников и типы смен.'));return box;}
  const t=select('Тип смены',d.templates.filter(t=>t.active).map(t=>({id:t.id,name:t.name}))),start=field('С','date',formatDate(Date.now(),d.organization.timezone)),end=field('По','date',formatDate(Date.now(),d.organization.timezone));
  const picks=d.employees.filter(p=>p.active).map(p=>({id:p.id,input:e('input',{type:'checkbox'}),name:p.name}));
  box.append(form([t.el,start.el,end.el,...picks.map(p=>e('label',{className:'field'},p.input,p.name))],'Назначить выбранным',async()=>{if(!await confirmAction('Назначить смены на все выбранные дни? Существующие назначения сохранятся.'))return;const r=await call('ownerOperations',{action:'assignRange',templateId:Number(t.input.value),employeeIds:picks.filter(p=>p.input.checked).map(p=>p.id),start:start.input.value,end:end.input.value,confirmed:true});await refresh();msg(`Добавлено: ${r.created}. Уже были: ${r.existing}. Пересечения: ${r.conflicts.length}.`);}));return box;
 }
 async function sales(d){const data=await call('ownerOperations',{action:'salesContext'}),box=e('section',{className:'panel'},e('h2',{},'Процент от личных продаж'));
  if(!d.employees.length){box.append(e('p',{},'Сначала добавьте сотрудников.'));return box;}
  const person=select('Сотрудник',d.employees),rate=field('Процент, %','number','0');rate.input.step='0.01';
  const fill=()=>{rate.input.value=String((data.rules.find(r=>r.employeeId===Number(person.input.value))?.rateBasisPoints||0)/100);};person.input.addEventListener('change',fill);fill();
  box.append(form([person.el,rate.el],'Сохранить процент',async()=>{if(!await confirmAction('Изменить процент для новых подтверждённых продаж?'))return;await call('ownerOperations',{action:'salesRule',employeeId:Number(person.input.value),rateBasisPoints:Math.round(Number(rate.input.value)*100),confirmed:true});await refresh();msg('Процент сохранён');}));
  const p=select('Сотрудник для продажи',d.employees),date=field('Дата','date',formatDate(Date.now(),d.organization.timezone)),amount=field('Подтверждённые личные продажи, ₽','number'),reason=field('Основание: чек, отчёт или пояснение');amount.input.step='0.01';let id=operationId();
  box.append(form([p.el,date.el,amount.el,reason.el],'Подтвердить продажи',async()=>{if(!await confirmAction('Подтвердить сумму личных продаж и начислить процент?'))return;await call('ownerOperations',{action:'sale',requestId:id,employeeId:Number(p.input.value),date:date.input.value,amountKopeks:Math.round(Number(amount.input.value)*100),reason:reason.input.value,confirmed:true});id=operationId();await refresh();msg('Продажа и комиссия сохранены');}));
  for(const entry of data.entries){const card=e('div',{className:'control-card'},e('p',{},`${d.employees.find(p=>p.id===entry.employeeId)?.name} · ${entry.date} · ${(entry.amountKopeks/100).toFixed(2)} ₽ · комиссия ${(entry.commissionKopeks/100).toFixed(2)} ₽`),e('p',{className:'muted'},entry.reason));
   if(entry.amountKopeks>0&&!data.entries.some(r=>r.refundOf===entry.id)){let refundId=operationId();const why=field('Причина полного возврата');card.append(form([why.el],'Подтвердить полный возврат',async()=>{if(!await confirmAction('Отменить продажу и соответствующую комиссию?'))return;await call('ownerOperations',{action:'sale',requestId:refundId,employeeId:entry.employeeId,date:formatDate(Date.now(),d.organization.timezone),amountKopeks:-entry.amountKopeks,refundOf:entry.id,reason:why.input.value,confirmed:true});await refresh();msg('Возврат сохранён');}));}box.append(card);
  }return box;
 }
 function extra(d){const box=e('section',{className:'panel'},e('h3',{},'Разовое добавление к оплате'));
  if(!d.employees.length){box.append(e('p',{},'Сначала добавьте сотрудников.'));return box;}
  const person=select('Сотрудник',d.employees),amount=field('Сумма, ₽','number'),reason=field('Основание добавления');amount.input.step='0.01';let id=operationId();
  box.append(form([person.el,amount.el,reason.el],'Подтвердить добавление',async()=>{if(!await confirmAction('Добавить сумму в расчёт за сегодня?'))return;const p=d.employees.find(p=>p.id===Number(person.input.value));await call('ownerOperations',{action:'bonus',requestId:id,tgId:p.tgId,amountKopeks:Math.round(Number(amount.input.value)*100),reason:reason.input.value,confirmed:true});id=operationId();await refresh();msg('Добавление сохранено');}));return box;
 }
 function approve(d,month){const box=e('section',{className:'panel'},e('h3',{},'Подтверждение расчёта')),current=d.approvals.find(a=>a.current),id=operationId();
  box.append(e('p',{},current?'Этот расчёт подтверждён владельцем.':d.approvals.length?'Данные изменились после подтверждения. Проверьте новый расчёт.':'Предварительный расчёт. Проверьте часы, надбавки и продажи.'));
  if(!current)box.append(e('button',{onclick:async()=>{try{if(!await confirmAction('Подтвердить проверенный табель и начисления за выбранный месяц?'))return;await call('ownerOperations',{action:'approvePayroll',requestId:id,month,expected:JSON.stringify(d.preview),confirmed:true});await refresh();msg('Снимок расчёта подтверждён');}catch(x){msg(x.message,true);}}},'Подтвердить расчёт'));
  return box;
 }
 return {modes,corrections,missing,recovery,team,bulk,sales,extra,approve};
}
