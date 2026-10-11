import {actor,handleEndpoint} from '../lib/endpoint.js';
import {allowOriginalPhotoTransfer,ownerPhotoContext} from '../lib/ai-vision.js';
export default async function(input,ctx){
 return handleEndpoint(async()=>{
  const owner=actor(ctx);
  if(input?.action==='permission')return allowOriginalPhotoTransfer(owner,input?.allowed===true);
  return ownerPhotoContext(owner);
 });
}
