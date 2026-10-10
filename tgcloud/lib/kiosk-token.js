import {encodeBase64,decodeBase64} from './base64.js';
import {requireInput} from './errors.js';
const ORDER=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
export function encodeUrl(bytes){return encodeBase64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeUrl(text){
 requireInput(typeof text==='string'&&/^[A-Za-z0-9_-]+$/.test(text)&&text.length<512,'BAD_QR','Некорректный код');
 const bytes=decodeBase64(text.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-text.length%4)%4));
 requireInput(encodeUrl(bytes)===text,'BAD_QR','Неканонический код');return bytes;
}
export function pairingCode(jwk){
 const x=decodeUrl(jwk.x),y=decodeUrl(jwk.y);requireInput(x.length===32&&y.length===32,'BAD_DEVICE_KEY','Некорректный ключ');
 const bytes=new Uint8Array(65);bytes[0]=4;bytes.set(x,1);bytes.set(y,33);return 'pk1_'+encodeUrl(bytes);
}
export function parsePairingCode(code){
 requireInput(typeof code==='string'&&code.startsWith('pk1_'),'BAD_DEVICE_KEY','Скопируйте код pk1_ с рабочего экрана');
 const bytes=decodeUrl(code.slice(4));requireInput(bytes.length===65&&bytes[0]===4,'BAD_DEVICE_KEY','Некорректный ключ');
 return {kty:'EC',crv:'P-256',x:encodeUrl(bytes.slice(1,33)),y:encodeUrl(bytes.slice(33))};
}
export function kioskPayload(deviceId,issuedAt,nonce){
 requireInput(Number.isSafeInteger(deviceId)&&deviceId>0&&Number.isInteger(issuedAt)&&issuedAt>0&&issuedAt<4294967296&&nonce?.length===12,'BAD_QR','Некорректные данные QR');
 const bytes=new Uint8Array(25),view=new DataView(bytes.buffer);bytes[0]=1;
 view.setUint32(1,Math.floor(deviceId/4294967296));view.setUint32(5,deviceId%4294967296);view.setUint32(9,issuedAt);bytes.set(nonce,13);return bytes;
}
export function kioskMessage(payload,kind='qr'){return `ServGoShift:Kiosk:${kind}:v1:${encodeUrl(payload)}`;}
export function normalizeSignature(signature){
 const bytes=new Uint8Array(signature);requireInput(bytes.length===64,'BAD_SIGNATURE','Неверная длина подписи');
 let s=0n;for(const byte of bytes.slice(32))s=(s<<8n)|BigInt(byte);
 requireInput(s>0n&&s<ORDER,'BAD_SIGNATURE','Некорректная подпись');
 if(s>ORDER/2n){s=ORDER-s;for(let i=63;i>=32;i--){bytes[i]=Number(s&255n);s>>=8n;}}
 return bytes;
}
export function signedKioskToken(payload,signature,kind='qr'){
 requireInput(payload?.length===25&&['qr','revoke'].includes(kind),'BAD_QR','Некорректный код');
 const bytes=new Uint8Array(89);bytes.set(payload);bytes.set(normalizeSignature(signature),25);
 return (kind==='qr'?'k1_':'kr1_')+encodeUrl(bytes);
}
export function isShiftToken(token){return typeof token==='string'&&(/^[A-Za-z0-9_-]{32}$/.test(token)||/^k1_[A-Za-z0-9_-]{119}$/.test(token));}
export function parseKioskToken(token,stamp,kind='qr'){
 const prefix=kind==='qr'?'k1_':'kr1_';
 requireInput(typeof token==='string'&&token.startsWith(prefix),'BAD_QR','Некорректный код рабочего устройства');
 const bytes=decodeUrl(token.slice(prefix.length));requireInput(bytes.length===89&&bytes[0]===1,'BAD_QR','Некорректный формат QR');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const deviceId=view.getUint32(1)*4294967296+view.getUint32(5),issuedAt=view.getUint32(9),ttl=kind==='qr'?30:60;
 requireInput(Number.isSafeInteger(deviceId)&&deviceId>0,'BAD_QR','Некорректное устройство');
 requireInput(issuedAt<=stamp+5&&issuedAt+ttl>stamp,'EXPIRED','QR устарел или часы рабочего устройства неверны. Включите автоматическую настройку времени.');
 const signature=bytes.slice(25),canonical=normalizeSignature(signature);
 requireInput(signature.every((byte,i)=>byte===canonical[i]),'BAD_SIGNATURE','Неканоническая подпись');
 return {deviceId,issuedAt,expiresAt:issuedAt+ttl,payload:bytes.slice(0,25),signature:encodeUrl(signature)};
}
