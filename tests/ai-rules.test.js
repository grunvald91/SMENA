import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkMessage,normalizeReactions,normalizeReactionTotals,reactionActorKey,reviewCandidates,redactForModel} from '../tgcloud/lib/ai-rules.js';
test('normalizes replies, edits and photo references without inventing content',()=>{
 const row=normalizeWorkMessage({chat:{id:-10017},message_id:44,from:{id:10},date:100,
  edit_date:110,reply_to_message:{message_id:40},photo:[{file_id:'small'},{file_id:'big'}],caption:'Зал убран'});
 assert.equal(row.messageId,44);assert.equal(row.chatId,-10017);
 assert.equal(row.replyToMessageId,40);assert.equal(row.editedAt,110);
 assert.equal(row.fileId,'big');assert.equal(row.kind,'photo');assert.equal(row.content,'Зал убран');
 assert.equal(normalizeWorkMessage({chat:{id:-10017}}),null);
});
test('per-user reactions support change and removal and anonymous counts',()=>{
 assert.equal(reactionActorKey({user:{id:7}}),'user:7');
 assert.equal(reactionActorKey({actor_chat:{id:-8}}),'chat:-8');
 assert.equal(reactionActorKey({}),null);
 assert.deepEqual(normalizeReactions([{type:'emoji',emoji:'👍'},{type:'custom_emoji',custom_emoji_id:'12'}, {type:'unknown'}]),
  [{type:'emoji',emoji:'👍'},{type:'custom_emoji',id:'12'}]);
 assert.deepEqual(normalizeReactions([]),[]);
 assert.deepEqual(normalizeReactionTotals([{type:{type:'emoji',emoji:'🔥'},total_count:3}]),
  [{type:{type:'emoji',emoji:'🔥'},total:3}]);
});
test('review candidates require actual evidence and do not assert findings',()=>{
 assert.deepEqual(reviewCandidates([]),[]);
 const suggestions=reviewCandidates([
  {chatId:-1001,messageId:1,sentAt:1,content:'касса сломалась'},
  {chatId:-1001,messageId:2,sentAt:2,content:'закончились стаканы'},
  {chatId:-1001,messageId:3,sentAt:3,content:'касса не работает'}
 ]);
 assert.equal(suggestions[0].key,'equipment');assert.equal(suggestions[0].count,2);
 assert.deepEqual(suggestions[0].evidence.map(e=>e.messageId),[1,3]);
 assert.match(suggestions[0].statement,/Уточните/);
});
test('external snippets remove direct obvious identifiers',()=>{
 const hidden=redactForModel('Звоните +7 (999) 123-45-67, на a@b.com, @manager_bot');
 assert.doesNotMatch(hidden,/999|a@b.com|@manager_bot/);
 assert.match(hidden,/\[PHONE\]/);assert.match(hidden,/\[EMAIL\]/);
 assert.match(hidden,/\[USERNAME\]/);
});
