import { api } from 'sdk';
import { DomainError } from '../lib/errors.js';
import { setup,bindChat,addEmployee,changeRate,setShiftBonus,createBonus,listEmployees,listLocations,makeReport,findProblems,formatReport,requireOwner,setLocationHours,createShiftTemplate,assignShift } from '../lib/service.js';
import { rubles } from '../lib/payroll.js';
import {captureWorkMessage,configureWorkChat,memoryStatus,prepareOwnerReview,decideFinding} from '../lib/ai-memory.js';
import {reportDate,reportMoment} from '../lib/report-format.js';
import {EMPLOYEE_HELP,parseEmployeeCommand} from '../lib/employee-command.js';
function money(input){
 if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(input||'')) throw new DomainError('BAD_MONEY','Сумма: 250 или 250.50');
 const [a,b='']=input.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));
}
function parse(message){
 const raw=(message.text||message.caption||'').trim();
 const match=/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(raw);
 return match ? {cmd:match[1].toLowerCase(),args:(match[2]||'').trim()} : null;
}
const HELP=['ServGo Смена — учёт рабочих смен через QR.','',
'Владелец, в личном чате:','/setup Название организации — создать организацию',
EMPLOYEE_HELP,
'/rate TG_ID 400 — изменить часовую ставку',
'/bonus TG_ID 1500 Причина — разовая надбавка на сегодня',
'/shiftbonus TG_ID 200 — автоматическая надбавка за закрытую смену',
'/team — сотрудники; /locations — рабочие точки',
'/hours ТОЧКА 09:00 18:00 [5] — устаревший график точки (если нет типов смен)',
'/shiftadd ТОЧКА Утренняя 09:00 15:00 [5] — создать тип смены',
'/shiftassign ID_сотрудника ID_смены YYYY-MM-DD — назначить сотрудника (ID из веб-кабинета)',
'/report — с начала месяца по вчера',
'/report 2026-09 — за месяц; /report 2026-10-01 2026-10-09 — даты включительно',
'/problems — незакрытые смены до сегодняшнего дня',
'/ai_status — статус наблюдения; /ai_review [7 или 14] — выводы на проверку',
'/ai_confirm ID, /ai_reject ID, /ai_correct ID уточнение — проверить вывод',
'В рабочей группе: /ai_on и /ai_off — включить и выключить наблюдение (владелец).','',
'В рабочей группе: /bind Название точки — владелец привязывает группу; /id — показать свой TG ID.',
'Приход/уход: QR → фронтальная камера → отправка фотографии ботом в рабочую группу. Для Mini App включите Main Mini App в @BotFather.','',
'Зарплатный отчёт — предварительный, не юридическая платёжная ведомость.'].join('\n');
async function reply(chatId,message) {
 const parts=[];let chunk='';
 for (const line of message.split('\n')) {
  if((chunk+'\n'+line).length>3700){if(chunk)parts.push(chunk);chunk='';}
  chunk+=(chunk?'\n':'')+line;
 }
 if(chunk)parts.push(chunk);
 for(const part of parts)await api.sendMessage({chat_id:chatId,text:part});
}
export default async function(message){
 if(!message?.from?.id||message.from.is_bot||!message.chat?.id) return;
 const cmd=parse(message),tgId=message.from.id,chat=message.chat.id,privateChat=message.chat.type==='private';
 if(!privateChat){
  try{await captureWorkMessage(message);}catch(e){console.error('AI message capture failed',e?.code||e?.name||'unknown');}
 }
 if(!cmd) return;
 try {
  if(cmd.cmd==='start'||cmd.cmd==='help'){await reply(chat,HELP);return;}
  if(cmd.cmd==='id'){await reply(chat,`Telegram ID: ${tgId}`);return;}
  if(cmd.cmd==='bind'){
   if(privateChat)throw new DomainError('GROUP_REQUIRED','Добавьте бота в рабочую группу и используйте /bind там');
   const me=await api.getChatMember({chat_id:chat,user_id:tgId});
   if(!['administrator','creator'].includes(me.status))throw new DomainError('GROUP_ADMIN_REQUIRED','Привязать группу может только её администратор');
   const loc=await bindChat(tgId,chat,cmd.args||message.chat.title||'Рабочая точка');
   await reply(chat,`✅ Точка «${loc.name}» привязана. ID: ${loc.id}. QR-устройство регистрируется владельцем в Mini App.`);return;
  }
  if(!privateChat){
   if(cmd.cmd==='ai_on'||cmd.cmd==='ai_off'){
    const me=await api.getChatMember({chat_id:chat,user_id:tgId});
    if(!['administrator','creator'].includes(me.status))throw new DomainError('GROUP_ADMIN_REQUIRED','Включить наблюдение может владелец, который является администратором группы');
    const result=await configureWorkChat(tgId,chat,cmd.cmd==='ai_on');
    await reply(chat,result.active?'✅ Наблюдение ИИ включено для «'+result.point+'». Система сохраняет новые доступные сообщения и реакции для проверки владельцем.':'✅ Наблюдение ИИ выключено для «'+result.point+'».');return;
   }
   if(['report','problems','team','locations','setup','employee','rate','bonus','shiftbonus','hours','shiftadd','shiftassign'].includes(cmd.cmd)){
    await reply(chat,'Для безопасности зарплатные сведения и настройки доступны только в личном чате с ботом.');
   }
   return;
  }
  if(cmd.cmd==='ai_status'){
   const s=await memoryStatus(tgId);await reply(chat,'Наблюдение ServGo\nАктивных групп: '+s.groups+'\nСобрано сообщений: '+s.messages+'\nВыводов ждут проверки: '+s.pending+'\nПервый обзор: /ai_review 14');return;
  }
  if(cmd.cmd==='ai_review'){
   const days=cmd.args?Number(cmd.args):14;
   const result=await prepareOwnerReview(tgId,days);
   const lines=['Проверка понимания бизнеса за '+result.days+' дней','Групп: '+result.groups+', сообщений в выборке: '+result.messages];
   if(!result.fullPeriod)lines.push('Наблюдение началось позднее начала периода; данных пока недостаточно для полного обзора.');
   if(result.limitReached)lines.push('⚠️ Достигнут лимит выборки 2000 сообщений: обзор неполный.');
   lines.push('Это темы для проверки, а не подтверждённые выводы ИИ.');
   for(const x of result.findings){
    lines.push('', '#'+x.id+' · '+x.title+' ['+x.status+']', x.correctedStatement||x.statement);
    for(const evidence of (x.evidence||[]).slice(0,3))lines.push('Источник: чат '+evidence.chatId+', сообщение '+evidence.messageId);
   }
   if(result.findings.length===0)lines.push('Пока недостаточно сообщений с распознаваемыми темами.');
   lines.push('', 'Подтвердить: /ai_confirm ID', 'Отклонить: /ai_reject ID','Исправить: /ai_correct ID правильная формулировка');
   await reply(chat,lines.join('\n'));return;
  }
  if(['ai_confirm','ai_reject','ai_correct'].includes(cmd.cmd)){
   const m=/^(\d+)(?:\s+([\s\S]+))?$/.exec(cmd.args);
   if(!m)throw new DomainError('BAD_REVIEW','Укажите ID вывода; для исправления добавьте новую формулировку');
   const action=cmd.cmd.slice(3),result=await decideFinding(tgId,Number(m[1]),action,m[2]||'');
   await reply(chat,'✅ Вывод #'+result.id+' получил статус: '+result.status);return;
  }
  if(cmd.cmd==='setup'){
   const org=await setup(tgId,cmd.args);await reply(chat,`✅ Организация «${org.name}» создана. Добавьте бота в рабочую группу и вызовите /bind.`);return;
  }
  if(cmd.cmd==='employee'){
   const input=parseEmployeeCommand(cmd.args);
   const e=await addEmployee(tgId,input.tgId,input.name,input.hourlyKopeks);
   await reply(chat,`✅ ${e.name} добавлен. Ставка: ${rubles(e.hourlyKopeks)}/час.`);return;
  }
  if(cmd.cmd==='rate'){
   const m=/^(\d+)\s+(\d+(?:[.,]\d{1,2})?)$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /rate 123456789 400');
   await changeRate(tgId,Number(m[1]),money(m[2]));await reply(chat,'✅ Ставка обновлена. Новая ставка применяется к сменам, начатым после изменения.');return;
  }
  if(cmd.cmd==='shiftbonus'){
   const m=/^(\d+)\s+(\d+(?:[.,]\d{1,2})?)$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /shiftbonus 123456789 200');
   await setShiftBonus(tgId,Number(m[1]),money(m[2]));await reply(chat,'✅ Автоматическая надбавка за будущую закрытую смену обновлена.');return;
  }
  if(cmd.cmd==='bonus'){
   const m=/^(\d+)\s+(\d+(?:[.,]\d{1,2})?)\s+(.+)$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /bonus 123456789 1500 Выполнение плана');
   await createBonus(tgId,Number(m[1]),money(m[2]),m[3]);await reply(chat,'✅ Разовая надбавка добавлена в текущую дату.');return;
  }
  if(cmd.cmd==='hours'){
   const m=/^(\d+)\s+([0-2]\d:[0-5]\d)\s+([0-2]\d:[0-5]\d)(?:\s+(\d{1,3}))?$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /hours 1 09:00 18:00 5');
   const data=await setLocationHours(tgId,Number(m[1]),m[2],m[3],m[4]===undefined?5:Number(m[4]));
   await reply(chat,`✅ Точка №${data.locationId}: график ${data.startTime}–${data.endTime}, допуск ${data.graceMinutes} мин. При уходе вне допуска сотрудник обязан написать причину. Изменения применяются к новым сменам.`);return;
  }
  if(cmd.cmd==='shiftadd'){
   const m=/^(\d+)\s+(.+?)\s+([0-2]\d:[0-5]\d)\s+([0-2]\d:[0-5]\d)(?:\s+(\d{1,3}))?$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /shiftadd 1 Утренняя 09:00 15:00 5');
   const t=await createShiftTemplate(tgId,Number(m[1]),m[2],m[3],m[4],m[5]===undefined?5:Number(m[5]));
   await reply(chat,`✅ Тип смены «${t.name}» создан (ID ${t.id}). Назначьте сотрудника командой /shiftassign.`);return;
  }
  if(cmd.cmd==='shiftassign'){
   const m=/^(\d+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})$/u.exec(cmd.args);
   if(!m)throw new DomainError('BAD_COMMAND','Пример: /shiftassign 2 1 2026-10-12 (внутренний ID сотрудника, ID смены, дата)');
   const a=await assignShift(tgId,Number(m[1]),Number(m[2]),m[3]);await reply(chat,`✅ Назначение #${a.id} на ${reportDate(a.workDate)} сохранено.`);return;
  }
  if(cmd.cmd==='team'){
   const team=await listEmployees(tgId);await reply(chat,team.length?team.map(x=>`${x.name}: ID ${x.id}, Telegram ${x.tgId}, ${rubles(x.hourlyKopeks)}/ч, за смену ${rubles(x.shiftBonusKopeks||0)}`).join('\n'):'Сотрудников пока нет.');return;
  }
  if(cmd.cmd==='locations'){
   const places=await listLocations(tgId);await reply(chat,places.length?places.map(x=>`${x.name}: точка №${x.id}, чат ${x.chatId}, график ${x.plannedStartTime&&x.plannedEndTime?x.plannedStartTime+'–'+x.plannedEndTime+', допуск '+x.closeGraceMinutes+' мин':'не задан'}`).join('\n'):'Рабочих точек пока нет.');return;
  }
  if(cmd.cmd==='report'){
   const args=cmd.args?cmd.args.split(/\s+/u):[];
   await reply(chat,formatReport(await makeReport(tgId,args)));return;
  }
  if(cmd.cmd==='problems'){
   const broken=await findProblems(tgId);
   await reply(chat,broken.length?`⚠️ Незакрытые смены до сегодняшнего дня:\n${broken.map(s=>`#${s.shiftId} ${s.name} (${reportMoment(s.startedAt,s.timezone)})`).join('\n')}`:'✅ Нет незакрытых смен за предыдущие дни.');return;
  }
  if(cmd.cmd==='open'||cmd.cmd==='close'||cmd.cmd==='in'||cmd.cmd==='out'){
   await reply(chat,'Для отметки необходимо отсканировать актуальный QR-код на рабочем устройстве и выбрать действие.');return;
  }
  await reply(chat,'Неизвестная команда. /help — список команд.');
 }catch(e){
  if(e instanceof DomainError)await reply(chat,`⚠️ ${e.message} [${e.code}]`);
  else {console.error('command failed',e);await reply(chat,'⚠️ Внутренняя ошибка. Данные не подтверждены. Повторите позже или обратитесь к владельцу.');}
 }
}
