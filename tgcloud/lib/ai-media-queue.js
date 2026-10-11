import {db} from 'sdk';
import {eq,and} from 'sdk/db';
import {aiMessages,aiMediaJobs} from '../schema.js';

// Every accessible attachment is tracked, even if the current extractor cannot
// understand it yet. No silent data loss or "done" status for unsupported media.
export async function enqueueMedia(chatId,messageId){
 const row=await db.select().from(aiMessages)
  .where(and(eq(aiMessages.chatId,chatId),eq(aiMessages.messageId,messageId))).get();
 if(!row?.fileId||!['photo','document','video','voice','audio','animation','video_note','sticker'].includes(row.kind))return false;
 const current=await db.select().from(aiMediaJobs).where(eq(aiMediaJobs.messageRowId,row.id)).get();
 if(current)return false;
 await db.insert(aiMediaJobs).values({messageRowId:row.id,orgId:row.orgId,chatId:row.chatId,
  kind:row.kind,status:row.kind==='photo'?'pending':'awaiting_extractor',attempts:0,nextAttemptAt:0,updatedAt:Math.floor(Date.now()/1000)})
  .onConflictDoUpdate({target:aiMediaJobs.messageRowId,set:{orgId:row.orgId}}).run();
 return true;
}
