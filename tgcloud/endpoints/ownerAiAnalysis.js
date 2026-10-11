import {actor,handleEndpoint} from '../lib/endpoint.js';
import {configureAiGateway,aiProcessingStatus,analyzeNextBatch} from '../lib/ai-analyzer.js';
import {allowOriginalPhotoTransfer} from '../lib/ai-vision.js';
export default async function(input,ctx){
 return handleEndpoint(async()=>{
  const who=actor(ctx);
  if(input?.action==='configure'){
   const status=await configureAiGateway(who,input?.capability,true);
   await allowOriginalPhotoTransfer(who,input?.allowOriginalPhotos===true);
   return status;
  }
  if(input?.action==='disable')return configureAiGateway(who,null,false);
  if(input?.action==='analyze')return analyzeNextBatch(who);
  return aiProcessingStatus(who);
 });
}
