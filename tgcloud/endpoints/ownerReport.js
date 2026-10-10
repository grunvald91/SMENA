import {actor,handleEndpoint} from '../lib/endpoint.js';
import {makeReport} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>makeReport(actor(ctx),Array.isArray(input?.args)?input.args:[]));}
