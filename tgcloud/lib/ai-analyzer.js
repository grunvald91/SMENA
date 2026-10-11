import {db} from 'sdk';
import {eq,and,gt,asc,inArray,desc,lte} from 'sdk/db';
import {aiMessages,aiReactions,aiFindings,aiGatewaySettings,aiAnalysisProgress,aiChatSettings,employees} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput} from './errors.js';
import {nonce} from './security.js';
import {buildPrivateBatch,groundBatchFindings} from './ai-batch.js';
import {callServGoAiGateway} from './ai-gateway.js';
const clock=()=>Math.floor(Date.now()/1000);

export async function configureAiGateway(ownerTgId,capability,enabled=true){
 const org=await requireOwner(ownerTgId);
 // This is a limited gateway capability, NEVER a model API key.
 if(enabled)requireInput(typeof capability==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(capability),'BAD_GATEWAY_TOKEN','Нужен ключ доступа к шлюзу ServGo');
 const found=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 if(!enabled){
  if(found)await db.update(aiGatewaySettings).set({active:0}).where(eq(aiGatewaySettings.orgId,org.id)).run();
  return {configured:!!found,active:false};
 }
 const values={capability,active:1,configuredAt:clock()};
 if(found)await db.update(aiGatewaySettings).set(values).where(eq(aiGatewaySettings.orgId,org.id)).run();
 else await db.insert(aiGatewaySettings).values({orgId:org.id,...values}).run();
 return {configured:true,active:true};
}

export async function aiProcessingStatus(ownerTgId){
 const org=await requireOwner(ownerTgId);
 const config=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 const progress=await db.select().from(aiAnalysisProgress).where(eq(aiAnalysisProgress.orgId,org.id)).get();
 const last=await db.select().from(aiMessages).where(eq(aiMessages.orgId,org.id)).orderBy(desc(aiMessages.id)).limit(1).get();
 return {configured:!!config?.active,cursor:progress?.cursorId||0,latest:last?.id||0,pending:Math.max(0,(last?.id||0)-(progress?.cursorId||0))};
}

// At most ONE bounded model call per invocation. Retry same batch on error.
// This avoids spending provider tokens on every Telegram message.
export async function analyzeNextBatch(ownerTgId){
 const org=await requireOwner(ownerTgId);
 const config=await db.select().from(aiGatewaySettings).where(and(eq(aiGatewaySettings.orgId,org.id),eq(aiGatewaySettings.active,1))).get();
 requireInput(!!config,'AI_NOT_CONFIGURED','ИИ-шлюз пока не настроен');
 const enabled=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).all();
 requireInput(enabled.length>0,'NO_CHAT','Сначала включите наблюдение в рабочей группе');
 const now=clock(),lock=nonce(24);
 await db.insert(aiAnalysisProgress).values({orgId:org.id,cursorId:0,busyUntil:0,lockToken:null,updatedAt:now})
  .onConflictDoUpdate({target:aiAnalysisProgress.orgId,set:{updatedAt:now}}).run();
 const got=await db.update(aiAnalysisProgress).set({busyUntil:now+120,lockToken:lock,updatedAt:now})
  .where(and(eq(aiAnalysisProgress.orgId,org.id),lte(aiAnalysisProgress.busyUntil,now))).run();
 requireInput(got.rowsAffected===1,'AI_BUSY','Предыдущая проверка ещё выполняется');
 try{
  const progress=await db.select().from(aiAnalysisProgress).where(eq(aiAnalysisProgress.orgId,org.id)).get();
  const page=await db.select().from(aiMessages).where(and(eq(aiMessages.orgId,org.id),gt(aiMessages.id,progress.cursorId)))
   .orderBy(asc(aiMessages.id)).limit(60).all();
  if(!page.length)return {processed:0,proposed:0,remaining:false};
  const authorized=new Set(enabled.map(c=>c.chatId));
  const messages=page.filter(m=>authorized.has(m.chatId));
  const lastId=page.at(-1).id;
  if(!messages.length){
   await db.update(aiAnalysisProgress).set({cursorId:lastId,updatedAt:clock()})
    .where(and(eq(aiAnalysisProgress.orgId,org.id),eq(aiAnalysisProgress.lockToken,lock))).run();
   return {processed:page.length,proposed:0,skipped:page.length};
  }
  const first=messages[0].sentAt,last=messages.at(-1).sentAt;
  const confirmed=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),inArray(aiFindings.status,['confirmed','corrected'])))
   .orderBy(desc(aiFindings.reviewedAt)).limit(25).all();
  const ids=messages.map(x=>x.messageId);
  const reactions=await db.select().from(aiReactions).where(and(eq(aiReactions.orgId,org.id),inArray(aiReactions.messageId,ids))).limit(400).all();
  const team=await db.select().from(employees).where(eq(employees.orgId,org.id)).limit(200).all();
  const {payload,sourceMap}=buildPrivateBatch(messages,{confirmed,reactions:reactions.filter(r=>messages.some(m=>r.chatId===m.chatId&&r.messageId===m.messageId)),employeeNames:team.map(x=>x.name)});
  const response=await callServGoAiGateway(config.capability,payload);
  const candidates=groundBatchFindings(response.findings,sourceMap);
  let proposed=0;
  for(const [i,item] of candidates.entries()){
   // Stable key stops duplicate findings if a request succeeded but cursor update failed.
   const batchKey=page[0].id+':'+lastId+':'+i;
   const existing=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),eq(aiFindings.modelBatchKey,batchKey))).get();
   if(existing)continue;
   await db.insert(aiFindings).values({orgId:org.id,title:item.title,statement:item.statement,
    evidence:item.evidence,periodStart:first,periodEnd:last,status:'proposed',origin:'model',
    modelBatchKey:batchKey,createdAt:clock()}).run();
   proposed++;
  }
  const changed=await db.update(aiAnalysisProgress).set({cursorId:lastId,updatedAt:clock()})
   .where(and(eq(aiAnalysisProgress.orgId,org.id),eq(aiAnalysisProgress.lockToken,lock),eq(aiAnalysisProgress.cursorId,progress.cursorId))).run();
  requireInput(changed.rowsAffected===1,'AI_PROGRESS_CONFLICT','Прогресс анализа изменился');
  return {processed:page.length,proposed,through:lastId,modelUsed:true};
 }finally{
  // Lock does not prevent normal attendance/QR operations, even on API failure.
  await db.update(aiAnalysisProgress).set({busyUntil:0,lockToken:null,updatedAt:clock()})
   .where(and(eq(aiAnalysisProgress.orgId,org.id),eq(aiAnalysisProgress.lockToken,lock))).run();
 }
}
