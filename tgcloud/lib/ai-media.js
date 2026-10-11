import {db} from 'sdk';
import {eq,and} from 'sdk/db';
import {aiChatSettings,aiMessages} from '../schema.js';
const clock=()=>Math.floor(Date.now()/1000);
// Photos emitted by this bot are not delivered to the message handler.
export async function capturePublishedPhoto({orgId,chatId,messageId,employeeTgId,fileId,caption,at=clock()}){
 const config=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.chatId,chatId),eq(aiChatSettings.active,1))).get();
 if(!config||config.orgId!==orgId||!Number.isSafeInteger(messageId)||!fileId)return false;
 const content=String(caption||'').slice(0,6000);
 await db.insert(aiMessages).values({orgId,chatId,messageId,threadId:null,
  authorTgId:employeeTgId||null,senderChatId:null,replyToMessageId:null,
  sentAt:at,editedAt:null,kind:'photo',content,fileId,mediaGroupId:null,capturedAt:clock()
 }).onConflictDoUpdate({target:[aiMessages.chatId,aiMessages.messageId],
  set:{fileId,kind:'photo',content}}).run();
 return true;
}
