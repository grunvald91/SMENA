import {captureWorkMessage} from '../lib/ai-memory.js';
import {processObservedEvent} from '../lib/ai-auto.js';
export default async function(message){
 try{if(await captureWorkMessage(message,{edited:true}))await processObservedEvent(message.chat.id);}
 catch(e){console.error('AI edited-message capture failed',e?.code||e?.name||'unknown');}
}
