import {captureWorkMessage} from '../lib/ai-memory.js';
export default async function(message){
 try{await captureWorkMessage(message,{edited:true});}
 catch(e){console.error('AI edited-message capture failed',e?.code||e?.name||'unknown');}
}
