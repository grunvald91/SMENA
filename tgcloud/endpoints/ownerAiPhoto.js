import {actor,handleEndpoint} from '../lib/endpoint.js';
import {allowOriginalPhotoTransfer,ownerPhotoContext,analyzeOwnerPhoto} from '../lib/ai-vision.js';
export default async function(input,ctx){
 return handleEndpoint(async()=>{
  const owner=actor(ctx);
  if(input?.action==='permission')return allowOriginalPhotoTransfer(owner,input?.allowed===true);
  if(input?.action==='analyze')return analyzeOwnerPhoto(owner,input?.messageRowId);
  return ownerPhotoContext(owner);
 });
}
