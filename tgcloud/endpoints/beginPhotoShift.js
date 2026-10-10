import {actor,handleEndpoint} from '../lib/endpoint.js';
import {beginPhotoShift} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>beginPhotoShift(actor(ctx),input?.token,input?.action));}
