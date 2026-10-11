import test from 'node:test';
import assert from 'node:assert/strict';
import {ONBOARDING_BUTTONS,mainKeyboard,employeeApprovalKeyboard,parseEmployeeApprovalChoice} from '../tgcloud/lib/onboarding-ui.js';
import {buildOrganizationAccess} from '../tgcloud/lib/organization-access.js';

test('owner gets invite and requests buttons without entering Telegram IDs',()=>{
 const rows=mainKeyboard(true,{hasMembership:true}).keyboard.flat().map(b=>b.text);
 assert.ok(rows.includes(ONBOARDING_BUTTONS.invite));
 assert.ok(rows.includes(ONBOARDING_BUTTONS.requests));
 assert.ok(rows.includes(ONBOARDING_BUTTONS.team));
});
test('approval and reject buttons map to request IDs, not employee Telegram IDs',()=>{
 const rows=employeeApprovalKeyboard([{id:91,name:'Александр'},{id:92,name:'Михаил'}]).keyboard;
 assert.equal(rows[0][0].text,'✅ Принять №91');
 assert.equal(rows[1][1].text,'❌ Отклонить №92');
 assert.deepEqual(parseEmployeeApprovalChoice(rows[0][0].text),{requestId:91,approve:true});
 assert.deepEqual(parseEmployeeApprovalChoice(rows[1][1].text),{requestId:92,approve:false});
 assert.equal(parseEmployeeApprovalChoice('✅ Принять №0'),null);
 assert.equal(parseEmployeeApprovalChoice('✅ Принять №9999999999999999999999'),null);
 assert.equal(parseEmployeeApprovalChoice('№91'),null);
 assert.throws(()=>employeeApprovalKeyboard([{id:0,name:'Иван'}]));
});
test('legacy employees grant only employee permission unless explicitly promoted',()=>{
 const orgs=[{id:1,name:'Точка'},{id:2,name:'Магазин'}];
 const legacy=[{orgId:1,status:'active',role:'employee'}];
 const permitted=buildOrganizationAccess(orgs,[],legacy);
 assert.deepEqual(permitted.map(x=>x.role),['employee']);
 const promoted=buildOrganizationAccess(orgs,[],[...legacy,{orgId:1,status:'active',role:'manager'}]);
 assert.equal(promoted[0].role,'manager');
});
