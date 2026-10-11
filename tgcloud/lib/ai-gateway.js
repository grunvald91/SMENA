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
 return {findings:answer.findings.slice(0,8),usage:answer.usage||null};
}
