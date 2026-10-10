import {actor,handleEndpoint} from '../lib/endpoint.js';
import {getDeviceChallenge} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>getDeviceChallenge(actor(ctx),input?.deviceId));}
