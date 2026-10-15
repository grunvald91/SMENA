import {actor,handleEndpoint} from '../lib/endpoint.js';
import {chooseOrganization} from '../lib/organization-selection-service.js';
export default async function(input,ctx){
  return handleEndpoint(async()=>chooseOrganization(actor(ctx),input?.organizationId));
}
