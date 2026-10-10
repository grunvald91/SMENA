import { requireInput,DomainError } from './errors.js';
import { encodeBase64,decodeBase64 } from './base64.js';
const encoder=new TextEncoder();
export function requireCrypto() {
  requireInput(!!globalThis.crypto?.getRandomValues && !!globalThis.crypto?.subtle,'CRYPTO_UNAVAILABLE','Нет проверенного WebCrypto в среде Telegram; безопасная QR-авторизация недоступна');
  return globalThis.crypto;
}
export function nonce(bytes=24) {
  const v=new Uint8Array(bytes);requireCrypto().getRandomValues(v);
  return base64url(v);
}
export function base64url(bytes) {
  return encodeBase64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeBase64url(value) {
  requireInput(typeof value==='string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length<1000,'BAD_SIGNATURE','Некорректная подпись');
  try {return decodeBase64(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4));}
  catch {throw new DomainError('BAD_SIGNATURE','Некорректная подпись');}
}
export function pairingMessage(challengeId,nonceValue) {return `ServGoShift:QR:v1:${challengeId}:${nonceValue}`;}
export async function verifyDeviceSignature(jwk,message,signatureBase64) {
  requireCrypto();
  requireInput(jwk?.kty==='EC' && jwk?.crv==='P-256' && jwk?.alg!=='none' && jwk?.x && jwk?.y,'BAD_DEVICE_KEY','Требуется публичный ключ ECDSA P-256');
  try {
    const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,ext:true},
      {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decodeBase64url(signatureBase64),encoder.encode(message));
  } catch(e) {if(e instanceof DomainError) throw e;return false;}
}
export function validateProofTime(expiresAt,nowSeconds){requireInput(expiresAt>nowSeconds,'EXPIRED','Срок действия кода истёк');}
