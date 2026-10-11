import {captureReaction} from '../lib/ai-memory.js';
export default async function(reaction){
 try{await captureReaction(reaction);}
 catch(e){console.error('AI reaction capture failed',e?.code||e?.name||'unknown');}
}
