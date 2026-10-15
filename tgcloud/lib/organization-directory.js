import {db} from 'sdk';
import {eq,inArray,and} from 'sdk/db';
import {organizations,organizationMemberships,employees} from '../schema.js';
import {DomainError} from './errors.js';
import {buildOrganizationAccess,requirePermission,validTelegramId} from './organization-access.js';
// Read-only access. Do not route legacy owner-only mutators through a client orgId yet.
export async function listMyOrganizations(telegramId){
  if(!validTelegramId(telegramId))throw new DomainError('UNAUTHORIZED','Нет Telegram ID');
  const [owned,memberships,activeEmployees]=await Promise.all([
    db.select().from(organizations).where(eq(organizations.ownerTgId,telegramId)).all(),
    db.select().from(organizationMemberships).where(and(
      eq(organizationMemberships.userTgId,telegramId),
      eq(organizationMemberships.status,'active')
    )).all(),
    db.select().from(employees).where(and(eq(employees.tgId,telegramId),eq(employees.active,1))).all()
  ]);
  const ids=[...new Set([...owned.map(o=>o.id),...memberships.map(m=>m.orgId),...activeEmployees.map(e=>e.orgId)])];
  if(!ids.length)return [];
  const existing=await db.select().from(organizations).where(inArray(organizations.id,ids)).all();
  return buildOrganizationAccess(existing,owned,[...activeEmployees.map(e=>({orgId:e.orgId,role:'employee',status:'active'})),...memberships]);
}
export async function requireOrganizationPermission(telegramId,organizationId,permission){
  const access=await listMyOrganizations(telegramId);
  try{return requirePermission(access,organizationId,permission);}
  catch{throw new DomainError('FORBIDDEN','Нет доступа к выбранной организации');}
}
