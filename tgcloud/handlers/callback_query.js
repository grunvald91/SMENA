import {api} from 'sdk';
import {decideFinding} from '../lib/ai-memory.js';
export default async function(callback){
 if(!callback?.id||!callback?.from?.id)return;
 const data=/^ai:(confirm|reject):(\d{1,10})$/.exec(callback.data||'');
 if(!data)return;
 try{
  // Never trust callback message/chat: authorization comes from Telegram actor ID.
  if(callback.message?.chat?.type!=='private')throw new Error('PRIVATE_ONLY');
  const r=await decideFinding(callback.from.id,Number(data[2]),data[1]);
  await api.answerCallbackQuery({callback_query_id:callback.id,text:r.status==='confirmed'?'Вывод подтверждён':'Вывод отклонён',show_alert:false});
  if(callback.message?.message_id&&callback.message?.chat?.id){
   await api.editMessageReplyMarkup({chat_id:callback.message.chat.id,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}});
  }
 }catch(e){
  console.warn('AI review callback rejected',e?.code||e?.name||'unknown');
  await api.answerCallbackQuery({callback_query_id:callback.id,text:'Не удалось подтвердить. Проверьте, что вы владелец, и откройте /ai_review в личном чате.',show_alert:true});
 }
}
