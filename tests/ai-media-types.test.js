import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedAttachment,bytesMatchAttachment} from '../tgcloud/lib/ai-media-types.js';
const makeBytes=(prefix,size=48)=>{const b=new Uint8Array(size);b.set(prefix);return b;};
test('PDF, voice, MP4 and document images select format-aware processors',()=>{
 assert.deepEqual(supportedAttachment({kind:'document',mimeType:'application/pdf'}),{mode:'pdf',mime:'application/pdf'});
 assert.deepEqual(supportedAttachment({kind:'voice'}),{mode:'audio',mime:'audio/ogg',format:'ogg'});
 assert.deepEqual(supportedAttachment({kind:'video',mimeType:'video/mp4'}),{mode:'video',mime:'video/mp4'});
 assert.deepEqual(supportedAttachment({kind:'document',mimeType:'image/png'}),{mode:'image',mime:'image/png'});
 assert.equal(supportedAttachment({kind:'document',mimeType:'application/x-unknown'}),null);
});
test('file identity is checked against actual bytes',()=>{
 const pdf=makeBytes([37,80,68,70,45]);assert.equal(bytesMatchAttachment({mode:'pdf',mime:'application/pdf'},pdf),true);
 assert.equal(bytesMatchAttachment({mode:'pdf',mime:'application/pdf'},makeBytes([0,1,2,3,4])),false);
 const voice=makeBytes([79,103,103,83]);assert.equal(bytesMatchAttachment({mode:'audio',format:'ogg'},voice),true);
 const png=makeBytes([137,80,78,71]);assert.equal(bytesMatchAttachment({mode:'image',mime:'image/png'},png),true);
 const mp4=makeBytes([0,0,0,24,102,116,121,112]);assert.equal(bytesMatchAttachment({mode:'video',mime:'video/mp4'},mp4),true);
});
