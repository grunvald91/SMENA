import QRCode from 'qrcode';
import './style.css';
import {isShiftToken} from '../tgcloud/lib/kiosk-token.js';
const T=window.Telegram?.WebApp;
const root=document.getElementById('root');
const state={context:null,device:null,displayTimer:null,issuing:false};
function element(tag,props={},...children){
 const el=document.createElement(tag);
 for(const [k,v] of Object.entries(props)){
  if(k==='className')el.className=v;
  else if(k==='onclick')el.addEventListener('click',v);
  else if(k==='value')el.value=v;
  else if(k==='disabled')el.disabled=!!v;
  else el.setAttribute(k,v);
 }
 for(const child of children){if(child!=null)el.append(child instanceof Node?child:document.createTextNode(String(child)));}
 return el;
}
function render(...children){root.replaceChildren(...children);}
function msg(s,bad=false){const p=element('p',{className:bad?'error':'notice'},s);root.prepend(p);setTimeout(()=>p.remove(),6000);}
function call(name,input={}) {return new Promise((resolve,reject)=>{
 if(!T?.Serverless?.call)return reject(new Error('Откройте Mini App внутри Telegram.'));
 T.Serverless.call(name,input,(err,result)=>err?reject(new Error(err.message||'Ошибка сервера')):resolve(result));
});}
const base64url=arr=>btoa(String.fromCharCode(...arr)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function openDb(){return new Promise((resolve,reject)=>{
 const r=indexedDB.open('servgo-shifts-kiosk',1);
 r.onupgradeneeded=()=>r.result.createObjectStore('keys');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});}
async function putKey(key){const db=await openDb();return new Promise((resolve,reject)=>{
 const tx=db.transaction('keys','readwrite');tx.objectStore('keys').put(key,'private');
 tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
});}
async function getKey(){const db=await openDb();return new Promise((resolve,reject)=>{
 const tx=db.transaction('keys','readonly');const r=tx.objectStore('keys').get('private');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});}
async function enroll(locationId){
 if(!crypto?.subtle||!indexedDB)throw new Error('Устройство не поддерживает безопасное хранение ключа');
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const publicJwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
 const result=await call('enrollDevice',{locationId,publicJwk});
 await putKey(keys.privateKey);
 state.device={id:result.id,locationId};localStorage.setItem('servgo-kiosk-device',JSON.stringify(state.device));
 msg('Устройство зарегистрировано. Повторная регистрация на другой технике без отзыва невозможна.');
 await displayKiosk();
}
async function issue(){
 const challenge=await call('deviceChallenge',{deviceId:state.device.id});
 const key=await getKey();if(!key)throw new Error('Ключ устройства не найден. Нужна регистрация заново у владельца.');
 const signed=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(challenge.message));
 return await call('issueQr',{deviceId:state.device.id,challengeId:challenge.id,signature:base64url(new Uint8Array(signed))});
}
async function revokeCurrentDevice(){
 if(!confirm('Отозвать рабочее устройство? После этого QR перестанет работать.'))return;
 const challenge=await call('deviceChallenge',{deviceId:state.device.id});
 const key=await getKey();if(!key)throw new Error('Нет приватного ключа этого устройства');
 const signed=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(challenge.message));
 await call('revokeDevice',{deviceId:state.device.id,challengeId:challenge.id,signature:base64url(new Uint8Array(signed))});
 const db=await openDb();await new Promise((resolve,reject)=>{const tx=db.transaction('keys','readwrite');tx.objectStore('keys').delete('private');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 state.device=null;localStorage.removeItem('servgo-kiosk-device');renderHome();msg('Устройство отозвано. Теперь можно зарегистрировать замену.');
}
async function displayKiosk(){
 if(state.displayTimer)clearTimeout(state.displayTimer);
 const heading=element('h2',{},'QR рабочего места');const canvas=element('canvas',{id:'qr'});
 const time=element('p',{className:'muted'},'Запрос нового кода…');
 const container=element('section',{className:'panel'},heading,canvas,time,
   element('p',{className:'muted'},'QR обновляется каждые 30 секунд. Этот экран должен оставаться на зарегистрированном устройстве.'),
   element('button',{className:'outline',onclick:()=>{state.device=null;localStorage.removeItem('servgo-kiosk-device');renderHome();}},'Закрыть экран'),
   element('button',{className:'outline',onclick:()=>revokeCurrentDevice().catch(e=>msg(e.message,true))},'Отвязать устройство (с ключом)'));
 render(container);let run=true;
 async function tick(){
  if(!container.isConnected||!state.device)return;
  try{
   const value=await issue();
   if(!state.context.botUsername)throw new Error('У бота отсутствует username');
   const url=`https://t.me/${state.context.botUsername}?startapp=scan_${value.token}`;
   await QRCode.toCanvas(canvas,url,{width:256,margin:2,errorCorrectionLevel:'M'});
   time.textContent='Код действителен 30 секунд. Не фотографируйте и не пересылайте его.';
   state.displayTimer=setTimeout(tick,27000);
  }catch(e){time.textContent=`Ошибка QR: ${e.message}`;state.displayTimer=setTimeout(tick,10000);}
 }
 await tick();
}
async function showScan(token){
 if(!isShiftToken(token))throw new Error('Некорректная ссылка QR');
 const main=element('section',{className:'panel'},element('h2',{},'Отметка смены'),
  element('p',{},'QR действителен 30 секунд. Сначала выберите действие, затем сделайте живое селфи на фронтальную камеру. Загрузка из галереи не предусмотрена.'));
 for(const [label,action] of [['Я пришёл на работу','in'],['Я ухожу с работы','out']]){
  main.append(element('button',{onclick:async()=>{
   try{const intent=await call('beginPhotoShift',{token,action});await showCamera(intent);}
   catch(e){msg(e.message,true);}
  }},label));
 }
 render(main);
}
async function showCamera(intent){
 const panel=element('section',{className:'panel'},element('h2',{},'Селфи для отметки'),
  element('p',{},`${intent.employee} · ${intent.location}${intent.templateName?' · '+intent.templateName:''}. Сделайте фотографию в форме, чтобы она попала в рабочую группу.`));
 let reason=null;
 if(intent.action==='out'){
  const review=intent.closeReview;
  if(review?.required){
   const minutes=Math.abs(review.differenceMinutes);
   panel.append(element('p',{className:'error'},`Окончание смены ${review.status==='early'?'раньше':'позже'} графика примерно на ${minutes} мин. Укажите причину до отправки фото.`));
  }
  reason=element('textarea',{placeholder:review?.required?'Причина раннего или позднего ухода (обязательно)':'Комментарий к закрытию (необязательно)',maxlength:500,rows:3});
  panel.append(reason);
 }
 const video=element('video',{autoplay:'',playsinline:'',muted:'',className:'selfie-video'});
 video.muted=true;video.setAttribute('playsinline','');
 const take=element('button',{disabled:true},'Сфотографировать');
 const result=element('p',{className:'muted'},'Запрашиваем доступ к камере…');
 panel.append(video,take,result);render(panel);
 if(!navigator.mediaDevices?.getUserMedia){result.textContent='Камера недоступна внутри этого клиента Telegram. Для этой отметки используйте совместимый телефон.';return;}
 let stream;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:960},height:{ideal:1280}}});
  video.srcObject=stream;await video.play();take.disabled=false;result.textContent='Камера готова. Снимите селфи.';
 }catch(e){result.textContent='Не удалось открыть камеру: '+(e.name==='NotAllowedError'?'разрешите доступ к камере в настройках Telegram.':e.message);return;}
 let captured=null;
 function stop(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
 const end=()=>{stop();};
 window.addEventListener('pagehide',end,{once:true});
 take.addEventListener('click',async()=>{
  if(captured)return;
  if(intent.closeReview?.required && (!reason || reason.value.trim().length<5)){result.textContent='Укажите причину отклонения от графика (не менее 5 символов).';return;}
  if(video.videoWidth<1||video.videoHeight<1){result.textContent='Видеопоток не готов. Повторите.';return;}
  const canvas=document.createElement('canvas');
  const ratio=Math.min(1,900/video.videoWidth,900/video.videoHeight);
  canvas.width=Math.max(1,Math.floor(video.videoWidth*ratio));canvas.height=Math.max(1,Math.floor(video.videoHeight*ratio));
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  // Captures a frame from a camera stream; never asks the employee to upload a file.
  captured=canvas.toDataURL('image/jpeg',0.75).split(',')[1];
  stop();video.replaceWith(element('img',{src:canvas.toDataURL('image/jpeg',0.75),className:'selfie-video',alt:'Только что сделанное фото'}));
  take.textContent='Отправить фото и отметить смену';
  const send=async()=>{
   submit.disabled=true;result.textContent='Отправляем фотографию в Telegram и проверяем отметку…';
   try{
    const r=await call('completePhotoShift',{intentId:intent.intentId,selfieBase64:captured,closeComment:reason?.value||''});
    render(element('section',{className:'panel'},element('h2',{},'✅ Отметка зарегистрирована'),
     element('p',{},`${intent.employee}: ${r.action==='in'?'начало':'окончание'} смены #${r.shiftId}`),
     element('p',{},r.notificationDelivered?'Фото и время отметки подтверждены в рабочей группе.':'Смена сохранена и фото отправлено, но подпись сообщения не обновилась.'),
     r.notificationDelivered?null:element('button',{onclick:async()=>{try{const retry=await call('completePhotoShift',{intentId:intent.intentId});if(retry.notificationDelivered){msg('Сообщение в группе подтверждено.');}else msg('Подпись пока не обновилась. Проверьте права бота.',true);}catch(e){msg(e.message,true);}}},'Обновить сообщение в группе')));
   }catch(e){result.textContent='Не удалось закончить отметку: '+e.message+' Попробуйте отправить ещё раз, не делая нового снимка.';submit.disabled=false;}
  };
  const submit=take.cloneNode(true);
  take.replaceWith(submit);submit.textContent='Повторить отправку';submit.disabled=true;
  submit.addEventListener('click',send);
  await send(); // one shutter press: photo is sent automatically; button is only for failed retries
 },{once:true});
}
// Owner-only data is served by authenticated Telegram Serverless endpoints.
const currency=kopeks=>(Number(kopeks||0)/100).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
const dateOnly=seconds=>new Date(seconds*1000).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
function ui(tag,props={},...children){return element(tag,props,...children);}
function textField(label,type='text',value=''){
 const input=ui('input',{type,value});return {input,field:ui('label',{className:'field'},ui('span',{},label),input)};
}
function lookup(items,id){return items.find(x=>x.id===id);}
function table(headers,rows){
 const th=ui('thead',{},ui('tr',{},...headers.map(x=>ui('th',{},x))));
 const tb=ui('tbody',{},...rows.map(row=>ui('tr',{},...row.map(v=>ui('td',{},v??'—')))));
 return ui('div',{className:'table-scroll'},ui('table',{},th,tb));
}
let dashboard={period:new Date().toISOString().slice(0,7),data:null,active:'overview'};
function refreshDashboard(){return call('ownerDashboard',{args:[dashboard.period]}).then(d=>{dashboard.data=d;renderDashboard();});}
function navButton(id,title){return ui('button',{className:'tab '+(dashboard.active===id?'active':''),onclick:()=>{dashboard.active=id;renderDashboard();}},title);}
function sectionTitle(title,description=''){return ui('div',{className:'section-intro'},ui('h2',{},title),description?ui('p',{className:'muted'},description):null);}
function statisticsCard(title,value,detail=''){return ui('div',{className:'stat'},ui('span',{className:'muted'},title),ui('strong',{},value),detail?ui('small',{},detail):null);}
function dashboardOverviewPanel(d){
 const rows=d.preview.entries;
 const cards=ui('div',{className:'stats-grid'},
   statisticsCard('Отработано',d.summary.workedHours+' ч'),
   statisticsCard('Начисления',currency(d.summary.grossKopeks),'До удержаний'),
   statisticsCard('Смен по графику',d.summary.scheduled),
   statisticsCard('Требуют проверки',d.summary.missing+d.summary.unclosed+d.summary.deviations));
 const warnings=[];
 if(d.summary.missing)warnings.push(`${d.summary.missing} назначенных смен без отметок`);
 if(d.summary.unclosed)warnings.push(`${d.summary.unclosed} незакрытых смен`);
 if(d.summary.deviations)warnings.push(`${d.summary.deviations} уходов вне графика`);
 return ui('div',{className:'dashboard-stack'},
  sectionTitle('Обзор','Фактические данные за выбранный месяц.'),cards,
  warnings.length?ui('div',{className:'notice warning'},'Внимание: '+warnings.join(' · ')):ui('div',{className:'notice'},'Нет обнаруженных отклонений в выбранном периоде.'),
  ui('section',{className:'panel'},sectionTitle('Предварительные начисления'),
   rows.length?table(['Сотрудник','Часы','Начислено','Незакрыто'],rows.map(e=>[e.name,e.hours,currency(e.grossKopeks),e.unclosed||'—'])):ui('p',{className:'muted'},'Сотрудников пока нет.')));
}
function makeSelect(label,items,placeholder='Выберите'){
 const el=ui('select',{},ui('option',{value:''},placeholder),...items.map(x=>ui('option',{value:x.id},x.label||x.name)));
 return {select:el,field:ui('label',{className:'field'},ui('span',{},label),el)};
}
function dashboardSchedulePanel(d){
 const locations=d.locations.map(x=>({id:x.id,name:x.name}));
 const loc=makeSelect('Рабочая точка',locations);
 const name=textField('Название смены (например, Утренняя)');
 const start=textField('Начало','time','09:00'),end=textField('Окончание','time','15:00'),grace=textField('Допуск, минут','number','5');
 const creation=ui('form',{className:'form-grid'},loc.field,name.field,start.field,end.field,grace.field,
  ui('button',{type:'submit'},'Создать тип смены'));
 creation.addEventListener('submit',async e=>{e.preventDefault();try{
  await call('ownerCreateTemplate',{locationId:Number(loc.select.value),name:name.input.value,startTime:start.input.value,endTime:end.input.value,graceMinutes:Number(grace.input.value)});
  msg('Тип смены сохранён');await refreshDashboard();
 }catch(err){msg(err.message,true);}});
 const eSelect=makeSelect('Сотрудник',d.employees.map(x=>({id:x.id,name:x.name})));
 const tSelect=makeSelect('Тип смены',d.templates.filter(t=>t.active).map(t=>({id:t.id,name:`${t.name} · ${t.startTime}–${t.endTime} (точка ${t.locationId})`})));
 const day=textField('Дата','date',new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'));
 const assignment=ui('form',{className:'form-grid'},eSelect.field,tSelect.field,day.field,
  ui('button',{type:'submit'},'Назначить сотрудника'));
 assignment.addEventListener('submit',async e=>{e.preventDefault();try{
  await call('ownerAssignShift',{employeeId:Number(eSelect.select.value),templateId:Number(tSelect.select.value),workDate:day.input.value});
  msg('Смена назначена');await refreshDashboard();
 }catch(err){msg(err.message,true);}});
 const templatesTable=table(['Точка','Смена','Время','Допуск','Действие'],d.templates.map(t=>[
  lookup(d.locations,t.locationId)?.name||t.locationId,t.name,`${t.startTime}–${t.endTime}`,`${t.graceMinutes} мин`,
  ui('button',{className:'outline mini-btn',onclick:async()=>{
   const name=prompt('Название смены',t.name);if(name===null)return;
   const startTime=prompt('Начало, ЧЧ:ММ',t.startTime);if(startTime===null)return;
   const endTime=prompt('Окончание, ЧЧ:ММ',t.endTime);if(endTime===null)return;
   const graceMinutes=prompt('Допуск в минутах',String(t.graceMinutes));if(graceMinutes===null)return;
   try{await call('ownerUpdateTemplate',{templateId:t.id,name,startTime,endTime,graceMinutes:Number(graceMinutes)});
    msg('Тип смены обновлён');await refreshDashboard();}catch(e){msg(e.message,true);}
  }},'Изменить')
 ]));
 const rosterTable=table(['Дата','Сотрудник','Смена','Состояние','Действие'],d.assignments.map(a=>[
  a.workDate,lookup(d.employees,a.employeeId)?.name||a.employeeId,a.templateName,
  a.status==='completed'?'Завершена':a.status==='open'?'Открыта':a.status==='missing'?'Нет отметки':'По графику',
  a.shiftId?'Зафиксировано':ui('button',{className:'outline mini-btn',onclick:async()=>{
   if(!confirm('Снять назначение сотрудника на '+a.workDate+'?'))return;
   try{await call('ownerDeleteAssignment',{assignmentId:a.assignmentId});msg('Назначение удалено');await refreshDashboard();}
   catch(e){msg(e.message,true);}
  }},'Удалить')
 ]));
 return ui('div',{className:'dashboard-stack'},sectionTitle('График сотрудников','Утренняя и вечерняя смены настраиваются отдельно; назначения сохраняются по датам.'),
  ui('div',{className:'columns'},ui('section',{className:'panel'},ui('h3',{},'Добавить тип смены'),creation),ui('section',{className:'panel'},ui('h3',{},'Назначить смену'),assignment)),
  ui('section',{className:'panel'},ui('h3',{},'Типы смен'),templatesTable),
  ui('section',{className:'panel'},ui('h3',{},'Назначения за месяц'),rosterTable));
}
function dashboardAnalyticsPanel(d){
 const shifts=d.shifts.filter(x=>x.endedAt!=null).sort((a,b)=>b.startedAt-a.startedAt);
 const totalByDay=new Map();
 for(const s of shifts){const date=new Date(s.startedAt*1000).toLocaleDateString('sv-SE',{timeZone:d.organization.timezone});
  totalByDay.set(date,(totalByDay.get(date)||0)+Math.max(0,s.endedAt-s.startedAt)/3600);}
 const chart=ui('div',{className:'bar-chart'},...Array.from(totalByDay).sort(([a],[b])=>a.localeCompare(b)).map(([day,hours])=>
  ui('div',{className:'bar-row'},ui('span',{},day.slice(5)),ui('div',{className:'bar-track'},
    ui('div',{className:'bar-fill',style:`width:${Math.max(2,Math.min(100,hours/24*100))}%`})),ui('strong',{},hours.toFixed(1)+' ч'))));
 return ui('div',{className:'dashboard-stack'},sectionTitle('Аналитика смен','Часы по датам, отклонения и проверка незакрытых смен.'),
  ui('section',{className:'panel'},ui('h3',{},'Отработанные часы по дням'),totalByDay.size?chart:ui('p',{className:'muted'},'Завершённых смен пока нет.')),
  ui('section',{className:'panel'},ui('h3',{},'Отклонения'),
   d.preview.exceptions.length?table(['Сотрудник','Отклонение','Причина'],d.preview.exceptions.map(x=>[
    x.name,(x.differenceMinutes<0?'Раньше ':'Позже ')+Math.abs(x.differenceMinutes)+' мин',x.closeComment||'Не указана'
   ])):ui('p',{className:'muted'},'Отклонений за период не обнаружено.')),
  ui('section',{className:'panel'},ui('h3',{},'История смен'),
   table(['Сотрудник','Начало','Конец','Длительность'],shifts.slice(0,100).map(s=>[
    lookup(d.employees,s.employeeId)?.name||s.employeeId,dateOnly(s.startedAt),dateOnly(s.endedAt),((s.endedAt-s.startedAt)/3600).toFixed(2)+' ч'
   ]))));
}
function downloadReportCsv(d){
 const rows=[['Сотрудник','Часы','Начислено, ₽','Незакрыто'],...d.preview.entries.map(e=>[e.name,e.hours,(e.grossKopeks/100).toFixed(2),e.unclosed])];
 const csv='\uFEFF'+rows.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=`servgo-smena-${dashboard.period}.csv`;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function dashboardReportsPanel(d){
 const csvBtn=ui('button',{onclick:()=>downloadReportCsv(d)},'Выгрузить CSV');
 return ui('div',{className:'dashboard-stack'},sectionTitle('Месячный отчёт','Владелец вызывает расчёт за выбранный месяц без планировщика.'),
  ui('section',{className:'panel'},ui('div',{className:'panel-head'},ui('h3',{},'Предварительный расчёт'),csvBtn),
   table(['Сотрудник','Часы','Начисление','Незакрыто'],d.preview.entries.map(e=>[e.name,e.hours,currency(e.grossKopeks),e.unclosed])),
   ui('div',{className:'report-total'},'Всего начислено: ',ui('strong',{},currency(d.preview.totals.grossKopeks))),
   ui('p',{className:'muted'},'Это предварительные начисления: без НДФЛ, обязательных доплат и удержаний. Требуется проверка.')),
  ui('section',{className:'panel'},ui('h3',{},'Смены без отметки'),
    d.assignments.some(a=>a.status==='missing')?table(['Дата','Сотрудник','Смена'],d.assignments.filter(a=>a.status==='missing').map(a=>[a.workDate,lookup(d.employees,a.employeeId)?.name,a.templateName])):
     ui('p',{className:'muted'},'Пропущенных назначенных смен за период не обнаружено.')));
}
function dashboardSettingsPanel(d){
 const name=textField('ФИО сотрудника');const tgId=textField('Telegram ID','number');const rate=textField('Ставка за час, ₽','number','300');
 const employeeForm=ui('form',{className:'form-grid'},name.field,tgId.field,rate.field,ui('button',{type:'submit'},'Добавить сотрудника'));
 employeeForm.addEventListener('submit',async e=>{e.preventDefault();try{
  await call('ownerManageEmployee',{action:'add',tgId:Number(tgId.input.value),name:name.input.value,hourlyKopeks:Math.round(Number(rate.input.value)*100)});
  msg('Сотрудник добавлен');await refreshDashboard();}catch(err){msg(err.message,true);}});
 const edit=makeSelect('Сотрудник',d.employees.map(x=>({id:x.tgId,name:x.name})));
 const newRate=textField('Почасовая ставка, ₽','number','300');
 const editRate=ui('form',{className:'form-grid'},edit.field,newRate.field,ui('button',{type:'submit'},'Изменить ставку'));
 editRate.addEventListener('submit',async e=>{e.preventDefault();try{
  await call('ownerManageEmployee',{action:'rate',tgId:Number(edit.select.value),hourlyKopeks:Math.round(Number(newRate.input.value)*100)});
  msg('Новая ставка применяется к будущим сменам');await refreshDashboard();}catch(err){msg(err.message,true);}});
 const addShiftBonus=makeSelect('Сотрудник для надбавки',d.employees.map(x=>({id:x.tgId,name:x.name})));
 const bonus=textField('Надбавка за завершённую смену, ₽','number','0');
 const editBonus=ui('form',{className:'form-grid'},addShiftBonus.field,bonus.field,ui('button',{type:'submit'},'Сохранить надбавку'));
 editBonus.addEventListener('submit',async e=>{e.preventDefault();try{
  await call('ownerManageEmployee',{action:'shiftBonus',tgId:Number(addShiftBonus.select.value),shiftBonusKopeks:Math.round(Number(bonus.input.value)*100)});
  msg('Надбавка настроена');await refreshDashboard();}catch(err){msg(err.message,true);}});
 return ui('div',{className:'dashboard-stack'},sectionTitle('Настройки','Организации, сотрудники, тарифы и рабочие группы.'),
  ui('div',{className:'columns'},ui('section',{className:'panel'},ui('h3',{},'Новый сотрудник'),employeeForm),ui('section',{className:'panel'},ui('h3',{},'Изменить ставку'),editRate)),
  ui('section',{className:'panel'},ui('h3',{},'Надбавка за смену'),editBonus),
  ui('section',{className:'panel'},ui('h3',{},d.organization.name),ui('p',{className:'muted'},`Часовой пояс: ${d.organization.timezone}`),
   table(['Точка','Telegram-группа','График точки (старый режим)'],d.locations.map(l=>[l.name,l.chatId||'Нет привязки',l.plannedStartTime?`${l.plannedStartTime}–${l.plannedEndTime}`:'—']))),
  ui('section',{className:'panel'},ui('h3',{},'Безопасность'),
   ui('p',{},'Селфи отправляются в Telegram-группу привязанной точки. Зарплатные отчёты доступны только владельцу.'),
   ui('p',{},'Смена устройства QR подтверждается криптографическим ключом; не храните пароли или ключи в общем доступе.')));
}
function renderDashboard(){
 const d=dashboard.data;if(!d)return;
 const period=ui('input',{type:'month',value:dashboard.period});period.value=dashboard.period;
 period.addEventListener('change',()=>{dashboard.period=period.value;refreshDashboard().catch(e=>msg(e.message,true));});
 const header=ui('header',{className:'dashboard-header'},ui('div',{},ui('span',{className:'eyebrow'},'ServGo / управление персоналом'),
  ui('h1',{},'Смена'),ui('p',{className:'muted'},d.organization.name)),
  ui('div',{className:'header-actions'},period,ui('button',{className:'outline',onclick:renderHome},'QR-устройство')));
 const nav=ui('nav',{className:'dashboard-nav'},...[
  ['overview','Обзор'],['schedule','График'],['analytics','Аналитика'],['reports','Отчёты'],['settings','Настройки']
 ].map(([id,title])=>navButton(id,title)));
 const current=dashboard.active==='overview'?dashboardOverviewPanel(d):dashboard.active==='schedule'?dashboardSchedulePanel(d):
  dashboard.active==='analytics'?dashboardAnalyticsPanel(d):dashboard.active==='reports'?dashboardReportsPanel(d):dashboardSettingsPanel(d);
 render(ui('div',{className:'dashboard'},header,nav,current));
}
function renderHome(){
 const owner=state.context?.owner;
 const box=element('section',{className:'panel'},element('h1',{},'ServGo Смена'),
  element('p',{},owner?`Организация: ${owner.name}`:'Для открытия и закрытия смен сканируйте QR на рабочем месте.'));
 if(owner){
  const choices=element('select');for(const loc of owner.locations)choices.append(element('option',{value:loc.id},`${loc.name} (#${loc.id})`));
  box.append(element('h2',{},'Рабочее QR-устройство'),choices,
    element('p',{className:'muted'},'Только одно устройство на точку. Для замены нужен отзыв с подписанным ключом старого устройства.'),
    element('button',{onclick:async()=>{try{await enroll(Number(choices.value));}catch(e){msg(e.message,true);}}},'Зарегистрировать это устройство'));
  if(state.device){box.append(element('button',{className:'outline',onclick:()=>displayKiosk().catch(e=>msg(e.message,true))},'Показать QR этого устройства'));}
  const pairing=element('textarea',{rows:3,placeholder:'Код pk1_ с сайта smena.servgo.ru'});
  const paired=element('p',{className:'notice'});
  box.append(element('h2',{},'QR-экран на smena.servgo.ru'),element('p',{},'Откройте сайт на рабочем устройстве, создайте код регистрации и вставьте его сюда. Выберите рабочую точку выше.'),pairing,
   element('button',{onclick:async()=>{try{const r=await call('enrollDevice',{locationId:Number(choices.value),pairingCode:pairing.value});paired.textContent=`Устройство зарегистрировано. Введите на рабочем экране ID: ${r.id}`;pairing.value='';}catch(e){msg(e.message,true);}}},'Привязать рабочий экран'),paired);
  const revokeProof=element('textarea',{rows:3,placeholder:'Код kr1_ с рабочего экрана для отзыва'});
  box.append(element('details',{},element('summary',{},'Отвязать внешний QR-экран'),element('p',{},'На рабочем экране нажмите «Отвязать устройство». Код отзыва действует 60 секунд.'),revokeProof,
   element('button',{className:'outline',onclick:async()=>{try{await call('revokeKioskDevice',{proof:revokeProof.value.trim()});revokeProof.value='';msg('Рабочее устройство отозвано. Можно зарегистрировать замену.');}catch(e){msg(e.message,true);}}},'Подтвердить отзыв')));
  box.append(element('button',{onclick:async()=>{try{await refreshDashboard();}catch(e){msg(e.message,true);}}},'Кабинет руководителя: график и отчёты'));
 }
 render(box);
}
function renderReport(r){
 const box=element('section',{className:'panel'},element('h1',{},'Предварительное начисление'),
  element('p',{},`${r.period.start} — ${r.period.endExclusive} (исключая дату окончания)`));
 for(const e of r.entries)box.append(element('p',{},`${e.name}: ${e.hours} ч, ${(e.grossKopeks/100).toFixed(2)} ₽${e.unclosed?' ⚠️ '+e.unclosed+' незакрытых':''}`));
 if(r.exceptions?.length){
  box.append(element('h2',{},`Отклонения от графика: ${r.exceptions.length}`));
  for(const item of r.exceptions)box.append(element('p',{},`${item.name}: ${item.status==='early'?'раньше':'позже'} на ${Math.abs(item.differenceMinutes)} мин. Причина: ${item.closeComment||'не указана'}`));
 }
 box.append(element('strong',{},`Итого: ${(r.totals.grossKopeks/100).toFixed(2)} ₽`),
  element('p',{className:'muted'},'Без удержаний и обязательных доплат. Требуется проверка.'),
  element('button',{onclick:renderHome},'Назад'));render(box);
}
(async()=>{
 try{
  if(!T?.Serverless?.call||!T?.initData){render(ui('section',{className:'public-page'},ui('span',{className:'eyebrow'},'ServGo · управление сотрудниками'),ui('h1',{},'ServGo Смена'),ui('p',{},'Графики, QR-отметки с селфи, табель и месячные отчёты в одном кабинете.'),ui('h2',{},'Доступ владельца'),ui('p',{},'Для доступа к реальным данным откройте Mini App вашего бота ServGo Смена в Telegram. Обычная ссылка не предоставляет доступ к зарплатам и персональным данным.'),ui('a',{href:'https://t.me/servgo_smena_bot',className:'primary'},'Открыть бота в Telegram'),ui('p',{className:'muted'},'В чате бота нажмите «Открыть Смену».')));return;}T.ready();T.expand();
  state.context=await call('getContext',{});
  try{state.device=JSON.parse(localStorage.getItem('servgo-kiosk-device')||'null');}catch{state.device=null;}
  const token=state.context.scanToken || new URLSearchParams(location.search).get('scan');
  if(token)await showScan(token);else renderHome();
 }catch(e){render(element('section',{className:'panel'},element('h1',{},'ServGo Смена'),element('p',{className:'error'},e.message)));}
})();
