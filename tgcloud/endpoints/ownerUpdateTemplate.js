import {actor,handleEndpoint} from '../lib/endpoint.js';
import {updateShiftTemplate} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>updateShiftTemplate(actor(ctx),Number(input?.templateId),input?.name,input?.startTime,input?.endTime,input?.graceMinutes??5));}
