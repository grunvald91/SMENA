import {db} from 'sdk';
import {eq,and,desc,inArray} from 'sdk/db';
import {aiMessages,aiFindings,aiMediaJobs,aiChatSettings,aiGatewaySettings,aiAnalysisProgress,employees,aiParticipants} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput} from './errors.js';
import {buildPrivateBatch} from './ai-batch.js';
import {evidenceUrl} from './ai-rules.js';
import {callServGoOwnerAnswer} from './ai-gateway.js';
import {loadOnePreviousContextPage} from './ai-context-fallback.js';
import {analyzeWithSingleLookback} from './ai-context-repair.js';

export const OWNER_CONTEXT_LIMIT=60;
const RECENT_SAMPLE_LIMIT=200;

export function formatOwnerAnswer(reply,sourceMap,coverage){
 const sourceLinks=[...new Set(reply.sources.filter(x=>typeof x==='string'&&Object.hasOwn(sourceMap,x)))]
  .slice(0,8).map(x=>sourceMap[x]).filter(Boolean)
  .map(s=>evidenceUrl(s.chatId,s.messageId)||('Сообщение №'+s.messageId));
 const problems=(Array.isArray(reply.limitations)?reply.limitations:[]).filter(x=>typeof x==='string').slice(0,4);
 if(coverage.pendingCount>0){
  problems.push('Глубокая память ещё не охватила все новые события; в ответ включены последние исходные сообщения.');
 }
 if(coverage.unreadMediaCount>0){
  const n=coverage.unreadMediaCount;
  const label=n%100>=11&&n%100<=14?'файлов':n%10===1?'файл':n%10>=2&&n%10<=4?'файла':'файлов';
  problems.push('Есть '+n+(n>=100?'+':'')+' '+label+', содержимое которых ещё не проверено.');
 }
 if(coverage.sampleLimited){
  problems.push('История длиннее доступной оперативной выборки; выводы не следует считать исчерпывающими.');
 }
 const deduplicated=[...new Set(problems.map(x=>x.slice(0,250)))];
 let answer=String(reply.answer||'').slice(0,2300).trim();
 if(!sourceLinks.length)answer='По доступным сообщениям не найдено подтверждённых источников для содержательного вывода. Уточните вопрос или дождитесь новых данных.';
 if(sourceLinks.length)answer+='\n\nИсточники:\n'+sourceLinks.map(s=>'• '+s).join('\n');
 if(deduplicated.length)answer+='\n\nОграничения:\n'+deduplicated.map(x=>'• '+x).join('\n');
 return answer.slice(0,3850);
}

// Answer immediately from raw chat events up to the current ingestion snapshot.
// This does NOT move deep-analysis progress: foreground and nightly memory work
// stay independent. Evidence refs never leave ServGo in their real form.
export async function answerOwnerFromCurrentEvents(ownerId,question){
 const org=await requireOwner(ownerId);
 const q=String(question||'').trim();
 requireInput(q.length>=3&&q.length<=1000,'AI_QUESTION_LENGTH','Вопрос должен содержать 3–1000 символов');
 const cfg=await db.select().from(aiGatewaySettings)
  .where(and(eq(aiGatewaySettings.orgId,org.id),eq(aiGatewaySettings.active,1))).get();
 requireInput(!!cfg,'AI_NOT_CONFIGURED','Сначала подключите ИИ-шлюз');
 const enabled=await db.select().from(aiChatSettings)
  .where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).all();
 requireInput(enabled.length>0,'NO_CHAT','Нет подключённого рабочего чата');
 const chats=new Set(enabled.map(x=>x.chatId));
 const snapshot=await db.select().from(aiMessages).where(eq(aiMessages.orgId,org.id))
  .orderBy(desc(aiMessages.id)).limit(1).get();
 const latest=snapshot?.id||0;
 const all=await db.select().from(aiMessages).where(eq(aiMessages.orgId,org.id))
  .orderBy(desc(aiMessages.id)).limit(RECENT_SAMPLE_LIMIT).all();
 const usable=all.filter(x=>x.id<=latest&&chats.has(x.chatId));
 if(!usable.length)return 'Пока нет новых сообщений из подключённых рабочих групп. Мне не на чем основывать актуальный вывод.';
 const selected=usable.slice(0,OWNER_CONTEXT_LIMIT).reverse();
 const progress=await db.select().from(aiAnalysisProgress).where(eq(aiAnalysisProgress.orgId,org.id)).get();
 const cursor=progress?.cursorId||0;
 const recentFindings=await db.select().from(aiFindings).where(eq(aiFindings.orgId,org.id))
  .orderBy(desc(aiFindings.createdAt)).limit(30).all();
 const known=recentFindings.filter(x=>['confirmed','corrected','rejected'].includes(x.status));
 const team=await db.select().from(employees).where(eq(employees.orgId,org.id)).limit(200).all();
 const knownActors=await db.select().from(aiParticipants).where(eq(aiParticipants.orgId,org.id)).limit(500).all();
 const aliases=Object.fromEntries(knownActors.map(x=>[x.actorKey,x.alias]));
 const people=team.map(x=>({name:x.name,alias:aliases['u:'+x.tgId]||'[СОТРУДНИК]'}));
 const batchOptions={confirmed:known,employeeNames:people,actorAliases:aliases};

 const rawJobs=await db.select().from(aiMediaJobs).where(eq(aiMediaJobs.orgId,org.id)).limit(100).all();
 const unreadMediaCount=rawJobs.filter(x=>chats.has(x.chatId)&&x.status!=='done').length;
 const sampledPending=usable.filter(x=>x.id>cursor).length;
 const coverage={
  latestEventId:latest,lastDeepCursor:cursor,pendingCount:sampledPending,
  selectedCount:selected.length,unreadMediaCount,
  sampleLimited:all.length===RECENT_SAMPLE_LIMIT||usable.length>OWNER_CONTEXT_LIMIT
 };
 // Reuse the exact business-name redactor used for stored chat evidence.
 const sanitize=value=>buildPrivateBatch([{chatId:0,messageId:1,sentAt:Math.floor(Date.now()/1000),
  content:String(value||'')}],{employeeNames:people}).payload.messages[0].text;
 const safeQuestion=sanitize(q);
 const findingsContext=recentFindings.slice(0,12).map(x=>({
  status:x.status,statement:sanitize(x.correctedStatement||x.statement||'').slice(0,500)
 }));
 const result=await analyzeWithSingleLookback({
  messages:selected,options:batchOptions,
  fetchPrevious:primary=>loadOnePreviousContextPage(org.id,primary,enabled.map(x=>x.chatId)),
  askModel:body=>callServGoOwnerAnswer(cfg.capability,{
   ...body,mode:'owner_question',question:safeQuestion,coverage,
   recentFindings:findingsContext
  })
 });
 let response=result.response;
 const sourceMap=result.sourceMap;
 if(result.inconclusive&&result.previousMessages===0){
  response={answer:'',sources:[],needs_previous_context:true,
   limitations:['Более ранних доступных сообщений для уточнения контекста нет.']};
 }
 if(response.needs_previous_context===true){
  // Do not claim definite outcomes after the single allowed context repair.
  response={answer:'Не удалось уверенно восстановить обстоятельства из доступных сообщений.',
   sources:[],limitations:[...(response.limitations||[]),
    'Дополнительная история проверена не более одного раза. Неопределённость сохранена.']};
 }
 // A query must not falsely advance deep-analysis progress.
 return formatOwnerAnswer(response,sourceMap,coverage);
}
