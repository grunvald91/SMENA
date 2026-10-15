import test from 'node:test';
import assert from 'node:assert/strict';
import {startPairingQrScan} from '../web/qr-scan.js';
function scannerFixture(){
 let cb=null,closed=0,invalid=0;
 const T={isVersionAtLeast:()=>true,onEvent:()=>{},offEvent:()=>{closed++},
  showScanQrPopup:(_opts,fn)=>{cb=fn;}};
 return {T,scan:(value)=>cb(value),closed:()=>closed,invalid:()=>invalid};
}
test('pairing scanner rejects unrelated and working-shift QR links',async()=>{
 const x=scannerFixture();const read=[];
 startPairingQrScan(x.T,{onCode:v=>read.push(v),onInvalid:()=>read.push('invalid')});
 assert.equal(x.scan('https://t.me/servgo_smena_bot?startapp=scan_aaa'),false);
 assert.deepEqual(read,['invalid']);
 assert.equal(x.scan(''),false);
 assert.deepEqual(read,['invalid','invalid']);
});
test('pairing scanner accepts public-key registration once, then closes',async()=>{
 const x=scannerFixture();const result=[];const pair='pk1_'+'A'.repeat(87);
 startPairingQrScan(x.T,{onCode:v=>result.push(v)});
 assert.equal(x.scan(pair),true);
 await Promise.resolve();
 assert.deepEqual(result,[pair]);
 assert.equal(x.scan(pair),true);
 await Promise.resolve();
 assert.equal(result.length,1);
 assert.equal(x.closed(),1);
});
test('pairing scanner reports unavailable feature',()=>{
 assert.throws(()=>startPairingQrScan({isVersionAtLeast:()=>false},{}),/недоступен/);
});
