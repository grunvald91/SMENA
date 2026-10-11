import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrganizationAccess,hasPermission,requirePermission,validTelegramId} from '../tgcloud/lib/organization-access.js';
const orgs=[{id:1,name:'Магазин'},{id:2,name:'Салон'},{id:3,name:'Другой бизнес'}];
test('legacy owner remains owner without membership',()=>{
  assert.deepEqual(buildOrganizationAccess(orgs,[orgs[0]],[]),[{id:1,name:'Магазин',role:'owner'}]);
});
test('manager of second company cannot see unrelated company',()=>{
  const a=buildOrganizationAccess(orgs,[orgs[0]],[{orgId:2,role:'manager',status:'active'}]);
  assert.deepEqual(a.map(o=>o.id).sort(),[1,2]);
  assert.throws(()=>requirePermission(a,3,'organization.view'),/Недостаточно прав/);
});
test('membership cannot demote legacy owner',()=>{
  assert.equal(buildOrganizationAccess(orgs,[orgs[0]],[{orgId:1,role:'employee',status:'active'}])[0].role,'owner');
});
test('revoked, invited, unknown and orphaned memberships are ignored',()=>{
  assert.deepEqual(buildOrganizationAccess(orgs,[],[
    {orgId:1,role:'owner',status:'revoked'},
    {orgId:2,role:'manager',status:'invited'},
    {orgId:3,role:'root',status:'active'},
    {orgId:42,role:'owner',status:'active'}]),[]);
});
test('manager cannot manage roles or view payroll',()=>{
  assert.equal(hasPermission('manager','payroll.view'),false);
  assert.equal(hasPermission('manager','roles.manage'),false);
  assert.equal(hasPermission('manager','schedule.manage'),true);
  assert.equal(hasPermission('employee','employees.manage'),false);
  assert.equal(hasPermission('root','organization.view'),false);
});
test('invalid organization IDs and unauthorized scopes fail closed',()=>{
  const a=buildOrganizationAccess(orgs,[],[{orgId:2,role:'employee',status:'active'}]);
  assert.throws(()=>requirePermission(a,2,'employees.manage'),/Недостаточно прав/);
  assert.throws(()=>requirePermission(a,1,'organization.view'),/Недостаточно прав/);
  assert.throws(()=>requirePermission(a,NaN,'organization.view'),/Некорректная организация/);
  assert.equal(validTelegramId('123'),false);
  assert.equal(validTelegramId(0),false);
  assert.equal(validTelegramId(123),true);
});
