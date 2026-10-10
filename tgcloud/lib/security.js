import { requireInput,DomainError } from './errors.js';
import { encodeBase64,decodeBase64 } from './base64.js';
import { validateP256PublicKey,verifyP256 } from './vendor/p256.js';
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
export function validateDevicePublicKey(jwk) {
  requireInput(jwk?.kty==='EC' && jwk?.crv==='P-256' && jwk?.alg!=='none' &&
    typeof jwk.x==='string' && typeof jwk.y==='string','BAD_DEVICE_KEY','Требуется публичный ключ ECDSA P-256');
  try {
    const x=decodeBase64url(jwk.x),y=decodeBase64url(jwk.y);
    if(x.length!==32||y.length!==32)throw new Error('Invalid coordinate length');
    const raw=new Uint8Array(65);raw[0]=4;raw.set(x,1);raw.set(y,33);
    validateP256PublicKey(raw);return raw;
  } catch {throw new DomainError('BAD_DEVICE_KEY','Не удалось проверить ключ устройства');}
}
export async function verifyDeviceSignature(jwk,message,signatureBase64) {
  requireCrypto();
  requireInput(jwk?.kty==='EC' && jwk?.crv==='P-256' && jwk?.alg!=='none' && jwk?.x && jwk?.y,'BAD_DEVICE_KEY','Требуется публичный ключ ECDSA P-256');
  try {
    const key=validateDevicePublicKey(jwk);
    return verifyP256(decodeBase64url(signatureBase64),encoder.encode(message),key);
  } catch(e) {if(e instanceof DomainError) throw e;return false;}
}
export function validateProofTime(expiresAt,nowSeconds){requireInput(expiresAt>nowSeconds,'EXPIRED','Срок действия кода истёк');}
