import {actor,handleEndpoint} from '../lib/endpoint.js';
import {createShiftTemplate} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>createShiftTemplate(actor(ctx),Number(input?.locationId),input?.name,input?.startTime,input?.endTime,input?.graceMinutes??5));}
