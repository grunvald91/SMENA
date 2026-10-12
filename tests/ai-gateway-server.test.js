import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authorize,validPayload,callProvider} from '../gateway/server.mjs';

const token='a'.repeat(48),digest=createHash('sha256').update(token).digest('hex');
const example={version:1,mode:'work_chat',messages:[{ref:'m1',group:'точка-1',actor:'участник-a',text:'сломалась касса',reactions:[],kind:'text',day:'2026-10-11'}],confirmedMemory:[]};
test('gateway capability check fails closed',()=>{
 assert.equal(authorize(token,[digest]),true);
 assert.equal(authorize('b'.repeat(48),[digest]),false);
 assert.equal(authorize(token,[]),false);
});
test('reject oversized, malformed and duplicate source payloads',()=>{
 assert.equal(validPayload(example),true);
 assert.equal(validPayload({...example,messages:[example.messages[0],example.messages[0]]}),false);
 assert.equal(validPayload({...example,messages:[]}),false);
 assert.equal(validPayload({...example,messages:[{...example.messages[0],text:'x'.repeat(1101)}]}),false);
});
test('upstream adapter uses env token and requests JSON proposals',async()=>{
 let call;
 const fetchImpl=async(url,options)=>{call={url,options};return {ok:true,text:async()=>JSON.stringify({
  choices:[{message:{content:JSON.stringify({findings:[{title:'Касса',statement:'Нужно проверить терминал',sources:['m1']}]})}}],
  usage:{prompt_tokens:200,completion_tokens:40}})}};
 const result=await callProvider(example,{env:{AI_PROVIDER_URL:'https://openrouter.ai/api/v1/chat/completions',AI_PROVIDER_KEY:'test-secret',AI_PROVIDER_MODEL:'demo/model'},fetchImpl});
 assert.equal(result.findings.length,1);assert.equal(result.usage.inputTokens,200);
 assert.equal(call.options.headers.authorization,'Bearer test-secret');
 assert.match(call.options.body,/json_object/);
 assert.doesNotMatch(call.options.body,/chatId|messageId|telegram_id/);
});
test('upstream failures and missing secrets are not silently accepted',async()=>{
 await assert.rejects(callProvider(example,{env:{}}),/PROVIDER_UNCONFIGURED/);
 await assert.rejects(callProvider(example,{env:{AI_PROVIDER_KEY:'a',AI_PROVIDER_MODEL:'m'},fetchImpl:async()=>({ok:false,status:429})}),/PROVIDER_HTTP_429/);
});
