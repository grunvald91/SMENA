import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeBase64,decodeBase64} from '../tgcloud/lib/base64.js';
import {base64url,decodeBase64url,nonce,verifyDeviceSignature} from '../tgcloud/lib/security.js';
import {decodeSelfie} from '../tgcloud/lib/photo.js';

test('RFC 4648 vectors and arbitrary bytes match independent Node encoding',()=>{
  for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(encodeBase64(bytes),Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeBase64(encodeBase64(bytes)),bytes);
  }
  for (const size of [1,2,3,64,1024,512000]) {
    const bytes = Uint8Array.from({length:size},(_,i)=>i%256);
    const reference = Buffer.from(bytes).toString('base64');
    assert.equal(encodeBase64(bytes),reference);
    assert.deepEqual(decodeBase64(reference),bytes);
  }
});
test('invalid encoding and noncanonical pad bits are rejected',()=>{
  for (const value of ['A','A===','====','AA=A','AA==extra','AB==','AAB=','AA\n=','-___']) {
    assert.throws(()=>decodeBase64(value));
  }
  assert.throws(()=>decodeBase64url('A'));
});
test('QR signatures and JPEG decoding work without browser base64 globals',async()=>{
  const oldAtob=globalThis.atob,oldBtoa=globalThis.btoa;
  try {
    globalThis.atob=undefined;globalThis.btoa=undefined;
    assert.equal(nonce().length,32);
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
    const signature=base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode('SMENA'))));
    assert.equal(await verifyDeviceSignature(jwk,'SMENA',signature),true);
    assert.equal(await verifyDeviceSignature(jwk,'tampered',signature),false);
    const jpeg=new Uint8Array(1024);jpeg.set([255,216]);jpeg.set([255,217],1022);
    assert.deepEqual(decodeSelfie(Buffer.from(jpeg).toString('base64')),jpeg);
  } finally {globalThis.atob=oldAtob;globalThis.btoa=oldBtoa;}
});
