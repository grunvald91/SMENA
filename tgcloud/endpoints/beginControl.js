import {beginControl} from '../lib/control.js';
import {actor,handleEndpoint} from '../lib/endpoint.js';
export default async function(input,ctx){return handleEndpoint(()=>beginControl(actor(ctx),input?.requestId,input?.token));}
