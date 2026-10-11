import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrganizationSelection } from '../tgcloud/lib/organization-selection.js';
const grants = [{id:3,name:'Мастерская',role:'owner'}, {id:7,name:'Магазин',role:'manager'}];
test('empty organization list is a fresh account, not a failure',()=>{
 assert.deepEqual(resolveOrganizationSelection([],null),{selected:null,selectionRequired:false,count:0});
});
test('single organization is selected automatically for legacy compatibility',()=>{
 assert.equal(resolveOrganizationSelection([grants[0]],null).selected.id,3);
});
test('multiple organizations require explicit choice, never first one',()=>{
 const r=resolveOrganizationSelection(grants,null);
 assert.equal(r.selected,null);assert.equal(r.selectionRequired,true);
});
test('stored organization must be present in CURRENT authorized grants',()=>{
 assert.equal(resolveOrganizationSelection(grants,7).selected.role,'manager');
 const revoked=resolveOrganizationSelection([grants[0]],7);
 assert.equal(revoked.selected.id,3);
 assert.equal(resolveOrganizationSelection(grants,99).selected,null);
});
test('invalid grants cannot be used for UI permissions',()=>{
 assert.throws(()=>resolveOrganizationSelection([{id:1,name:'Магазин',role:'superadmin'}],1),/Invalid/);
 assert.throws(()=>resolveOrganizationSelection(null),/Expected/);
});
