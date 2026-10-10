import {actor,handleEndpoint} from '../lib/endpoint.js';
import {dashboardOverview} from '../lib/service.js';
export default async function(input,ctx){return handleEndpoint(()=>dashboardOverview(actor(ctx),Array.isArray(input?.args)?input.args:[]));}
