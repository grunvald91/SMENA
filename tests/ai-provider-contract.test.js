import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareModelTextContext,chooseVisionImage,validateModelHypotheses} from '../tgcloud/lib/ai-provider-contract.js';
test('provider gets bounded text with redacted direct identifiers, no names or financial tables',()=>{
 const payload=prepareModelTextContext([{chatId:-1001,messageId:1,sentAt:100,kind:'text',content:'Позвоните +7 (999) 123-45-67'}]);
 assert.equal(payload.messages.length,1);
 assert.doesNotMatch(payload.messages[0].text,/999/);
 assert.match(payload.messages[0].text,/\[PHONE\]/);
});
test('photo fallback uses original when preprocessing fails but never bypasses transfer authorization',()=>{
 const original={bytes:new Uint8Array([1,2,3])};
 assert.deepEqual(chooseVisionImage({original,transferAllowed:false}),{ok:false,reason:'TRANSFER_NOT_AUTHORIZED'});
 assert.equal(chooseVisionImage({original,transferAllowed:true}).source,'original');
 assert.equal(chooseVisionImage({original,prepared:{bytes:new Uint8Array()},transferAllowed:true}).source,'original');
 assert.equal(chooseVisionImage({original,prepared:{bytes:new Uint8Array([4])},transferAllowed:true}).source,'prepared');
});
test('reject ungrounded model hypotheses and hallucinated message references',()=>{
 const sources=[{chatId:-1001,messageId:1}];
 const output=validateModelHypotheses([{title:'Проблема',statement:'Терминал требует проверки',sources:[{chatId:-1001,messageId:999}]},
  {title:'Проверить',statement:'Сотрудники сообщали об опозданиях',sources}],sources);
 assert.equal(output.length,1);assert.equal(output[0].title,'Проверить');
 assert.equal(output[0].confidence,'low');
});
