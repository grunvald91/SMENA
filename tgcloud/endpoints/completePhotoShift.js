import {actor,handleEndpoint} from '../lib/endpoint.js';
import {completePhotoShift} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>completePhotoShift(actor(ctx),input?.intentId,input?.selfieBase64));}
