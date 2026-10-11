import {api,db} from 'sdk';
import {eq,and,desc,lte,inArray} from 'sdk/db';
import {aiMessages,aiGatewaySettings,aiChatSettings,aiPhotoReviews,aiFindings,employees} from '../schema.js';
import {requireOwner} from './service.js';
import {requireInput} from './errors.js';
import {nonce} from './security.js';
import {encodeBase64} from './base64.js';
import {redactForModel,evidenceUrl} from './ai-rules.js';
import {chooseVisionImage} from './ai-provider-contract.js';
import {buildPrivateBatch,groundBatchFindings} from './ai-batch.js';
import {callServGoVisionGateway} from './ai-gateway.js';
const now=()=>Math.floor(Date.now()/1000);

export async function allowOriginalPhotoTransfer(ownerId,allowed){
 const org=await requireOwner(ownerId);
 const cfg=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 requireInput(!!cfg,'AI_NOT_CONFIGURED','Сначала подключите ИИ-шлюз');
 await db.update(aiGatewaySettings).set({allowOriginalPhotos:allowed?1:0}).where(eq(aiGatewaySettings.orgId,org.id)).run();
 return {allowed:!!allowed};
}

export async function ownerPhotoContext(ownerId){
 const org=await requireOwner(ownerId);
 const cfg=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 const active=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).all();
 if(!active.length)return {allowed:cfg?.allowOriginalPhotos===1,photos:[]};
 const ids=active.map(x=>x.chatId);
 const rows=await db.select().from(aiMessages).where(and(eq(aiMessages.orgId,org.id),eq(aiMessages.kind,'photo'),inArray(aiMessages.chatId,ids)))
  .orderBy(desc(aiMessages.id)).limit(20).all();
 const reviews=rows.length?await db.select().from(aiPhotoReviews).where(and(eq(aiPhotoReviews.orgId,org.id),inArray(aiPhotoReviews.messageRowId,rows.map(x=>x.id)))).all():[];
 return {allowed:cfg?.allowOriginalPhotos===1,photos:rows.map(x=>({
  id:x.id,caption:String(x.content||'').slice(0,180),at:x.sentAt,
  link:evidenceUrl(x.chatId,x.messageId),status:reviews.find(r=>r.messageRowId===x.id)?.status||'new'
 }))};
}

export async function analyzeOwnerPhoto(ownerId,messageRowId){
 const org=await requireOwner(ownerId);
 const id=Number(messageRowId);
 requireInput(Number.isSafeInteger(id)&&id>0,'BAD_PHOTO','Некорректное фото');
 const cfg=await db.select().from(aiGatewaySettings).where(eq(aiGatewaySettings.orgId,org.id)).get();
 requireInput(!!cfg?.active,'AI_NOT_CONFIGURED','ИИ-шлюз отключён');
 requireInput(cfg.allowOriginalPhotos===1,'PHOTO_TRANSFER_DISABLED','Разрешите передачу оригиналов в настройках ИИ');
 const image=await db.select().from(aiMessages).where(and(eq(aiMessages.orgId,org.id),eq(aiMessages.id,id),eq(aiMessages.kind,'photo'))).get();
 requireInput(!!image?.fileId,'NOT_FOUND','Фотография не найдена');
 const chat=await db.select().from(aiChatSettings).where(and(eq(aiChatSettings.chatId,image.chatId),eq(aiChatSettings.orgId,org.id),eq(aiChatSettings.active,1))).get();
 requireInput(!!chat,'CHAT_DISABLED','Наблюдение в группе выключено');
 const previous=await db.select().from(aiPhotoReviews).where(and(eq(aiPhotoReviews.orgId,org.id),eq(aiPhotoReviews.messageRowId,id))).get();
 if(previous?.status==='done')return {alreadyDone:true,...previous.result};
 if(!previous)await db.insert(aiPhotoReviews).values({messageRowId:id,orgId:org.id,status:'pending',busyUntil:0})
  .onConflictDoUpdate({target:aiPhotoReviews.messageRowId,set:{orgId:org.id}}).run();
 const t=now(),claim=nonce(20);
 const taken=await db.update(aiPhotoReviews).set({status:'processing',busyUntil:t+120,claimToken:claim})
  .where(and(eq(aiPhotoReviews.messageRowId,id),eq(aiPhotoReviews.orgId,org.id),inArray(aiPhotoReviews.status,['pending','processing','error']),lte(aiPhotoReviews.busyUntil,t))).run();
 requireInput(taken.rowsAffected===1,'AI_BUSY','Это фото уже анализируется');
 try{
  const file=await api.getFile({file_id:image.fileId});
  requireInput(!file?.file_size||file.file_size<=8000000,'IMAGE_TOO_LARGE','Оригинал слишком велик для текущего шлюза');
  const raw=await api.getFileContent(image.fileId);
  requireInput(raw?.length>=24&&raw.length<=8000000&&raw[0]===255&&raw[1]===216&&raw[2]===255&&raw[raw.length-2]===255&&raw[raw.length-1]===217,'BAD_IMAGE','Нужен доступный JPEG');
  // No preprocessing tool is required. The original is used when no prepared photo exists.
  const selection=chooseVisionImage({original:{bytes:raw},prepared:null,transferAllowed:cfg.allowOriginalPhotos===1});
  requireInput(selection.ok,'IMAGE_NOT_AVAILABLE','Фото недоступно');
  const people=await db.select().from(employees).where(eq(employees.orgId,org.id)).limit(200).all();
  const {payload,sourceMap}=buildPrivateBatch([image],{employeeNames:people.map(x=>x.name)});
  const caption=redactForModel(payload.messages[0]?.text||'').slice(0,600);
  const response=await callServGoVisionGateway(cfg.capability,{
   version:1,mode:'vision',sourceRef:'m1',caption,
   image:{mime:'image/jpeg',base64:encodeBase64(selection.image)}
  });
  const valid=groundBatchFindings(response.findings,sourceMap);
  requireInput(response.findings.length===0||valid.length>0,'AI_UNGROUNDED_RESPONSE','Модель не обосновала результат');
  for(const [i,finding] of valid.entries()){
   const key='vision:'+id+':'+i;
   const existing=await db.select().from(aiFindings).where(and(eq(aiFindings.orgId,org.id),eq(aiFindings.modelBatchKey,key))).get();
   if(!existing)await db.insert(aiFindings).values({
    orgId:org.id,title:finding.title,statement:finding.statement,evidence:finding.evidence,
    status:'proposed',origin:'vision',modelBatchKey:key,
    periodStart:image.sentAt,periodEnd:image.sentAt,createdAt:now()
   }).run();
  }
  const result={findings:valid.length,source:evidenceUrl(image.chatId,image.messageId)};
  await db.update(aiPhotoReviews).set({status:'done',busyUntil:0,claimToken:null,completedAt:now(),result})
   .where(and(eq(aiPhotoReviews.messageRowId,id),eq(aiPhotoReviews.claimToken,claim))).run();
  return result;
 }catch(e){
  await db.update(aiPhotoReviews).set({status:'error',busyUntil:0,claimToken:null})
   .where(and(eq(aiPhotoReviews.messageRowId,id),eq(aiPhotoReviews.claimToken,claim))).run();
  throw e;
 }
}
