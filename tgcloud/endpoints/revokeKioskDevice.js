import {actor,handleEndpoint} from '../lib/endpoint.js';
import {revokeKioskDevice} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>revokeKioskDevice(actor(ctx),input?.proof));}
