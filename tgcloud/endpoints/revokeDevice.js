import {actor,handleEndpoint} from '../lib/endpoint.js';
import {revokeDevice} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>revokeDevice(actor(ctx),input?.deviceId,input?.challengeId,input?.signature));}
