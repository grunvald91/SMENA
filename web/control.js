import {startTelegramQrScan} from './qr-scan.js';
import {captureFrame} from './portrait.js';
import {controlTime} from '../tgcloud/lib/control-rules.js';
export function createControlUI({element:e,render,call,state,T,home,msg}){
 const button=()=>e('button',{className:'outline',onclick:()=>show().catch(x=>msg(x.message,true))},'Фотоконтроль');
 const deadline=(r)=>controlTime(r.deadlineAt,r.timezone);
 async function show(){
  const data=await call('controlContext'),panel=e('section',{className:'panel'},e('h1',{},'Фотоконтроль'),e('p',{},'Задания владельца со сроком. Фотографии и комментарии публикуются в рабочей группе.'));
  if(data.owner){
   const o=data.owner,loc=e('select',{id:'control-location'}),person=e('select',{id:'control-person'});
   o.locations.forEach(p=>loc.append(e('option',{value:p.id},p.name)));
   person.append(e('option',{value:'all'},'Все, кто сейчас на смене на точке'));o.employees.forEach(p=>person.append(e('option',{value:p.id},p.name)));
   const task=e('textarea',{id:'control-task',rows:3,maxlength:300,placeholder:'Например: покажите порядок на кухне и состояние продуктов'});
   const due=e('input',{id:'control-deadline',type:'datetime-local',required:''});
   const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:o.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+3600000)).map(x=>[x.type,x.value]));
   due.value=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
   const requestId=()=>{const bytes=crypto.getRandomValues(new Uint8Array(24));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');};
   let id=requestId();
   const submit=e('button',{onclick:async()=>{
    submit.disabled=true;
    try{const r=await call('createControl',{requestId:id,locationId:Number(loc.value),employeeId:person.value,instruction:task.value,deadline:due.value});await show();msg(r.notificationDelivered?'Запрос опубликован в группе.':'Запрос сохранён. Сообщение в группе не подтверждено — проверьте доставку.');}
    catch(x){msg(x.message,true);submit.disabled=false;}
   }},'Запросить контроль');
   panel.append(e('h2',{},'Новый запрос'),e('label',{className:'field',for:'control-location'},'Рабочая точка'),loc,e('label',{className:'field',for:'control-person'},'Кому'),person,e('label',{className:'field',for:'control-task'},'Что сфотографировать'),task,e('label',{className:'field',for:'control-deadline'},`Предоставить до (${o.timezone})`),due,submit);
  }
  panel.append(e('h2',{},'Мои задания'));
  if(!data.tasks.length)panel.append(e('p',{className:'muted'},'Назначенных заданий пока нет.'));
  for(const r of data.tasks){
   const card=e('section',{className:'control-card'},e('h3',{},r.location),e('p',{},r.instruction),e('p',{className:'muted'},`До ${deadline(r)}`),e('p',{className:r.status.startsWith('Просрочено')?'error':'notice'},r.status));
   if(!r.done&&!r.blocked)card.append(e('button',{onclick:()=>{
    try{startTelegramQrScan(T,state.context?.botUsername,{onToken:async token=>{try{await camera(await call('beginControl',{requestId:r.id,token}));}catch(x){msg(x.message,true);}},onInvalid:()=>T.showAlert?.('Сканируйте QR рабочей точки из задания.')});}catch(x){msg(x.message,true);}
   }},'Сканировать QR и выполнить'));
   panel.append(card);
  }
  if(data.owner){
   panel.append(e('h2',{},'Отправленные запросы'));
   if(!data.requests.length)panel.append(e('p',{className:'muted'},'Запросов пока нет.'));
   for(const r of data.requests){
    const card=e('section',{className:'control-card'},e('h3',{},r.location),e('p',{},r.instruction),e('p',{className:'muted'},`До ${deadline(r)}`));
    r.recipients.forEach(p=>{
     const line=e('section',{className:'control-card'},e('p',{},`${p.name}: ${p.status}${p.photoCount?' · '+p.photoCount+' фото':''}${p.comment?' · '+p.comment:''}`));
     p.messageLinks?.forEach((url,i)=>line.append(e('a',{href:url,target:'_blank'},`Открыть фото ${i+1} в группе `)));
     const numbers=e('input',{placeholder:'Номера сообщений с фото через запятую'});
     const note=e('input',{placeholder:'Комментарий / основание решения',maxlength:500});
     async function decide(action){try{await call('ownerControlAction',{requestId:r.id,submissionId:p.submissionId,revision:p.revision,action,note:note.value,messageIds:numbers.value.split(',').map(v=>Number(v.trim())),confirmed:true});await show();}catch(x){msg(x.message,true);}}
     if(p.state==='done'&&!p.review){line.append(note,e('button',{onclick:()=>decide('accept')},'Принять'),e('button',{className:'outline',onclick:()=>decide('rework')},'Вернуть на доработку'));}
     if(p.state==='done'&&p.review==='awaiting'){line.append(note,e('button',{onclick:()=>decide('accept')},'Принять'),e('button',{className:'outline',onclick:()=>decide('rework')},'Вернуть на доработку'));}
     if(['uploading','uncertain'].includes(p.state))line.append(note,numbers,e('button',{className:'outline',onclick:()=>decide('deliveryMissing')},'Проверил группу: фото отсутствует'),e('button',{className:'outline',onclick:()=>decide('deliveryReceived')},'Проверил группу: фото получено'));
     card.append(line);
    });
    if(!r.cancelled){
     const why=e('input',{placeholder:'Причина отмены запроса',maxlength:500});card.append(why,e('button',{className:'outline',onclick:async()=>{try{await call('ownerControlAction',{requestId:r.id,action:'cancel',note:why.value,confirmed:true});await show();}catch(x){msg(x.message,true);}}},'Отменить запрос'));
    }
    if(['uncertain','sending'].includes(r.notificationState)&&!r.cancelled){const why=e('input',{placeholder:'Основание сверки доставки',maxlength:500}),number=e('input',{type:'number',placeholder:'Номер сообщения, если получено'});
     async function settle(action){try{await call('ownerControlAction',{requestId:r.id,action,note:why.value,messageId:Number(number.value),confirmed:true});await show();}catch(x){msg(x.message,true);}}
     card.append(why,number,e('button',{className:'outline',onclick:()=>settle('notificationMissing')},'Сообщения нет — разрешить повтор'),e('button',{className:'outline',onclick:()=>settle('notificationReceived')},'Сообщение получено — подтвердить'));
    }
    if(!r.notificationDelivered&&!r.cancelled)card.append(e('p',{className:'error'},'Публикация запроса в группе не подтверждена. Проверьте группу.'),e('button',{className:'outline',onclick:async()=>{try{const ok=await call('notifyControl',{requestId:r.id});msg(ok?'Запрос опубликован.':'Доставка не подтверждена. Если сообщение уже есть, повторно оно не отправляется.');await show();}catch(x){msg(x.message,true);}}},'Проверить / повторить публикацию'));
    panel.append(card);
   }
  }
  panel.append(e('button',{className:'outline',onclick:()=>show().catch(x=>msg(x.message,true))},'Обновить'),e('button',{className:'outline',onclick:home},'На главную'));render(panel);
 }
 async function camera(intent){
  const panel=e('section',{className:'panel'},e('h2',{},'Съёмка фотоконтроля'),e('p',{},`${intent.employee} · ${intent.location}`),e('p',{},intent.instruction),e('p',{className:'muted'},`Предоставить до ${deadline(intent)}. На съёмку и отправку — 20 минут после QR.`));
  const video=e('video',{autoplay:'',playsinline:'',className:'selfie-video'});video.muted=true;
  const info=e('p',{className:'muted'},'Открываем основную камеру…'),counter=e('p',{},'Снимков: 0 / 10'),gallery=e('div',{className:'control-gallery'});
  const comment=e('textarea',{id:'control-comment',maxlength:500,rows:3,placeholder:'Комментарий к фотографиям'});
  let stream=null,facing='environment',opening=false,sending=false,shots=[],generation=0;
  function stop(){generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;}
  function cleanup(){stop();window.removeEventListener('pagehide',cleanup);}
  const change=e('button',{className:'outline',disabled:true,onclick:async()=>{facing=facing==='environment'?'user':'environment';await open(true);}},'Переключить на фронтальную');
  const take=e('button',{disabled:true,onclick:()=>{
   if(shots.length>=10||sending||opening)return;
   try{
    let canvas=captureFrame(video,1200),data=canvas.toDataURL('image/jpeg',0.78);
    // Bound total request size, retaining the largest available portrait resolution.
    for(const h of [960,800,640]){if(data.length*3/4<=100000)break;canvas=captureFrame(video,h);data=canvas.toDataURL('image/jpeg',0.7);}
    if(data.length*3/4>100000)throw new Error('Снимок слишком большой. Повторите с более близкого расстояния.');
    shots.push(data);refresh();info.textContent='Снимок добавлен. Можно снять ещё или переключить камеру.';
   }catch(x){info.textContent=x.message;}
  }},'Сделать снимок');
  const send=e('button',{disabled:true,onclick:async()=>{
   if(sending||!shots.length)return;sending=true;stop();refresh();change.disabled=true;take.disabled=true;comment.disabled=true;info.textContent='Отправляем фото и комментарий в рабочую группу…';
   try{const r=await call('completeControl',{submissionId:intent.submissionId,revision:intent.revision,photos:shots.map(p=>p.split(',')[1]),comment:comment.value.trim()});shots=[];await show();msg(`Контроль отправлен: ${r.photoCount} фото${r.late?' · с опозданием':''}.`);}
   catch(x){sending=false;comment.disabled=false;refresh();info.textContent=x.message+' Для повторной отправки используйте те же снимки; при неизвестной доставке сначала проверьте группу.';}
  }},'Отправить контроль в группу');
  function refresh(){
   counter.textContent=`Снимков: ${shots.length} / 10`;take.disabled=sending||opening||!stream||shots.length>=10;send.disabled=sending||!shots.length;
   gallery.replaceChildren(...shots.map((src,i)=>e('div',{className:'control-thumb'},e('img',{src,alt:`Снимок ${i+1}`,className:'control-photo'}),e('button',{className:'outline mini-btn',disabled:sending,onclick:()=>{shots.splice(i,1);refresh();}},`Удалить ${i+1}`))));
  }
  async function open(exact=false){
   if(opening||sending)return;opening=true;stop();const version=generation;take.disabled=true;change.disabled=true;
   try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Камера недоступна. Откройте Mini App на совместимом телефоне.');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:exact?{exact:facing}:{ideal:facing},width:{ideal:960},height:{ideal:1280}}});
    if(!panel.isConnected||version!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;await video.play();
    const actual=stream.getVideoTracks()[0]?.getSettings().facingMode;if(['user','environment'].includes(actual))facing=actual;
    change.textContent=facing==='environment'?'Переключить на фронтальную':'Переключить на основную';info.textContent=facing==='environment'?'Основная камера. Снимите рабочее место или продукты.':'Фронтальная камера. Можно сделать селфи.';
   }catch(x){stop();info.textContent=x.name==='NotAllowedError'?'Разрешите доступ к камере в настройках Telegram.':x.name==='OverconstrainedError'?'Эта камера недоступна. Нажмите переключение, чтобы вернуться к доступной.':x.message;}
   finally{opening=false;change.disabled=sending;refresh();}
  }
  panel.append(video,change,take,info,counter,gallery,e('label',{className:'field',for:'control-comment'},'Комментарий (необязательно)'),comment,e('p',{className:'muted'},'Фото и комментарий увидят участники рабочей группы. Один ответ содержит от 1 до 10 фото.'),send,e('button',{className:'outline',onclick:()=>{if(sending)return;shots=[];show().catch(x=>msg(x.message,true));}},'Отменить'));
  render(panel);state.stopCamera=cleanup;window.addEventListener('pagehide',cleanup,{once:true});await open();
 }
 return {show,button};
}
