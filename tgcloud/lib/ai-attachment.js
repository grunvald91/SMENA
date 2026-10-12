import {api,db} from 'sdk';
import {eq,and} from 'sdk/db';
import {aiMessages,aiGatewaySettings,aiChatSettings,aiFindings,employees} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput} from './errors.js';
import {encodeBase64} from './base64.js';
import {supportedAttachment,bytesMatchAttachment} from './ai-media-types.js';
import {buildPrivateBatch,groundBatchFindings} from './ai-batch.js';
import {callServGoMediaGateway} from './ai-gateway.js';
const clock=()=>Math.floor(Date.now()/1000);

// Called by the observed-event worker; never exposed as a button or public endpoint.
export async function analyzeOwnerAttachment(ownerId,messageRowId){
 const org=await requireOwner(ownerId),id=Number(messageRowId);
 requireInput(Number.isSafeInteger(id)&&id>0,'BAD_MEDIA','Некорректный файл');
 const config=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 requireInput(config?.active===1&&config?.allowOriginalFiles===1,'AI_MEDIA_DISABLED','Автоматический анализ файлов не разрешён');
 const row=await db.select().from(aiMessages)
  .where(and(eq(aiMessages.id,id),eq(aiMessages.orgId,org.id))).get();
 requireInput(!!row?.fileId,'MEDIA_MISSING','Вложение не найдено');
 const desc=supportedAttachment(row);
 requireInput(!!desc&&!(row.kind==='photo'&&desc.mode==='image'),'MEDIA_NOT_SUPPORTED','Данный формат обрабатывается другой процедурой');
 const active=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.chatId,row.chatId),eq(aiChatSettings.active,1))).get();
 requireInput(!!active,'CHAT_DISABLED','Наблюдение в группе выключено');
 const file=await api.getFile({file_id:row.fileId});
 requireInput(!file?.file_size||file.file_size<=8000000,'MEDIA_TOO_LARGE','Для файла требуется отдельный большой обработчик');
 const bytes=await api.getFileContent(row.fileId);
 requireInput(bytes?.length<=8000000&&bytesMatchAttachment(desc,bytes),'MEDIA_INVALID_BYTES','Неизвестный или повреждённый формат');
 const people=await db.select().from(employees).where(eq(employees.orgId,org.id)).limit(200).all();
 const {payload,sourceMap}=buildPrivateBatch([row],{employeeNames:people.map(p=>p.name)});
 const response=await callServGoMediaGateway(config.capability,{
  version:1,mode:'media',sourceRef:'m1',
  caption:payload.messages[0]?.text?.slice(0,600)||'',
  file:{kind:desc.mode,mime:desc.mime,base64:encodeBase64(bytes)}
 });
 const findings=groundBatchFindings(response.findings,sourceMap);
 requireInput(response.findings.length===0||findings.length>0,'AI_UNGROUNDED_RESPONSE','Модель не предоставила проверяемых ссылок');
 for(const [i,item] of findings.entries()){
  const key='file:'+id+':'+i;
  const previous=await db.select().from(aiFindings)
   .where(and(eq(aiFindings.orgId,org.id),eq(aiFindings.modelBatchKey,key))).get();
  if(previous)continue;
  await db.insert(aiFindings).values({orgId:org.id,title:item.title,statement:item.statement,
   evidence:item.evidence,status:'proposed',origin:'media',modelBatchKey:key,
   periodStart:row.sentAt,periodEnd:row.sentAt,createdAt:clock()}).run();
 }
 return {findings:findings.length};
}
