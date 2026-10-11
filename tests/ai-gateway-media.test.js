import test from 'node:test';
import assert from 'node:assert/strict';
import {validMediaPayload,callMediaProvider} from '../gateway/server.mjs';
const bytes=(header)=>{const b=Buffer.alloc(40);Buffer.from(header).copy(b);return b.toString('base64');};
const payload=(kind,mime,base64)=>({version:1,mode:'media',sourceRef:'m1',caption:'Рабочий материал',file:{kind,mime,base64}});
test('gateway rejects invalid PDF and unlisted extensions',()=>{
 const pdf=payload('pdf','application/pdf',bytes('%PDF-1.7'));
 assert.equal(validMediaPayload(pdf),true);
 assert.equal(validMediaPayload({...pdf,file:{kind:'pdf',mime:'application/pdf',base64:bytes('HELLO')}}),false);
 assert.equal(validMediaPayload(payload('archive','application/zip',bytes('PKXX'))),false);
});
test('gateway submits PDF as file content, not bare description',async()=>{
 let request;
 const fake=async(url,options)=>{
  request=JSON.parse(options.body);
  return {ok:true,text:async()=>JSON.stringify({
   choices:[{message:{content:JSON.stringify({findings:[{title:'Заявка',statement:'Проверить условия заявки',sources:['m1']}]})}}]
  })};
 };
 const result=await callMediaProvider(payload('pdf','application/pdf',bytes('%PDF-1.7')),{env:{
  AI_PROVIDER_URL:'https://openrouter.ai/api/v1/chat/completions',AI_PROVIDER_KEY:'fake-testing-key',AI_PROVIDER_MODEL:'test/model'
 },fetchImpl:fake});
 assert.equal(result.findings.length,1);
 assert.equal(request.messages[1].content[1].type,'file');
 assert.match(request.messages[1].content[1].file.file_data,/^data:application\/pdf;base64,/);
});
test('voice input uses input_audio format',async()=>{
 let request;
 const fake=async(url,options)=>{
  request=JSON.parse(options.body);
  return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"findings":[]}'}}]})};
 };
 await callMediaProvider(payload('audio','audio/ogg',bytes('OggS')),{env:{
  AI_PROVIDER_URL:'https://openrouter.ai/api/v1/chat/completions',AI_PROVIDER_KEY:'fake-testing-key',AI_PROVIDER_AUDIO_MODEL:'test/audio'
 },fetchImpl:fake});
 assert.equal(request.messages[1].content[1].type,'input_audio');
 assert.equal(request.messages[1].content[1].input_audio.format,'ogg');
});
