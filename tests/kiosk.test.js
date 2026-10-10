import test from 'node:test';
import assert from 'node:assert/strict';
import {pairingCode,parsePairingCode,kioskPayload,kioskMessage,signedKioskToken,parseKioskToken,isShiftToken,decodeUrl,encodeUrl} from '../tgcloud/lib/kiosk-token.js';
import {verifyDeviceSignature} from '../tgcloud/lib/security.js';
import {shiftPhotoCaption} from '../tgcloud/lib/shift-caption.js';
async function fixture(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);return {pair,jwk:await crypto.subtle.exportKey('jwk',pair.publicKey)};}
async function token(pair,id,time,kind='qr'){const payload=kioskPayload(id,time,new Uint8Array(12).fill(7));const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(kioskMessage(payload,kind)));return signedKioskToken(payload,new Uint8Array(sig),kind);}
test('workplace QR verifies independent WebCrypto signature, rejects different key and changed payload',async()=>{
 const {pair,jwk}=await fixture(),stamp=1791633600,value=await token(pair,4294967299,stamp);
 assert.equal(isShiftToken(value),true);assert.ok(('scan_'+value).length<512);
 const parsed=parseKioskToken(value,stamp+29);assert.equal(parsed.deviceId,4294967299);
 assert.equal(await verifyDeviceSignature(jwk,kioskMessage(parsed.payload),parsed.signature),true);
 assert.equal(await verifyDeviceSignature((await fixture()).jwk,kioskMessage(parsed.payload),parsed.signature),false);
 const changed=parsed.payload.slice();changed[24]^=1;assert.equal(await verifyDeviceSignature(jwk,kioskMessage(changed),parsed.signature),false);
 assert.equal(pair.privateKey.extractable,false);
});
test('QR expiration, future clocks and noncanonical signatures fail closed',async()=>{
 const {pair}=await fixture(),stamp=1791633600,value=await token(pair,12,stamp);
 assert.throws(()=>parseKioskToken(value,stamp+30),e=>e.code==='EXPIRED');
 assert.throws(()=>parseKioskToken(value,stamp-6),e=>e.code==='EXPIRED');
 const bytes=decodeUrl(value.slice(3));const order=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
 let s=BigInt('0x'+Buffer.from(bytes.slice(57)).toString('hex'));s=order-s;bytes.set(Buffer.from(s.toString(16).padStart(64,'0'),'hex'),57);
 assert.throws(()=>parseKioskToken('k1_'+encodeUrl(bytes),stamp),e=>e.code==='BAD_SIGNATURE');
 assert.throws(()=>parseKioskToken('k1_AAAA',stamp));
});
test('pairing round trips public key only; revocation cannot be used as attendance',async()=>{
 const {pair,jwk}=await fixture(),stamp=1791633600,code=pairingCode(jwk),decoded=parsePairingCode(code);
 assert.equal(decoded.x,jwk.x);assert.equal(decoded.y,jwk.y);assert.equal(decoded.d,undefined);
 const revoke=await token(pair,5,stamp,'revoke');assert.equal(isShiftToken(revoke),false);
 const p=parseKioskToken(revoke,stamp+59,'revoke');
 assert.equal(await verifyDeviceSignature(jwk,kioskMessage(p.payload,'revoke'),p.signature),true);
 assert.equal(await verifyDeviceSignature(jwk,kioskMessage(p.payload),p.signature),false);
 assert.throws(()=>parseKioskToken(revoke,stamp+60,'revoke'),e=>e.code==='EXPIRED');
});
test('photo captions show server attendance time, confirmation and work duration without salary or private comments',()=>{
 const caption=shiftPhotoCaption({action:'out',employee:'Иван',location:'Точка',templateName:'Утренняя',eventAt:Date.parse('2026-10-10T08:45:30Z')/1000,confirmed:true,shiftId:42,durationSeconds:21660});
 assert.match(caption,/Окончание смены/);assert.match(caption,/10.10.2026.*11:45:30/);assert.match(caption,/Europe\/Moscow/);assert.match(caption,/смена #42/);assert.match(caption,/6 ч 1 мин/);assert.doesNotMatch(caption,/ставка|₽|причина/i);
 assert.match(shiftPhotoCaption({action:'in',employee:'Иван',location:'Точка',eventAt:1791633600}),/проверяется/);
});
