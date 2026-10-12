import test from 'node:test';
import assert from 'node:assert/strict';
import {validOwnerQuestion,callAnswerProvider} from '../gateway/server.mjs';

const sample=()=>({
 version:1,mode:'owner_question',question:'Что происходит сейчас?',
 messages:[{ref:'m1',group:'точка-1',actor:'участник-1',day:'2026-10-12',
  text:'Задача выполнена; оборудование проверяется.',kind:'text',replyTo:null,reactions:[]}],
 confirmedMemory:['Приоритет — безопасность'],
 rejectedMemory:['Все задачи выполнены своевременно'],
 recentFindings:[{status:'proposed',statement:'Проверить возможную поломку'}],
 coverage:{latestEventId:180,lastDeepCursor:160,pendingCount:20,selectedCount:1,unreadMediaCount:1,sampleLimited:false}
});
test('fresh owner question is validated and does not rely on old cursor as completion',()=>{
 assert.equal(validOwnerQuestion(sample()),true);
 assert.equal(validOwnerQuestion({...sample(),question:''}),false);
 assert.equal(validOwnerQuestion({...sample(),coverage:{...sample().coverage,pendingCount:-2}}),false);
 assert.equal(validOwnerQuestion({...sample(),messages:[]}),false);
});
test('provider uses current raw events and declares incomplete coverage',async()=>{
 let request;
 const fake=async(url,opts)=>{request=JSON.parse(opts.body);return{ok:true,text:async()=>JSON.stringify({
  choices:[{message:{content:JSON.stringify({answer:'В чате обсуждается оборудование.',sources:['m1'],limitations:['Фото ещё не проверено']})}}]
 })}};
 const result=await callAnswerProvider(sample(),{env:{
  AI_PROVIDER_URL:'https://provider.example.test/chat/completions',AI_PROVIDER_KEY:'test-only',
  AI_PROVIDER_MODEL:'demo/model'
 },fetchImpl:fake});
 assert.deepEqual(result.sources,['m1']);assert.equal(result.limitations.length,1);
 assert.ok(request.messages[0].content.includes('СВЕЖИХ'));
 assert.ok(request.messages[1].content.includes('pendingCount'));
 assert.ok(!request.messages[1].content.includes('https://t.me/c/'));
});
test('provider failure must not be represented as a successful answer',async()=>{
 await assert.rejects(callAnswerProvider(sample(),{env:{
  AI_PROVIDER_KEY:'test-only',AI_PROVIDER_MODEL:'demo'
 },fetchImpl:async()=>({ok:false,status:500})}),/PROVIDER_HTTP_500/);
});
