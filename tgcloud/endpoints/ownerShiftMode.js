import {actor,handleEndpoint} from '../lib/endpoint.js';
import {setShiftMode} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>setShiftMode(actor(ctx),input?.locationId,input?.mode));}
