import { db,api } from 'sdk';
import { eq } from 'sdk/db';
import { organizations,employees,locations } from '../schema.js';
import { ownerOrg } from '../lib/service.js';
import { actor,handleEndpoint } from '../lib/endpoint.js';
export default async function(input,ctx){return handleEndpoint(async()=>{
 const tgId=actor(ctx),org=await ownerOrg(tgId);
 const [bot,employeeRows,points]=await Promise.all([
  api.getMe(),db.select().from(employees).where(eq(employees.tgId,tgId)).all(),
  org?db.select().from(locations).where(eq(locations.orgId,org.id)).all():Promise.resolve([])
 ]);
 return {controlRequested:ctx.initData?.start_param==='control',userId:tgId,botUsername:bot.username||null,
  owner:org?{id:org.id,name:org.name,timezone:org.timezone,locations:points}:null,
  employee:employeeRows.map(x=>({orgId:x.orgId,name:x.name,active:!!x.active})),
  scanToken:(ctx.initData?.start_param||'').startsWith('scan_')?ctx.initData.start_param.slice(5):null};
});}
