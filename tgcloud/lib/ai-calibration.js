import {db,api} from 'sdk';
import {eq,and,lte} from 'sdk/db';
import {aiCalibrationSchedules,aiChatSettings,organizations} from '../schema.js';
import {prepareOwnerReview} from './ai-memory.js';
import {evidenceUrl} from './ai-rules.js';

import {FIRST_REVIEW_DAYS,firstReviewDue,followingReviewDue} from './ai-calibration-rules.js';
const clock=()=>Math.floor(Date.now()/1000);

export async function ensureCalibrationSchedule(orgId,startedAt){
 const existing=await db.select().from(aiCalibrationSchedules).where(eq(aiCalibrationSchedules.orgId,orgId)).get();
 if(existing)return existing;
 await db.insert(aiCalibrationSchedules).values({
  orgId,dueAt:firstReviewDue(startedAt),busyUntil:0,claimToken:null
 }).onConflictDoNothing().run();
 return db.select().from(aiCalibrationSchedules).where(eq(aiCalibrationSchedules.orgId,orgId)).get();
}

function digest(report){
 const lines=['🧠 ServGo — первая проверка понимания бизнеса',
  'Период: 14 дней. Сообщений в выборке: '+report.messages+'.',
  'Гипотез ИИ: '+(report.modelFindings||0)+'.'];
 if(!report.fullPeriod)lines.push('⚠️ История наблюдений ещё короче 14 дней. Выводы предварительные.');
 if(report.limitReached)lines.push('⚠️ Достигнут предел выборки, картина неполная.');
 if(!report.findings.length)lines.push('Пока нет достаточных оснований для предварительных выводов.');
 for(const finding of report.findings.slice(0,5)){
  lines.push('',(finding.origin==='model'?'ИИ-гипотеза':'Тема')+' #'+finding.id+': '+finding.title,
   (finding.correctedStatement||finding.statement||'').slice(0,360));
  const e=(finding.evidence||[])[0];
  if(e)lines.push('Источник: '+(evidenceUrl(e.chatId,e.messageId)||'сообщение №'+e.messageId));
 }
 lines.push('Это не установленные факты. В личном чате отправьте /ai_review 14, чтобы проверить все выводы и подтвердить или исправить их.');
 return lines.join('\n').slice(0,3700);
}

export async function maybeSendCalibrationReview(chatId){
 const config=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.chatId,chatId),eq(aiChatSettings.active,1))).get();
 if(!config)return false;
 const schedule=await ensureCalibrationSchedule(config.orgId,config.enabledAt);
 const now=clock();
 if(!schedule||schedule.dueAt>now)return false;
 const org=await db.select().from(organizations).where(eq(organizations.id,config.orgId)).get();
 if(!org?.ownerTgId)return false;
 // Advance before send. A failed Telegram delivery will not spam/re-send the owner;
 // manual /ai_review remains available, next due is seven days later.
 const reserved=await db.update(aiCalibrationSchedules).set({
  dueAt:followingReviewDue(now),busyUntil:now+120,claimToken:'sending'
 }).where(and(eq(aiCalibrationSchedules.orgId,config.orgId),lte(aiCalibrationSchedules.dueAt,now))).run();
 if(reserved.rowsAffected!==1)return false;
 try{
  const overview=await prepareOwnerReview(org.ownerTgId,FIRST_REVIEW_DAYS);
  await api.sendMessage({chat_id:org.ownerTgId,text:digest(overview)});
  await db.update(aiCalibrationSchedules).set({lastSentAt:clock(),busyUntil:0,claimToken:null})
   .where(eq(aiCalibrationSchedules.orgId,config.orgId)).run();
  return true;
 }catch(e){
  await db.update(aiCalibrationSchedules).set({busyUntil:0,claimToken:'delivery_unconfirmed'})
   .where(eq(aiCalibrationSchedules.orgId,config.orgId)).run();
  console.warn('AI calibration digest delivery unconfirmed');
  return false;
 }
}
