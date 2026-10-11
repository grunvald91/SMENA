import {db} from 'sdk';
import {eq,and,desc,inArray,lte,gt,asc} from 'sdk/db';
import {organizations,aiChatSettings,aiGatewaySettings,aiAnalysisProgress,aiMessages,aiPhotoReviews} from '../schema.js';
import {analyzeNextBatch} from './ai-analyzer.js';
import {analyzeOwnerPhoto} from './ai-vision.js';
import {maybeSendCalibrationReview} from './ai-calibration.js';

const clock=()=>Math.floor(Date.now()/1000);
const BATCH_SIZE=10;
const MIN_INTERVAL=15*60;
const PHOTO_BACKOFF=10*60;

// This is an event-driven worker. It never needs an owner to press "analyze".
// It is safe to call after a new message, edit, reaction or bot-posted image.
// External provider calls are isolated from attendance and never edit payroll.
export async function processObservedEvent(chatId,{force=false}={}){
 try{
  const current=await db.select().from(aiChatSettings)
   .where(and(eq(aiChatSettings.chatId,chatId),eq(aiChatSettings.active,1))).get();
  if(!current)return {active:false};
  const org=await db.select().from(organizations).where(eq(organizations.id,current.orgId)).get();
  if(!org?.ownerTgId)return {active:false};
  const settings=await db.select().from(aiGatewaySettings)
   .where(and(eq(aiGatewaySettings.orgId,current.orgId),eq(aiGatewaySettings.active,1))).get();

  // Calendar review remains independent of provider availability.
  await maybeSendCalibrationReview(chatId);
  if(!settings)return {active:true,connected:false};

  const result={active:true,connected:true,text:false,photo:false};
  if(settings.allowOriginalPhotos===1){
   const photos=await db.select().from(aiMessages)
    .where(and(eq(aiMessages.orgId,current.orgId),eq(aiMessages.kind,'photo')))
    .orderBy(desc(aiMessages.id)).limit(80).all();
   const relevant=photos.filter(x=>x.fileId);
   if(relevant.length){
    const known=await db.select().from(aiPhotoReviews).where(and(eq(aiPhotoReviews.orgId,current.orgId),
     inArray(aiPhotoReviews.messageRowId,relevant.map(x=>x.id)))).all();
    const pending=relevant.slice().reverse().find(p=>{
     const review=known.find(x=>x.messageRowId===p.id);
     return !review||(review.status==='error'&&review.busyUntil<=clock())||
       (review.status==='pending'&&review.busyUntil<=clock());
    });
    if(pending){
     try{await analyzeOwnerPhoto(org.ownerTgId,pending.id);result.photo=true;}
     catch(e){console.warn('AI automatic photo review unavailable',e?.code||e?.name||'unknown');}
    }
   }
  }

  const progress=await db.select().from(aiAnalysisProgress)
   .where(eq(aiAnalysisProgress.orgId,current.orgId)).get();
  const cursor=progress?.cursorId||0;
  const page=await db.select().from(aiMessages)
   .where(and(eq(aiMessages.orgId,current.orgId),gt(aiMessages.id,cursor)))
   .orderBy(asc(aiMessages.id)).limit(BATCH_SIZE).all();
  if(!page.length)return result;
  const due=force||page.length>=BATCH_SIZE||!progress?.lastAutoAttemptAt||
   clock()-progress.lastAutoAttemptAt>=MIN_INTERVAL;
  if(!due)return result;
  // Gate repeated failures. An already-running analysis still fails closed
  // with AI_BUSY; the next observed event or the scheduler can retry.
  if(progress)await db.update(aiAnalysisProgress)
   .set({lastAutoAttemptAt:clock()}).where(eq(aiAnalysisProgress.orgId,current.orgId)).run();
  try{const batch=await analyzeNextBatch(org.ownerTgId);result.text=batch.processed>0;}
  catch(e){console.warn('AI automatic text analysis unavailable',e?.code||e?.name||'unknown');}
  return result;
 }catch(e){
  // This is an ancillary subsystem. A provider outage cannot fail shift attendance.
  console.warn('AI event processing deferred',e?.code||e?.name||'unknown');
  return {active:false,deferred:true};
 }
}
