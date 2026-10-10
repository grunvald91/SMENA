import {actor,handleEndpoint} from '../lib/endpoint.js';
import {assignShift} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>assignShift(actor(ctx),Number(input?.employeeId),Number(input?.templateId),input?.workDate));}
