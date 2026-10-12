import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWithSingleLookback} from '../tgcloud/lib/ai-context-repair.js';
import {groundBatchFindings} from '../tgcloud/lib/ai-batch.js';

const row=(id,chatId=-100123)=>({
 id,orgId:7,chatId,messageId:id,sentAt:1791730000+id,
 kind:'text',content:'Рабочее событие '+id,replyToMessageId:id-1
});
test('no request for older context if first response is sufficient',async()=>{
 let calls=0,lookups=0;
 const r=await analyzeWithSingleLookback({
  messages:[row(31),row(32)],
  fetchPrevious:async()=>{lookups++;return [row(30)]},
  askModel:async()=>{calls++;return {needs_previous_context:false,findings:[]}}
 });
 assert.equal(calls,1);assert.equal(lookups,0);assert.equal(r.modelCalls,1);
 assert.equal(r.previousMessages,0);assert.equal(r.inconclusive,false);
});
test('exactly one previous page, up to 30 messages, with stable source refs',async()=>{
 const primary=Array.from({length:60},(_,i)=>row(i+61));
 const older=Array.from({length:90},(_,i)=>row(i+1));
 let calls=0,lookups=0,second;
 const r=await analyzeWithSingleLookback({
  messages:primary,fetchPrevious:async()=>{lookups++;return older},
  askModel:async payload=>{
   calls++;
   if(calls===1)return {needs_previous_context:true,findings:[]};
   second=payload;
   return {needs_previous_context:false,findings:[{
    title:'Обсуждение',statement:'Сотрудники продолжают обсуждение задачи',
    sources:['c30','m1'],confidence:'medium'
   }]};
  }
 });
 assert.equal(calls,2);assert.equal(lookups,1);
 assert.equal(second.messages.length,60);
 assert.equal(second.previousContext.length,30);
 assert.equal(second.previousContext[0].ref,'c1');
 assert.equal(second.messages[0].ref,'m1');
 assert.equal(r.previousMessages,30);
 assert.equal(r.sourceMap.c30.messageId,30);
 assert.equal(r.sourceMap.m1.messageId,61);
 assert.equal(groundBatchFindings(r.response.findings,r.sourceMap)[0].evidence.length,2);
});
test('second insufficiency never triggers third provider call or history page',async()=>{
 let calls=0,lookups=0;
 const r=await analyzeWithSingleLookback({
  messages:[row(40)],fetchPrevious:async()=>{lookups++;return [row(39)]},
  askModel:async()=>{calls++;return {
   needs_previous_context:true,findings:[{
    title:'Не доказано',statement:'Есть неподтверждённое объяснение',
    sources:['m1']
   }]}}
 });
 assert.equal(calls,2);assert.equal(lookups,1);assert.equal(r.inconclusive,true);
});
test('missing older messages does not cause even a second model request',async()=>{
 let calls=0;
 const r=await analyzeWithSingleLookback({
  messages:[row(1)],fetchPrevious:async()=>[],
  askModel:async()=>{calls++;return{needs_previous_context:true,findings:[]}}
 });
 assert.equal(calls,1);assert.equal(r.modelCalls,1);
 assert.equal(r.previousMessages,0);assert.equal(r.inconclusive,true);
});
test('previous context retains cross-boundary reply linkage',async()=>{
 const r=await analyzeWithSingleLookback({
  messages:[row(31)],fetchPrevious:async()=>[row(30)],
  askModel:async p=>p.previousContext?{needs_previous_context:false}:{needs_previous_context:true}
 });
 assert.equal(r.payload.messages[0].replyTo,'c1');
 assert.equal(r.sourceMap.c1.messageId,30);
});
