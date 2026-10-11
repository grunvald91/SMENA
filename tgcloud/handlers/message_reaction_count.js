import {captureAnonymousReactionCount} from '../lib/ai-memory.js';
export default async function(reaction){
 try{await captureAnonymousReactionCount(reaction);}
 catch(e){console.error('AI anonymous-reaction capture failed',e?.code||e?.name||'unknown');}
}
