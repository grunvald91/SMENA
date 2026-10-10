import {actor,handleEndpoint} from '../lib/endpoint.js';
import {setLocationName} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>setLocationName(actor(ctx),input?.locationId,input?.name));}
