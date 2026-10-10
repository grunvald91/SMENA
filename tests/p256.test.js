import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url,verifyDeviceSignature,validateDevicePublicKey} from '../tgcloud/lib/security.js';
test('WebCrypto signatures with both s values verify without native ECDSA',async()=>{
 const saved=globalThis.crypto;
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 const pair=await saved.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await saved.subtle.exportKey('jwk',pair.publicKey);
 const message='SMENA independent WebCrypto vector';
 const sig=new Uint8Array(await saved.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(message)));
 const n=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
 const s=BigInt('0x'+Buffer.from(sig.slice(32)).toString('hex'));
 const alternate=new Uint8Array(sig);alternate.set(Buffer.from((n-s).toString(16).padStart(64,'0'),'hex'),32);
 try {
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:a=>saved.getRandomValues(a),subtle:{importKey(){throw new Error('unsupported algorithm');}}}});
  assert.equal(await verifyDeviceSignature(jwk,message,base64url(sig)),true);
  assert.equal(await verifyDeviceSignature(jwk,message,base64url(alternate)),true);
  assert.equal(await verifyDeviceSignature(jwk,message+'!',base64url(sig)),false);
  const changed=new Uint8Array(sig);changed[0]^=1;
  assert.equal(await verifyDeviceSignature(jwk,message,base64url(changed)),false);
  assert.equal(await verifyDeviceSignature(jwk,message,base64url(new Uint8Array(64))),false);
 }finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});
test('public key enrollment rejects invalid lengths and points outside P-256',()=>{
 const zero=base64url(new Uint8Array(32));
 assert.throws(()=>validateDevicePublicKey({kty:'EC',crv:'P-256',x:zero,y:zero}),e=>e.code==='BAD_DEVICE_KEY');
 assert.throws(()=>validateDevicePublicKey({kty:'EC',crv:'P-256',x:'AA',y:zero}),e=>e.code==='BAD_DEVICE_KEY');
});
