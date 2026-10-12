import test from 'node:test';
import assert from 'node:assert/strict';
import {validPayload,validOwnerQuestion,callProvider,callAnswerProvider} from '../gateway/server.mjs';
const event=(ref)=>({ref,group:'точка-1',actor:'сотрудник-псевдоним',day:'2026-10-12',
 kind:'text',text:'Проверка рабочего оборудования',reactions:[],replyTo:null});
const batch=()=>({version:1,mode:'work_chat',messages:[event('m1')],
 confirmedMemory:[],rejectedMemory:[],previousContext:[event('c1')]});
const config={AI_PROVIDER_KEY:'test_key',AI_PROVIDER_MODEL:'test/model'};
test('provider accepts up to 30 historical messages, separate c refs',()=>{
 assert.equal(validPayload(batch()),true);
 assert.equal(validPayload({...batch(),previousContext:Array.from({length:31},(_,i)=>event('c'+(i+1)))}),false);
 assert.equal(validPayload({...batch(),previousContext:[event('m1')]}),false);
 assert.equal(validPayload({...batch(),previousContext:[event('c1'),event('c1')]}),false);
 assert.equal(validOwnerQuestion({...batch(),mode:'owner_question',question:'Что произошло?',
  coverage:{latestEventId:10,lastDeepCursor:8,pendingCount:2,selectedCount:1,unreadMediaCount:0}}),true);
});
test('deep provider transparently returns context shortage',async()=>{
 const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({
  choices:[{message:{content:JSON.stringify({needs_previous_context:true,findings:[]})}}]
 })});
 const r=await callProvider(batch(),{env:config,fetchImpl});
 assert.equal(r.needs_previous_context,true);
 assert.deepEqual(r.findings,[]);
});
test('owner answer can request previous context once, or remain uncertain',async()=>{
 const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({
  choices:[{message:{content:JSON.stringify({
   answer:'',sources:[],needs_previous_context:true,limitations:['Не хватает предыстории']
  })}}]
 })});
 const input={...batch(),mode:'owner_question',question:'Что случилось с заказом?',
  coverage:{latestEventId:10,lastDeepCursor:8,pendingCount:2,selectedCount:1,unreadMediaCount:0}};
 const r=await callAnswerProvider(input,{env:config,fetchImpl});
 assert.equal(r.needs_previous_context,true);
 assert.equal(r.sources.length,0);
});
