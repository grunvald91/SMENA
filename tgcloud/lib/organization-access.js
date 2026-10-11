// Pure access policy. Source rows MUST be loaded by the trusted server.
export const ORGANIZATION_ROLES=Object.freeze(['owner','manager','employee']);
const PERMISSIONS=Object.freeze({
  owner:Object.freeze(['organization.select','organization.view','employees.manage','schedule.manage','locations.manage','devices.manage','payroll.view','roles.manage']),
  manager:Object.freeze(['organization.select','organization.view','employees.manage','schedule.manage','locations.manage','devices.manage']),
  employee:Object.freeze(['organization.select','self.view'])
});
export function validTelegramId(value){
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
}
export function hasPermission(role,permission){
  return Object.hasOwn(PERMISSIONS,role)&&PERMISSIONS[role].includes(permission);
}
export function buildOrganizationAccess(organizations,legacyOwned,memberships){
  const known=new Map(organizations.map(o=>[o.id,o])),access=new Map();
  for(const owned of legacyOwned)if(known.has(owned.id))access.set(owned.id,'owner');
  for(const row of memberships){
    if(!known.has(row.orgId)||row.status!=='active'||!Object.hasOwn(PERMISSIONS,row.role))continue;
    if(access.get(row.orgId)!=='owner')access.set(row.orgId,row.role);
  }
  return [...access.entries()].map(([id,role])=>({id,name:known.get(id).name,role}))
    .sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.id-b.id);
}
export function requirePermission(access,organizationId,permission){
  if(!Number.isSafeInteger(organizationId)||organizationId<=0)throw new Error('Некорректная организация');
  const grant=access.find(o=>o.id===organizationId);
  if(!grant||!hasPermission(grant.role,permission))throw new Error('Недостаточно прав для этой организации');
  return grant;
}
