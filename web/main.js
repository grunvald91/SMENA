import QRCode from 'qrcode';
import './style.css';
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
 if(!/^[A-Za-z0-9_-]{32}$/.test(token||''))throw new Error('Некорректная ссылка QR');
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
  element('p',{},`${intent.employee} · ${intent.location}. Сделайте фотографию в форме, чтобы она попала в рабочую группу.`));
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
     element('p',{},'Селфи отправлено в Telegram-группу рабочей точки. Комментарий к уходу доступен владельцу в отчёте.')));
   }catch(e){result.textContent='Не удалось закончить отметку: '+e.message+' Попробуйте отправить ещё раз, не делая нового снимка.';submit.disabled=false;}
  };
  const submit=take.cloneNode(true);
  take.replaceWith(submit);submit.textContent='Повторить отправку';submit.disabled=true;
  submit.addEventListener('click',send);
  await send(); // one shutter press: photo is sent automatically; button is only for failed retries
 },{once:true});
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
  box.append(element('button',{className:'outline',onclick:async()=>{
    try{const report=await call('ownerReport',{});renderReport(report);}catch(e){msg(e.message,true);}
  }},'Отчёт за предыдущие дни'));
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
  if(!T)throw new Error('Откройте Mini App через Telegram.');T.ready();T.expand();
  state.context=await call('getContext',{});
  try{state.device=JSON.parse(localStorage.getItem('servgo-kiosk-device')||'null');}catch{state.device=null;}
  const token=state.context.scanToken || new URLSearchParams(location.search).get('scan');
  if(token)await showScan(token);else renderHome();
 }catch(e){render(element('section',{className:'panel'},element('h1',{},'ServGo Смена'),element('p',{className:'error'},e.message)));}
})();
