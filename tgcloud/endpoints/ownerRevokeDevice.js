import {actor,handleEndpoint} from '../lib/endpoint.js';
import {ownerRevokeDevice} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>ownerRevokeDevice(actor(ctx),input?.locationId,input?.deviceId));}
