import {actor,handleEndpoint} from '../lib/endpoint.js';
import {parsePairingCode} from '../lib/kiosk-token.js';
import {enrollDevice} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>{
 const code=typeof input?.pairingCode==='string'?input.pairingCode.trim():'';
 return enrollDevice(actor(ctx),input?.locationId,code?parsePairingCode(code):input?.publicJwk,{externalKiosk:!!code});
});}
