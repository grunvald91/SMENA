import QRCode from 'qrcode';
import {pairingCode,kioskDeviceIdFromPublicKey,kioskPayload,kioskMessage,signedKioskToken} from '../tgcloud/lib/kiosk-token.js';
import './style.css';
const root=document.querySelector('#root');
let device=null,timer=null,clock=null;
function el(tag,text='',props={}){const node=document.createElement(tag);node.textContent=text;for(const [k,v]of Object.entries(props)){if(k==='onclick')node.addEventListener('click',v);else node.setAttribute(k,v);}return node;}
function render(...items){clearTimeout(timer);clearInterval(clock);root.replaceChildren(...items);}
function panel(title,...items){const card=el('section','',{class:'card'});card.append(el('div','SERVGO · СМЕНА',{class:'brand'}),el('h1',title),...items);return card;}
function fail(e){const notice=el('p',e.message||String(e),{class:'error'});root.prepend(notice);}
function db(){return new Promise((resolve,reject)=>{const req=indexedDB.open('servgo-workplace-kiosk',1);req.onupgradeneeded=()=>req.result.createObjectStore('device');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function readDevice(){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('device').objectStore('device').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveDevice(record){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('device','readwrite');tx.objectStore('device').put(record,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function copyCode(code,status){try{await navigator.clipboard.writeText(code);status.textContent='Код скопирован.';}catch{status.textContent='Выделите и скопируйте код вручную.';}}
function registration(){
 const code=pairingCode(device.publicJwk);
 if(!device.id)device.id=kioskDeviceIdFromPublicKey(device.publicJwk);
 const qr=el('canvas','',{'aria-label':'QR для подключения рабочего экрана'});
 const area=el('textarea',code,{readonly:'',rows:3,'aria-label':'Код подключения рабочего экрана'});
 const status=el('p','',{class:'muted'});
 const backup=el('details');
 backup.append(el('summary','Если QR не сканируется: скопировать код'),area,
  el('button','Скопировать код',{onclick:()=>copyCode(code,status)}),status);
 const legacyId=el('input','',{type:'number',min:'1',placeholder:'Ранее выданный ID','aria-label':'Старый ID устройства'});
 const legacy=el('details');
 legacy.append(el('summary','Ранее подключали по старой схеме?'),
  el('p','Если это устройство уже было подтверждено в Telegram, введите ранее выданный ID. В остальных случаях ничего вводить не нужно.'),
  legacyId,el('button','Применить старый ID',{class:'secondary',onclick:async()=>{
   try{
    const value=Number(legacyId.value);
    if(!Number.isSafeInteger(value)||value<=0)throw new Error('Неверный ID');
    device.id=value;device.status='ready';
    await saveDevice(device);await display();
   }catch(e){fail(e);}
  }}));
 render(panel('Подключить рабочий экран',
  el('p','Владелец открывает ServGo Смена в Telegram и сканирует этот код своим телефоном. Камера на рабочем компьютере не нужна.'),
  qr,el('p','Выберите точку в Telegram и подтвердите привязку.',{class:'instruction'}),
  el('button','Владелец подтвердил — показать QR',{onclick:async()=>{
   try{device.status='ready';await saveDevice(device);await display();}catch(e){fail(e);}
  }}),
  backup,legacy,
  el('p','Ключ хранится только в этом браузере. Не очищайте данные сайта. Включите автоматическую настройку времени.',{class:'muted'})));
 QRCode.toCanvas(qr,code,{width:330,margin:3,errorCorrectionLevel:'M'}).catch(fail);
 saveDevice(device).catch(fail);
}
async function sign(kind='qr'){
 const payload=kioskPayload(device.id,Math.floor(Date.now()/1000),crypto.getRandomValues(new Uint8Array(12)));
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},device.privateKey,new TextEncoder().encode(kioskMessage(payload,kind))));
 return signedKioskToken(payload,signature,kind);
}
async function revoke(){
 const proof=await sign('revoke'),area=el('textarea',proof,{readonly:'',rows:4,'aria-label':'Код отзыва устройства'}),status=el('p','',{class:'muted'});
 render(panel('Отвязать устройство',el('p','Передайте этот код владельцу. В приложении бота: «Отвязать внешний QR-экран» → вставить код → «Подтвердить отзыв».'),area,
  el('button','Скопировать код',{onclick:()=>copyCode(proof,status)}),status,el('p','Код действует 60 секунд. После подтверждения старые QR перестанут приниматься.'),
  el('button','Вернуться к QR',{class:'secondary',onclick:()=>display().catch(fail)})));
}
async function display(){
 const canvas=el('canvas','',{'aria-label':'QR для отметки прихода или ухода'}),countdown=el('p','Готовим QR…',{class:'countdown'});
 const title=el('h1',device.name||'Рабочая точка'),card=panel('QR рабочего места',title,canvas,countdown,
  el('p','Наведите камеру телефона. В Telegram выберите «Я пришёл на работу» или «Я ухожу с работы» и сделайте селфи.',{class:'instruction'}),
  el('p','Код обновляется автоматически. Не фотографируйте и не пересылайте его.',{class:'muted'}));
 title.setAttribute('class','location');
 const options=el('details'),summary=el('summary','Настройки экрана');options.append(summary,
  el('p',`Устройство №${device.id}. Если отметка сообщает о неверном времени, включите автоматическую настройку часов на рабочем устройстве.`),
  el('button','Настройки и регистрация',{class:'secondary',onclick:registration}),
  el('button','Отвязать устройство',{class:'secondary',onclick:()=>revoke().catch(fail)}));card.append(options);render(card);
 let expires=0;
 async function tick(){if(!canvas.isConnected)return;try{
  const token=await sign();expires=Math.floor(Date.now()/1000)+30;
  await QRCode.toCanvas(canvas,`https://t.me/servgo_smena_bot?startapp=scan_${token}`,{width:400,margin:3,errorCorrectionLevel:'M'});
  timer=setTimeout(tick,25000);
 }catch(e){canvas.hidden=true;countdown.textContent='Не удалось создать QR: '+e.message;countdown.className='error';}}
 clock=setInterval(()=>{if(expires)countdown.textContent=`Новый код через ${Math.max(0,expires-Math.floor(Date.now()/1000)-5)} с`;},1000);
 await tick();
}
async function start(){
 if(!window.isSecureContext||!crypto?.subtle||!indexedDB)throw new Error('Для рабочего QR нужен HTTPS и браузер с WebCrypto и IndexedDB.');
 device=await readDevice();
 if(device?.id&&device.status!=='pending')return display();if(device)return registration();
 render(panel('QR рабочего места',el('p','Этот экран остаётся на планшете, компьютере или телефоне в рабочей точке. Сотрудники сканируют QR своими телефонами.'),
  el('button','Настроить это устройство',{onclick:async()=>{try{const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);device={privateKey:keys.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',keys.publicKey),status:'pending'};await saveDevice(device);registration();}catch(e){fail(e);}}}),
  el('p','Однократную привязку подтверждает владелец в Telegram. Включите автоматическое время и используйте постоянный профиль браузера.',{class:'muted'})));
}
start().catch(e=>render(panel('Экран пока недоступен',el('p',e.message,{class:'error'}))));
