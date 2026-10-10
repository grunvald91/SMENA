import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPeriod,startOfLocalDay,formatDate,overlapSeconds,addDays} from '../tgcloud/lib/time.js';
import {computePreview} from '../tgcloud/lib/payroll.js';
import { nonce,verifyDeviceSignature,pairingMessage,validateProofTime,base64url } from '../tgcloud/lib/security.js';
import {DomainError} from '../tgcloud/lib/errors.js';
const p=(start,end)=>({start,end,startMs:Date.parse(start+'T00:00:00Z'),endMs:Date.parse(end+'T00:00:00Z'),tz:'UTC'});
test('default report includes prior days only, by location timezone',()=>{
 const r=reportPeriod([],Date.parse('2026-10-10T07:00:00Z'),'Europe/Moscow');
 assert.equal(r.start,'2026-10-01');assert.equal(r.end,'2026-10-10');
 assert.equal(new Date(r.startMs).toISOString(),'2026-09-30T21:00:00.000Z');
});
test('reports support full months, exact end-inclusive dates and invalid values',()=>{
 const r=reportPeriod(['2026-09'],Date.parse('2026-10-10'),'UTC');
 assert.equal(r.end,'2026-10-01');
 assert.equal(reportPeriod(['2026-09-01','2026-09-09'],Date.parse('2026-10-10'),'UTC').end,'2026-09-10');
 assert.throws(()=>reportPeriod(['2026-02-30'],Date.now(),'UTC'),DomainError);
 assert.throws(()=>reportPeriod(['2026-12'],Date.parse('2026-10-10'),'UTC'),DomainError);
});
test('timezone start handles daylight saving transitions',()=>{
 assert.equal(new Date(startOfLocalDay('2026-03-29','Europe/Amsterdam')).toISOString(),'2026-03-28T23:00:00.000Z');
 assert.equal(new Date(startOfLocalDay('2026-03-30','Europe/Amsterdam')).toISOString(),'2026-03-29T22:00:00.000Z');
});
test('shift overlap splits cross-month and midnight work exactly',()=>{
 const a=Date.parse('2026-09-30T22:00:00Z')/1000,b=Date.parse('2026-10-01T02:00:00Z')/1000;
 assert.equal(overlapSeconds(a,b,p('2026-10-01','2026-11-01').startMs,p('2026-10-01','2026-11-01').endMs),7200);
});
test('preview includes rate frozen at check-in and bonus on closed shift',()=>{
 const period=p('2026-10-01','2026-11-01');
 const e=[{id:7,name:'Ирина',hourlyKopeks:50000}],a=Date.parse('2026-10-03T09:00:00Z')/1000;
 const report=computePreview({employees:e,period,shifts:[{employeeId:7,startedAt:a,endedAt:a+8*3600,hourlyKopeksSnapshot:30000,shiftBonusKopeksSnapshot:20000}],bonuses:[{employeeId:7,amountKopeks:10000}]});
 assert.equal(report.totals.seconds,28800);
 assert.equal(report.totals.baseKopeks,240000);
 assert.equal(report.totals.bonusKopeks,30000);
 assert.equal(report.totals.grossKopeks,270000);
});
test('open shift excluded from earnings and flagged',()=>{
 const r=computePreview({employees:[{id:1,name:'А',hourlyKopeks:10000}],period:p('2026-10-01','2026-10-10'),bonuses:[],shifts:[{employeeId:1,startedAt:Date.parse('2026-10-01')/1000,endedAt:null}]});
 assert.equal(r.totals.grossKopeks,0);assert.equal(r.totals.unclosed,1);
});
test('device P-256 signature verifies and tampering fails',async()=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const message=pairingMessage('challenge','random');
 const signature=base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(message))));
 assert.equal(await verifyDeviceSignature(jwk,message,signature),true);
 assert.equal(await verifyDeviceSignature(jwk,message+'!',signature),false);
 assert.equal(await verifyDeviceSignature(jwk,message,nonce(64)),false);
 assert.ok(nonce().length>25);
});
test('expired QR and device challenge fail closed',()=>{
 assert.throws(()=>validateProofTime(100,100),DomainError);
 assert.doesNotThrow(()=>validateProofTime(101,100));
});
