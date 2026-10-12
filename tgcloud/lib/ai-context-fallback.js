// Context repair is deliberately bounded: just one previous-page lookup
// (up to 30 messages in total) and at most one second model invocation.
// No loops, recursive lookups, or paging through the entire business history.
import {db} from 'sdk';
import {and,eq,lt,desc} from 'sdk/db';
import {aiMessages} from '../schema.js';

export const PREVIOUS_CONTEXT_LIMIT=30;

export async function loadOnePreviousContextPage(orgId,primary,allowedChatIds){
 const allowed=new Set(allowedChatIds||[]);
 const earliestByChat=new Map();
 for(const row of primary||[]){
  if(!allowed.has(row.chatId)||!Number.isSafeInteger(row.id))continue;
  const previous=earliestByChat.get(row.chatId);
  if(previous===undefined||row.id<previous)earliestByChat.set(row.chatId,row.id);
 }
 const candidates=[];
 // Per-chat bounds matter: a large mixed-company batch must never pull the
 // wrong group's messages just because their IDs happen to be nearby.
 for(const [chatId,beforeId] of earliestByChat){
  const page=await db.select().from(aiMessages).where(and(
   eq(aiMessages.orgId,orgId),eq(aiMessages.chatId,chatId),
   lt(aiMessages.id,beforeId)))
   .orderBy(desc(aiMessages.id)).limit(PREVIOUS_CONTEXT_LIMIT).all();
  candidates.push(...page);
 }
 // One single additional page for the whole request, not 30 per group.
 return candidates.sort((a,b)=>b.id-a.id).slice(0,PREVIOUS_CONTEXT_LIMIT)
  .sort((a,b)=>a.id-b.id);
}
