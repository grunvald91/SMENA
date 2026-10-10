import {actor,handleEndpoint} from '../lib/endpoint.js';
import {issueQr} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>issueQr(actor(ctx),input?.deviceId,input?.challengeId,input?.signature));}
