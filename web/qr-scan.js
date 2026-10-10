import {isShiftToken} from '../tgcloud/lib/kiosk-token.js';

// Decode data only. Never navigate to a scanned URL or trust another bot's QR.
export function shiftTokenFromQr(text,botUsername){
 if(typeof text!=='string'||text.length>2048||typeof botUsername!=='string')return null;
 try{
  const url=new URL(text.trim());
  if(url.protocol!=='https:'||url.hostname!=='t.me'||url.username||url.password||url.port||url.hash)return null;
  if(url.pathname.toLowerCase()!=='/'+botUsername.toLowerCase()||url.searchParams.getAll('startapp').length!==1)return null;
  const start=url.searchParams.get('startapp');
  if(!start?.startsWith('scan_'))return null;
  const token=start.slice(5);return isShiftToken(token)?token:null;
 }catch{return null;}
}

export function startTelegramQrScan(telegram,botUsername,{onToken,onInvalid,onClose}){
 if(!telegram?.showScanQrPopup||!telegram.isVersionAtLeast?.('6.4'))throw new Error('Сканер недоступен в этом клиенте. Обновите Telegram на телефоне и откройте приложение снова.');
 let consumed=false,active=true;
 const closed=()=>{if(!active)return;active=false;telegram.offEvent?.('scanQrPopupClosed',closed);onClose?.();};
 telegram.onEvent?.('scanQrPopupClosed',closed);
 try{
  telegram.showScanQrPopup({text:'Наведите камеру на QR рабочего места'},text=>{
   if(consumed||!active)return true;
   const token=shiftTokenFromQr(text,botUsername);
   if(!token){onInvalid?.();return false;}
   consumed=true;closed();
   // Return true closes the scanner before the selfie camera is requested.
   Promise.resolve().then(()=>onToken(token));return true;
  });
 }catch(e){closed();throw e;}
}
