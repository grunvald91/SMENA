import test from 'node:test';
import assert from 'node:assert/strict';
import {validVisionPayload,callVisionProvider} from '../gateway/server.mjs';
import {chooseVisionImage} from '../tgcloud/lib/ai-provider-contract.js';
const photo=()=>{const x=Buffer.alloc(48);x[0]=255;x[1]=216;x[2]=255;x[3]=224;x[46]=255;x[47]=217;return x;};
const payload=()=>({version:1,mode:'vision',sourceRef:'m1',caption:'Проверьте порядок',
 image:{mime:'image/jpeg',base64:photo().toString('base64')}});
test('vision schema accepts bounded complete JPEG',()=>{
 assert.equal(validVisionPayload(payload()),true);
 assert.equal(validVisionPayload({...payload(),sourceRef:'m2'}),false);
 assert.equal(validVisionPayload({...payload(),image:{mime:'image/jpeg',base64:'AAAA'}}),false);
});
test('unavailable preprocessing uses original image when allowed',()=>{
 assert.equal(chooseVisionImage({original:{bytes:photo()},transferAllowed:true}).source,'original');
 assert.equal(chooseVisionImage({original:{bytes:photo()},transferAllowed:false}).ok,false);
});
test('vision provider uses configured visual model and base64 JPEG',async()=>{
 let request;
 const fake=async(url,opts)=>{request=JSON.parse(opts.body);return{ok:true,text:async()=>JSON.stringify({
  choices:[{message:{content:JSON.stringify({findings:[{title:'Состояние',statement:'Требуется дополнительный ракурс',sources:['m1']}]})}}]
 })}};
 const result=await callVisionProvider(payload(),{env:{
  AI_PROVIDER_URL:'https://example.test/chat',AI_PROVIDER_KEY:'TEST_VALUE',AI_PROVIDER_VISION_MODEL:'vision-example'
 },fetchImpl:fake});
 assert.equal(result.findings.length,1);
 assert.equal(request.model,'vision-example');
 assert.match(request.messages[1].content[1].image_url.url,/^data:image\/jpeg;base64,/);
});
