import {notifyControl} from '../lib/control.js';
import {actor,handleEndpoint} from '../lib/endpoint.js';
export default async function(input,ctx){return handleEndpoint(()=>notifyControl(actor(ctx),input?.requestId));}
