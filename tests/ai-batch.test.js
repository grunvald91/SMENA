import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateBatch,groundBatchFindings} from '../tgcloud/lib/ai-batch.js';

test('model input hides identifiers while preserving stable pseudonyms, reply and reaction',()=>{
 const messages=[
  {chatId:-100999,messageId:31,sentAt:1760200000,authorTgId:888,kind:'text',content:'Александр Иванов: касса не работает. Звони +7 (999) 123-45-67'},
  {chatId:-100999,messageId:32,sentAt:1760200020,authorTgId:888,replyToMessageId:31,kind:'text',content:'Проверю'}
 ];
 const data=buildPrivateBatch(messages,{employeeNames:['Александр Иванов'],
  actorAliases:{'u:888':'участник-random'},reactions:[{chatId:-100999,messageId:31,reactions:[{type:'emoji',emoji:'👍'}]}]});
 const str=JSON.stringify(data.payload);
 assert.doesNotMatch(str,/100999|888|Александр Иванов|999|messageId|chatId/);
 assert.equal(data.payload.messages[0].actor,'участник-random');
 assert.equal(data.payload.messages[1].replyTo,'m1');
 assert.deepEqual(data.payload.messages[0].reactions,['👍']);
 assert.equal(data.sourceMap.m1.messageId,31);
});
test('hallucinated sources are rejected, only grounded findings accepted',()=>{
 const {sourceMap}=buildPrivateBatch([{chatId:-10055,messageId:8,sentAt:1760200000,content:'сломался терминал'}]);
 const out=groundBatchFindings([
  {title:'Поломка',statement:'Терминал мог перестать работать, нужна проверка.',sources:['m999'],confidence:'high'},
  {title:'Терминал',statement:'В чате упомянута возможная поломка терминала.',sources:['m1'],confidence:'medium'}
 ],sourceMap);
 assert.equal(out.length,1);assert.equal(out[0].evidence[0].messageId,8);
});
test('empty or unusable model output creates no claims',()=>{
 assert.deepEqual(groundBatchFindings([{title:'Без доказательств',statement:'Большая недоказанная гипотеза',sources:[]}],{}),[]);
});
