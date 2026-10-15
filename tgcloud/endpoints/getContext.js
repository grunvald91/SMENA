import {db,api} from 'sdk';
import {eq} from 'sdk/db';
import {employees,locations} from '../schema.js';
import {ownerOrg} from '../lib/service.js';
import {describeOrganizationSelection} from '../lib/organization-selection-service.js';
import {legacyOwnerForSelection} from '../lib/scoped-owner.js';
import {actor,handleEndpoint} from '../lib/endpoint.js';
export default async function(input,ctx){return handleEndpoint(async()=>{
 const tgId=actor(ctx);
 const [bot,legacy,state,employeeRows]=await Promise.all([
  api.getMe(),ownerOrg(tgId),describeOrganizationSelection(tgId),
  db.select().from(employees).where(eq(employees.tgId,tgId)).all()
 ]);
 const org=legacyOwnerForSelection(legacy,state);
 const points=org?await db.select().from(locations).where(eq(locations.orgId,org.id)).all():[];
 return {controlRequested:ctx.initData?.start_param==='control',userId:tgId,botUsername:bot.username||null,
  organizations:state.organizations,selectedOrganization:state.selectedOrganization,
  selectionRequired:state.selectionRequired,
  owner:org?{id:org.id,name:org.name,timezone:org.timezone,locations:points}:null,
  employee:employeeRows.map(x=>({orgId:x.orgId,name:x.name,active:!!x.active})),
  scanToken:(ctx.initData?.start_param||'').startsWith('scan_')?ctx.initData.start_param.slice(5):null};
});}
