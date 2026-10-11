import {actor,handleEndpoint} from '../lib/endpoint.js';
import {ownerControlAction} from '../lib/control.js';
export default async function(input,ctx){return handleEndpoint(()=>ownerControlAction(actor(ctx),input));}
