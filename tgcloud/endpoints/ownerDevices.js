import {actor,handleEndpoint} from '../lib/endpoint.js';
import {listActiveDevices} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>listActiveDevices(actor(ctx)));}
