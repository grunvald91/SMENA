import {completeControl} from '../lib/control.js';
import {actor,handleEndpoint} from '../lib/endpoint.js';
export default async function(input,ctx){return handleEndpoint(()=>completeControl(actor(ctx),input?.submissionId,input?.photos,input?.comment,input?.revision??0));}
