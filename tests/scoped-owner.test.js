import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyOwnerForSelection,canManageLegacyOrganization} from '../tgcloud/lib/scoped-owner.js';
const owned={id:42,name:'Магазин'};
const s=(id,role='owner')=>({selectedOrganization:id?{id,role}:null,selectionRequired:false});
test('owner keeps original business when selected',()=>{
 assert.equal(legacyOwnerForSelection(owned,s(42)),owned);
 assert.equal(canManageLegacyOrganization(owned,s(42)),true);
});
test('manager and employee selection does not grant owner actions',()=>{
 assert.equal(legacyOwnerForSelection(owned,s(88,'manager')),null);
 assert.equal(legacyOwnerForSelection(owned,s(42,'employee')),null);
});
test('wrong business, revoked selection or mandatory selection fails closed',()=>{
 assert.equal(legacyOwnerForSelection(owned,s(88)),null);
 assert.equal(legacyOwnerForSelection(owned,s(null)),null);
 assert.equal(legacyOwnerForSelection(owned,{selectedOrganization:null,selectionRequired:true}),null);
});
test('missing legacy owner also fails',()=>{
 assert.equal(legacyOwnerForSelection(null,s(42)),null);
 assert.equal(legacyOwnerForSelection(owned,null),null);
});
