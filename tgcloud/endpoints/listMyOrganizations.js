import {actor,handleEndpoint} from '../lib/endpoint.js';
import {listMyOrganizations} from '../lib/organization-directory.js';
export default async function(input,ctx){
  return handleEndpoint(async()=>({organizations:await listMyOrganizations(actor(ctx))}));
}
