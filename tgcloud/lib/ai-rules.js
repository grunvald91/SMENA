// Pure normalization: no platform dependencies, no LLM-derived facts.
const cap=(value,n=6000)=>String(value||'').slice(0,n);
export function normalizeWorkMessage(message,at=Math.floor(Date.now()/1000)){
 if(!message?.chat?.id||!Number.isSafeInteger(message.message_id))return null;
 const file=message.photo?.at(-1)?.file_id||message.document?.file_id||message.video?.file_id||message.voice?.file_id||message.audio?.file_id||message.animation?.file_id||message.video_note?.file_id||message.sticker?.file_id||null;
 const kind=message.photo?'photo':message.document?'document':message.voice?'voice':message.video?'video':message.audio?'audio':message.animation?'animation':message.video_note?'video_note':message.sticker?'sticker':'text';
 const media=message.document||message.video||message.voice||message.audio||message.animation||message.video_note||message.sticker||message.photo?.at(-1)||null;
 return {chatId:message.chat.id,messageId:message.message_id,
  threadId:message.message_thread_id||null,authorTgId:message.from?.id||null,
  senderChatId:message.sender_chat?.id||null,replyToMessageId:message.reply_to_message?.message_id||null,
  sentAt:Number.isFinite(message.date)?message.date:at,
  editedAt:Number.isFinite(message.edit_date)?message.edit_date:null,
  kind,content:cap(message.text||message.caption||''),
  fileId:file,mediaGroupId:message.media_group_id||null,
  mimeType:media?.mime_type||null,fileName:media?.file_name||null,
  fileSize:Number.isSafeInteger(media?.file_size)?media.file_size:null,capturedAt:at};
}
export function normalizeReactions(values){
 return (Array.isArray(values)?values:[]).slice(0,30).map(x=>{
  if(x?.type==='emoji'&&typeof x.emoji==='string')return {type:'emoji',emoji:cap(x.emoji,16)};
  if(x?.type==='custom_emoji'&&typeof x.custom_emoji_id==='string')return {type:'custom_emoji',id:cap(x.custom_emoji_id,64)};
  if(x?.type==='paid')return {type:'paid'};
  return null;
 }).filter(Boolean);
}
export function reactionActorKey(reaction){
 if(Number.isSafeInteger(reaction?.user?.id))return 'user:'+reaction.user.id;
 if(Number.isSafeInteger(reaction?.actor_chat?.id))return 'chat:'+reaction.actor_chat.id;
 return null;
}
export function normalizeReactionTotals(values){
 return (Array.isArray(values)?values:[]).slice(0,30).map(x=>({
  type:normalizeReactions([x?.type])[0],total:Math.max(0,Math.floor(Number(x?.total_count)||0))
 })).filter(x=>x.type);
}
// A starting set of review *candidates*, not established facts or assessments of employees.
const categories=[
 {key:'equipment',label:'Оборудование и неисправности',pattern:/не работает|сломал|полом|неисправ|ремонт|починил|отключил/iu},
 {key:'schedule',label:'Графики и посещаемость',pattern:/опоздал|опоздани|задержал|подмен|смену|не вышел/iu},
 {key:'tasks',label:'Поручения и выполнение',pattern:/сделайте|проверьте|нужно сделать|выполнено|готово|задача|поручен/iu},
 {key:'stock',label:'Остатки и закупки',pattern:/закончился|закончились|закупить|заказали|поставка|остатки/iu},
 {key:'customers',label:'Клиенты и сервис',pattern:/клиент|жалоб|отзыв|возврат|записал|запись/iu}
];
export function reviewCandidates(messages,{limit=8}={}){
 const result=[];
 for(const type of categories){
  const evidence=messages.filter(m=>type.pattern.test(m.content||''));
  if(evidence.length===0)continue;
  const sources=evidence.slice(0,5).map(m=>({chatId:m.chatId,messageId:m.messageId,sentAt:m.sentAt}));
  result.push({key:type.key,title:type.label,
   statement:'В рабочих сообщениях за период встречалась тема «'+type.label.toLowerCase()+'» ('+evidence.length+' сообщений). Уточните, действительно ли это существенная особенность работы.',
   evidence:sources,count:evidence.length});
 }
 return result.sort((a,b)=>b.count-a.count).slice(0,limit);
}
// Minimal context for external model; replaces obvious direct identifiers before transfer.
// Never treat regex masking as a guarantee of anonymization.
export function redactForModel(text){
 return cap(text,5000)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,'[EMAIL]')
  .replace(/(?:\+7|8)[\s(\-]*\d{3}[)\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/gu,'[PHONE]')
  .replace(/\b(?:\d[ -]*?){16}\b/gu,'[CARD]')
  .replace(/@(?:[A-Za-z0-9_]{5,})/gu,'[USERNAME]');
}

/** Telegram links for private supergroups; ordinary groups have no stable /c link. */
export function evidenceUrl(chatId,messageId){
 const id=String(chatId||'');
 if(!/^-100\d+$/.test(id)||!Number.isSafeInteger(Number(messageId))||Number(messageId)<=0)return null;
 return 'https://t.me/c/'+id.slice(4)+'/'+messageId;
}
