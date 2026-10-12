import {db} from 'sdk';
import {eq,and,asc} from 'sdk/db';
import {aiDirtyMessages} from '../schema.js';

export async function markMessageChanged(orgId,chatId,messageId){
 if(!orgId||!chatId||!Number.isSafeInteger(messageId))return;
 const at=Date.now();
 await db.insert(aiDirtyMessages).values({
  orgId,chatId,messageId,updatedAtMs:at,processedAtMs:0
 }).onConflictDoUpdate({
  target:[aiDirtyMessages.orgId,aiDirtyMessages.chatId,aiDirtyMessages.messageId],
  set:{updatedAtMs:at,processedAtMs:0}
 }).run();
}
export async function pendingChangedMessages(orgId,max=10){
 return db.select().from(aiDirtyMessages)
  .where(and(eq(aiDirtyMessages.orgId,orgId),eq(aiDirtyMessages.processedAtMs,0)))
  .orderBy(asc(aiDirtyMessages.updatedAtMs)).limit(max).all();
}
export async function finishChangedMessages(orgId,rows){
 for(const event of rows){
  await db.update(aiDirtyMessages).set({processedAtMs:event.updatedAtMs})
   .where(and(eq(aiDirtyMessages.orgId,orgId),eq(aiDirtyMessages.id,event.id),
    eq(aiDirtyMessages.updatedAtMs,event.updatedAtMs),eq(aiDirtyMessages.processedAtMs,0))).run();
 }
}
