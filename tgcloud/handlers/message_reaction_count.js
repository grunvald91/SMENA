import {captureAnonymousReactionCount} from '../lib/ai-memory.js';
import {processObservedEvent} from '../lib/ai-auto.js';
export default async function(reaction){
 try{if(await captureAnonymousReactionCount(reaction))await processObservedEvent(reaction.chat.id);}
 catch(e){console.error('AI anonymous-reaction capture failed',e?.code||e?.name||'unknown');}
}
