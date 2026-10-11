import {db} from 'sdk';
import {eq,and,inArray,lte,gt,asc} from 'sdk/db';
import {organizations,aiChatSettings,aiGatewaySettings,aiAnalysisProgress,aiMessages,aiMediaJobs} from '../schema.js';
import {supportedAttachment} from './ai-media-types.js';
import {analyzeNextBatch} from './ai-analyzer.js';
import {analyzeOwnerPhoto} from './ai-vision.js';
import {analyzeOwnerAttachment} from './ai-attachment.js';
import {maybeSendCalibrationReview} from './ai-calibration.js';
import {pendingChangedMessages} from './ai-dirty.js';

const clock=()=>Math.floor(Date.now()/1000);
const BATCH_SIZE=10,MIN_INTERVAL=15*60,PHOTO_BACKOFF=10*60;

export async function processObservedEvent(chatId,{force=false}={}){
 try{
  const current=await db.select().from(aiChatSettings)
   .where(and(eq(aiChatSettings.chatId,chatId),eq(aiChatSettings.active,1))).get();
  if(!current)return {active:false};
  const org=await db.select().from(organizations).where(eq(organizations.id,current.orgId)).get();
  if(!org?.ownerTgId)return {active:false};
  // Owner calibration does not require an online provider.
  await maybeSendCalibrationReview(chatId);
  const config=await db.select().from(aiGatewaySettings)
   .where(and(eq(aiGatewaySettings.orgId,current.orgId),eq(aiGatewaySettings.active,1))).get();
  if(!config)return {active:true,connected:false};
  const outcome={active:true,connected:true,text:false,photo:false};

  // Durable FIFO processing. Files not supported by the current extractor remain
  // in awaiting_extractor, never silently marked analyzed.
  if(config.allowOriginalPhotos===1||config.allowOriginalFiles===1){
   const jobs=await db.select().from(aiMediaJobs)
    .where(and(eq(aiMediaJobs.orgId,current.orgId),
      inArray(aiMediaJobs.status,['pending','error']),lte(aiMediaJobs.nextAttemptAt,clock())))
    .orderBy(asc(aiMediaJobs.messageRowId)).limit(40).all();
   const chats=await db.select().from(aiChatSettings)
    .where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).all();
   const allowedChats=new Set(chats.map(x=>x.chatId));
   for(const job of jobs){
    if(!allowedChats.has(job.chatId))continue;
    const message=await db.select().from(aiMessages)
     .where(and(eq(aiMessages.orgId,org.id),eq(aiMessages.id,job.messageRowId))).get();
    const mode=supportedAttachment(message);
    if(!mode)continue;
    const permitted=mode.mode==='image'&&message.kind==='photo'?
      config.allowOriginalPhotos===1:config.allowOriginalFiles===1;
    if(!permitted)continue;
    try{
     if(mode.mode==='image'&&message.kind==='photo')await analyzeOwnerPhoto(org.ownerTgId,job.messageRowId);
     else await analyzeOwnerAttachment(org.ownerTgId,job.messageRowId);
     await db.update(aiMediaJobs).set({status:'done',updatedAt:clock()})
      .where(and(eq(aiMediaJobs.messageRowId,job.messageRowId),eq(aiMediaJobs.orgId,org.id))).run();
     outcome.photo=true;
    }catch(e){
     const attempts=(job.attempts||0)+1;
     await db.update(aiMediaJobs).set({status:'error',attempts,
      nextAttemptAt:clock()+Math.min(24*3600,PHOTO_BACKOFF*Math.min(12,attempts)),
      updatedAt:clock()}).where(and(eq(aiMediaJobs.messageRowId,job.messageRowId),eq(aiMediaJobs.orgId,org.id))).run();
     console.warn('AI attachment processing deferred',e?.code||e?.name||'unknown');
    }
    // One slow model call at most in a Telegram event.
    return outcome;
   }
  }

  const progress=await db.select().from(aiAnalysisProgress).where(eq(aiAnalysisProgress.orgId,org.id)).get();
  const cursor=progress?.cursorId||0;
  const page=await db.select().from(aiMessages)
   .where(and(eq(aiMessages.orgId,org.id),gt(aiMessages.id,cursor)))
   .orderBy(asc(aiMessages.id)).limit(BATCH_SIZE).all();
  const dirty=await pendingChangedMessages(org.id,5);
  if(!page.length&&!dirty.length)return outcome;
  const due=force||page.length===BATCH_SIZE||dirty.length===5||!progress?.lastAutoAttemptAt||
   clock()-progress.lastAutoAttemptAt>=MIN_INTERVAL;
  if(!due)return outcome;
  if(progress)await db.update(aiAnalysisProgress).set({lastAutoAttemptAt:clock()})
   .where(eq(aiAnalysisProgress.orgId,org.id)).run();
  try{const batch=await analyzeNextBatch(org.ownerTgId);outcome.text=batch.processed>0;}
  catch(e){console.warn('AI text processing deferred',e?.code||e?.name||'unknown');}
  return outcome;
 }catch(e){
  console.warn('AI automatic event processing deferred',e?.code||e?.name||'unknown');
  return {active:false,deferred:true};
 }
}
