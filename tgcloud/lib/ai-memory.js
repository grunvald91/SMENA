import {db} from 'sdk';
import {eq,and,gte,lte,desc} from 'sdk/db';
import {locations,aiChatSettings,aiMessages,aiReactions,aiReactionTotals,aiFindings} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput} from './errors.js';
import {normalizeWorkMessage,normalizeReactions,normalizeReactionTotals,reactionActorKey,reviewCandidates} from './ai-rules.js';
const clock=()=>Math.floor(Date.now()/1000);
async function monitoredGroup(chatId){
 const config=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.chatId,chatId),eq(aiChatSettings.active,1))).get();
 return config||null;
}
export async function configureWorkChat(ownerTgId,chatId,enabled){
 const org=await requireOwner(ownerTgId);
 const point=await db.select().from(locations).where(and(eq(locations.chatId,chatId),eq(locations.orgId,org.id))).get();
 requireInput(!!point,'UNBOUND_CHAT','Сначала привяжите рабочую группу к своей точке через /bind');
 const old=await db.select().from(aiChatSettings).where(eq(aiChatSettings.chatId,chatId)).get();
 requireInput(!old||old.orgId===org.id,'FORBIDDEN','Группа принадлежит другой организации');
 const at=clock();
 if(old)await db.update(aiChatSettings).set({active:enabled?1:0,enabledAt:enabled?at:old.enabledAt,enabledBy:ownerTgId}).where(eq(aiChatSettings.chatId,chatId)).run();
 else if(enabled)await db.insert(aiChatSettings).values({chatId,orgId:org.id,active:1,enabledAt:at,enabledBy:ownerTgId}).run();
 return {active:!!enabled,point:point.name};
}
export async function captureWorkMessage(message,{edited=false}={}){
 if(!['group','supergroup'].includes(message?.chat?.type))return false;
 const config=await monitoredGroup(message.chat.id);
 if(!config)return false;
 const row=normalizeWorkMessage(message);if(!row)return false;
 const values={...row,orgId:config.orgId,editedAt:edited?(row.editedAt||clock()):row.editedAt};
 // Exact chat+message id prevents duplicate delivery from creating extra evidence.
 await db.insert(aiMessages).values(values).onConflictDoUpdate({
  target:[aiMessages.chatId,aiMessages.messageId],
  set:{content:values.content,kind:values.kind,fileId:values.fileId,editedAt:values.editedAt,
   replyToMessageId:values.replyToMessageId,threadId:values.threadId}
 }).run();
 return true;
}
export async function captureReaction(reaction){
 const chatId=reaction?.chat?.id,messageId=reaction?.message_id,key=reactionActorKey(reaction);
 if(!chatId||!Number.isSafeInteger(messageId)||!key)return false;
 const config=await monitoredGroup(chatId);if(!config)return false;
 const values={orgId:config.orgId,chatId,messageId,actorKey:key,
  reactions:normalizeReactions(reaction.new_reaction),updatedAt:reaction.date||clock()};
 await db.insert(aiReactions).values(values).onConflictDoUpdate({
  target:[aiReactions.chatId,aiReactions.messageId,aiReactions.actorKey],
  set:{reactions:values.reactions,updatedAt:values.updatedAt}
 }).run();
 return true;
}
export async function captureAnonymousReactionCount(reaction){
 const chatId=reaction?.chat?.id,messageId=reaction?.message_id;
 if(!chatId||!Number.isSafeInteger(messageId))return false;
 const config=await monitoredGroup(chatId);if(!config)return false;
 const values={orgId:config.orgId,chatId,messageId,
  reactions:normalizeReactionTotals(reaction.reactions),updatedAt:reaction.date||clock()};
 await db.insert(aiReactionTotals).values(values).onConflictDoUpdate({
  target:[aiReactionTotals.chatId,aiReactionTotals.messageId],
  set:{reactions:values.reactions,updatedAt:values.updatedAt}
 }).run();
 return true;
}
export async function memoryStatus(ownerTgId){
 const org=await requireOwner(ownerTgId);
 const settings=await db.select().from(aiChatSettings).where(eq(aiChatSettings.orgId,org.id)).all();
 const counts=await db.$count(aiMessages,eq(aiMessages.orgId,org.id));
 const pending=await db.$count(aiFindings,and(eq(aiFindings.orgId,org.id),eq(aiFindings.status,'proposed')));
 return {groups:settings.filter(s=>s.active).length,messages:counts,pending};
}
export async function prepareOwnerReview(ownerTgId,days=14){
 const org=await requireOwner(ownerTgId);
 requireInput(Number.isInteger(days)&&days>=7&&days<=14,'BAD_PERIOD','Период проверки: от 7 до 14 дней');
 const end=clock(),start=end-days*86400;
 const settings=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).all();
 requireInput(settings.length>0,'NO_CHAT','Включите наблюдение в рабочей группе командой /ai_on');
 const records=await db.select().from(aiMessages).where(and(eq(aiMessages.orgId,org.id),gte(aiMessages.sentAt,start),lte(aiMessages.sentAt,end))).orderBy(desc(aiMessages.sentAt)).limit(2000).all();
 const usable=records.filter(m=>settings.some(s=>s.chatId===m.chatId));
 const earliest=Math.min(...settings.map(s=>s.enabledAt));
 const candidates=reviewCandidates(usable);
 // Reactions are evidence, not inherently agreement or task completion.
 const keys=new Set(usable.map(m=>m.chatId+':'+m.messageId));
 const perActor=(await db.select().from(aiReactions).where(eq(aiReactions.orgId,org.id)).orderBy(desc(aiReactions.updatedAt)).limit(2000).all())
  .filter(r=>keys.has(r.chatId+':'+r.messageId));
 const anonymous=(await db.select().from(aiReactionTotals).where(eq(aiReactionTotals.orgId,org.id)).orderBy(desc(aiReactionTotals.updatedAt)).limit(2000).all())
  .filter(r=>keys.has(r.chatId+':'+r.messageId));
 const emojiCount=new Map();
 for(const row of perActor)for(const reaction of (row.reactions||[])){
  if(reaction.type!=='emoji')continue;
  emojiCount.set(reaction.emoji,(emojiCount.get(reaction.emoji)||0)+1);
 }
 const topReactions=[...emojiCount].sort((a,b)=>b[1]-a[1]).slice(0,3);
 for(const [emoji,count] of topReactions){
  const sampled=perActor.filter(row=>(row.reactions||[]).some(x=>x.type==='emoji'&&x.emoji===emoji)).slice(0,5);
  candidates.push({title:'Что означает реакция '+emoji,
   statement:'В доступных сообщениях реакция '+emoji+' встречается '+count+' раз среди сохранённых пользовательских реакций. Уточните, что она обычно означает: прочитано, принято, выполнено или другое.',
   evidence:sampled.map(r=>({chatId:r.chatId,messageId:r.messageId,sentAt:r.updatedAt})),count});
 }
 const created=[];
 for(const suggestion of candidates){
  const existing=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),eq(aiFindings.title,suggestion.title),gte(aiFindings.periodStart,start-86400),lte(aiFindings.periodEnd,end))).orderBy(desc(aiFindings.createdAt)).limit(1).get();
  if(existing){created.push(existing);continue;}
  const [finding]=await db.insert(aiFindings).values({
   orgId:org.id,title:suggestion.title,statement:suggestion.statement,status:'proposed',
   evidence:suggestion.evidence,periodStart:start,periodEnd:end,createdAt:end
  }).returning().run();
  created.push(finding);
 }
 const modelFindings=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),
  eq(aiFindings.origin,'model'),gte(aiFindings.periodEnd,start),lte(aiFindings.periodStart,end)))
  .orderBy(desc(aiFindings.createdAt)).limit(30).all();
 return {days,groups:settings.length,messages:usable.length,limitReached:records.length===2000,
  reactionSampleLimited:perActor.length===2000||anonymous.length===2000,
  reactionsRecorded:perActor.length,anonymousUpdates:anonymous.length,
  fullPeriod:earliest<=start,firstObservedAt:earliest,modelFindings:modelFindings.length,findings:[...modelFindings,...created]};
}
export async function decideFinding(ownerTgId,id,action,correction=''){
 const org=await requireOwner(ownerTgId),statusMap={confirm:'confirmed',reject:'rejected',correct:'corrected'};
 const status=statusMap[action];
 requireInput(!!status,'BAD_REVIEW','Неизвестное действие');
 const item=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),eq(aiFindings.id,Number(id)))).get();
 requireInput(!!item,'NOT_FOUND','Вывод не найден');
 requireInput(item.status==='proposed','ALREADY_REVIEWED','Вывод уже проверен');
 if(action==='correct')requireInput(correction.trim().length>=5&&correction.length<=1000,'BAD_CORRECTION','Уточнение должно содержать 5–1000 символов');
 const saved=await db.update(aiFindings).set({status,reviewedBy:ownerTgId,reviewedAt:clock(),
  correctedStatement:action==='correct'?correction.trim():null}).where(and(eq(aiFindings.id,item.id),eq(aiFindings.orgId,org.id),eq(aiFindings.status,'proposed'))).run();
 requireInput(saved.rowsAffected===1,'ALREADY_REVIEWED','Вывод уже был проверен в другом действии');
 return {id:item.id,status};
}

