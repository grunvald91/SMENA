import {actor,handleEndpoint} from '../lib/endpoint.js';
import {parsePairingCode} from '../lib/kiosk-token.js';
import {enrollDevice} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>enrollDevice(actor(ctx),input?.locationId,input?.pairingCode?parsePairingCode(input.pairingCode.trim()):input?.publicJwk));}
