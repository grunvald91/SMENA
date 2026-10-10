import {actor,handleEndpoint} from '../lib/endpoint.js';
import {deleteShiftAssignment} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>deleteShiftAssignment(actor(ctx),Number(input?.assignmentId)));}
