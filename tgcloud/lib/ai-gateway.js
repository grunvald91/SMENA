// Telegram Serverless can call only our fixed HTTPS gateway, never a user-supplied URL.
import {fetch as sdkFetch} from 'sdk';
import {requireInput} from './errors.js';

export const AI_GATEWAY_URL='https://ai.servgo.ru/v1/analyze';
export async function callServGoAiGateway(capability,payload){
 requireInput(typeof capability==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(capability),'AI_NOT_CONFIGURED','ИИ-шлюз не настроен');
 requireInput(payload?.version===1&&payload?.mode==='work_chat'&&Array.isArray(payload.messages)&&payload.messages.length<=60,'AI_INVALID','Неверная структура данных для анализа');
 const response=await sdkFetch(AI_GATEWAY_URL,{method:'POST',headers:{
  'content-type':'application/json','authorization':'Bearer '+capability
 },body:JSON.stringify(payload)});
 if(!response.ok){
  // Do not log upstream payload/headers; never leak a gateway token to Telegram.
  if(response.status===401||response.status===403)throw new Error('AI_GATEWAY_UNAUTHORIZED');
  if(response.status===429)throw new Error('AI_GATEWAY_RATE_LIMIT');
  throw new Error('AI_GATEWAY_UNAVAILABLE');
 }
 const answer=await response.json();
 if(!answer||!Array.isArray(answer.findings))throw new Error('AI_INVALID_RESPONSE');
 return {findings:answer.findings.slice(0,8),needs_previous_context:answer.needs_previous_context===true,usage:answer.usage||null};
}

export async function callServGoVisionGateway(capability,payload){
 requireInput(typeof capability==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(capability),'AI_NOT_CONFIGURED','ИИ-шлюз не настроен');
 requireInput(payload?.mode==='vision'&&payload?.sourceRef==='m1'&&payload.image?.mime==='image/jpeg'&&
  typeof payload.image.base64==='string'&&payload.image.base64.length<=10800000,'AI_INVALID_IMAGE','Некорректное изображение');
 const response=await sdkFetch('https://ai.servgo.ru/v1/vision',{method:'POST',headers:{
  'content-type':'application/json','authorization':'Bearer '+capability
 },body:JSON.stringify(payload)});
 if(!response.ok){
  if(response.status===401||response.status===403)throw new Error('AI_GATEWAY_UNAUTHORIZED');
  if(response.status===429)throw new Error('AI_GATEWAY_RATE_LIMIT');
  throw new Error('AI_VISION_UNAVAILABLE');
 }
 const body=await response.json();
 if(!Array.isArray(body?.findings))throw new Error('AI_INVALID_RESPONSE');
 return {findings:body.findings.slice(0,6)};
}

export async function callServGoMediaGateway(capability,payload){
 requireInput(typeof capability==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(capability),'AI_NOT_CONFIGURED','ИИ-шлюз не настроен');
 requireInput(payload?.mode==='media'&&payload.sourceRef==='m1'&&
  typeof payload.file?.base64==='string'&&payload.file.base64.length<=10800000,'AI_INVALID_MEDIA','Некорректный файл');
 const response=await sdkFetch('https://ai.servgo.ru/v1/media',{method:'POST',headers:{
  'content-type':'application/json','authorization':'Bearer '+capability
 },body:JSON.stringify(payload)});
 if(!response.ok){
  if(response.status===401||response.status===403)throw new Error('AI_GATEWAY_UNAUTHORIZED');
  if(response.status===429)throw new Error('AI_GATEWAY_RATE_LIMIT');
  throw new Error('AI_MEDIA_UNAVAILABLE');
 }
 const body=await response.json();
 if(!Array.isArray(body?.findings))throw new Error('AI_INVALID_RESPONSE');
 return {findings:body.findings.slice(0,6)};
}

export async function callServGoOwnerAnswer(capability,payload){
 requireInput(typeof capability==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(capability),'AI_NOT_CONFIGURED','ИИ-шлюз не настроен');
 requireInput(payload?.mode==='owner_question'&&typeof payload.question==='string'&&payload.question.length<=1000&&
  Array.isArray(payload.messages)&&payload.messages.length>0&&payload.messages.length<=60,'AI_INVALID_QUESTION','Не хватает данных для ответа');
 const response=await sdkFetch('https://ai.servgo.ru/v1/answer',{method:'POST',headers:{
  'content-type':'application/json','authorization':'Bearer '+capability
 },body:JSON.stringify(payload)});
 if(!response.ok){
  if([401,403].includes(response.status))throw new Error('AI_GATEWAY_UNAUTHORIZED');
  if(response.status===429)throw new Error('AI_GATEWAY_RATE_LIMIT');
  throw new Error('AI_ANSWER_UNAVAILABLE');
 }
 const body=await response.json();
 if(typeof body?.answer!=='string'||!Array.isArray(body.sources))throw new Error('AI_INVALID_RESPONSE');
 return {answer:body.answer.slice(0,3500),sources:body.sources.slice(0,12),
  needs_previous_context:body.needs_previous_context===true,
  limitations:Array.isArray(body.limitations)?body.limitations.slice(0,5):[]};
}
