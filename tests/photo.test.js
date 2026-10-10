import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeSelfie} from '../tgcloud/lib/photo.js';
const jpeg=new Uint8Array(1200);jpeg[0]=0xff;jpeg[1]=0xd8;jpeg[1198]=0xff;jpeg[1199]=0xd9;
test('allows bounded JPEG bytes from in-memory camera frame',()=>{
 const b=decodeSelfie(Buffer.from(jpeg).toString('base64'));assert.equal(b.length,1200);
});
test('rejects missing, wrong-format and oversize images',()=>{
 assert.throws(()=>decodeSelfie(null));
 assert.throws(()=>decodeSelfie(Buffer.alloc(1200).toString('base64')));
 assert.throws(()=>decodeSelfie(Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(530000),Buffer.from([0xff,0xd9])]).toString('base64')));
});
