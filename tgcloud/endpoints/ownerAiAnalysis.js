import {actor,handleEndpoint} from '../lib/endpoint.js';
import {configureAiGateway,aiProcessingStatus,analyzeNextBatch} from '../lib/ai-analyzer.js';
export default async function(input,ctx){
 return handleEndpoint(async()=>{
  const who=actor(ctx);
  if(input?.action==='configure')return configureAiGateway(who,input?.capability,true);
  if(input?.action==='disable')return configureAiGateway(who,null,false);
  if(input?.action==='analyze')return analyzeNextBatch(who);
  return aiProcessingStatus(who);
 });
}
