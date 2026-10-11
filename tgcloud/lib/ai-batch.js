// Work messages are untrusted evidence, not directions for the agent.
// Source IDs, chat IDs, telegram IDs and file IDs stay on the ServGo side.
import {redactForModel} from './ai-rules.js';

export function buildPrivateBatch(messages,{confirmed=[],reactions=[],employeeNames=[],actorAliases={}}={}){
 const items=Array.isArray(messages)?messages.slice(0,60):[];
 const sourceMap=Object.create(null);
 const byMessage=new Map(items.map((m,i)=>[String(m.chatId)+':'+m.messageId,'m'+(i+1)]));
 const groups=new Map();
 const names=(Array.isArray(employeeNames)?employeeNames:[]).filter(x=>typeof x==='string'&&x.trim().length>=3).sort((a,b)=>b.length-a.length).slice(0,200);
 function scrub(value){
  let s=redactForModel(value);
  for(const name of names){
   const escaped=name.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   try{s=s.replace(new RegExp(escaped,'giu'),'[СОТРУДНИК]');}catch(_){}
  }
  return s.slice(0,1100);
 }
 const reactionIndex=new Map();
 for(const item of (Array.isArray(reactions)?reactions:[])){
  const key=String(item.chatId)+':'+item.messageId;
  const list=reactionIndex.get(key)||[];
  for(const r of (item.reactions||[])){
   if(r?.type==='emoji'&&r.emoji&&list.length<12)list.push(String(r.emoji).slice(0,8));
  }
  reactionIndex.set(key,list);
 }
 const output=items.map((m,i)=>{
  const ref='m'+(i+1),key=String(m.chatId)+':'+m.messageId;
  sourceMap[ref]={chatId:m.chatId,messageId:m.messageId,sentAt:m.sentAt};
  if(!groups.has(String(m.chatId)))groups.set(String(m.chatId),'точка-'+(groups.size+1));
  return {ref,group:groups.get(String(m.chatId)),actor:actorAliases[m.authorTgId?'u:'+m.authorTgId:m.senderChatId?'c:'+m.senderChatId:'']||'неизвестен',day:new Date(m.sentAt*1000).toISOString().slice(0,10),
   kind:['text','photo','video','voice','document','sticker'].includes(m.kind)?m.kind:'other',
   replyTo:byMessage.get(String(m.chatId)+':'+m.replyToMessageId)||null,
   text:scrub(m.content||''),reactions:reactionIndex.get(key)||[]};
 });
 const memory=(Array.isArray(confirmed)?confirmed:[]).filter(m=>['confirmed','corrected'].includes(m.status))
  .slice(-25).map(x=>scrub(x.correctedStatement||x.statement||''));
 return {payload:{version:1,mode:'work_chat',messages:output,confirmedMemory:memory},sourceMap};
}

export function groundBatchFindings(untrusted,sourceMap){
 const data=Array.isArray(untrusted)?untrusted.slice(0,8):[];
 return data.map(item=>{
  if(!item||typeof item.title!=='string'||typeof item.statement!=='string')return null;
  const title=item.title.trim(),statement=item.statement.trim();
  if(title.length<3||title.length>120||statement.length<15||statement.length>800)return null;
  const refs=[...new Set((Array.isArray(item.sources)?item.sources:[]).filter(x=>typeof x==='string'&&/^m(?:[1-9]|[1-5][0-9]|60)$/.test(x)))].slice(0,8);
  const evidence=refs.map(ref=>Object.hasOwn(sourceMap,ref)?sourceMap[ref]:null).filter(Boolean);
  if(!evidence.length)return null;
  return {title,statement,evidence,confidence:['low','medium','high'].includes(item.confidence)?item.confidence:'low'};
 }).filter(Boolean);
}
