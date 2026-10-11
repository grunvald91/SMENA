import {actor,handleEndpoint} from '../lib/endpoint.js';
import {describeOrganizationSelection} from '../lib/organization-selection-service.js';
export default async function(input,ctx){
  return handleEndpoint(async()=>describeOrganizationSelection(actor(ctx)));
}
