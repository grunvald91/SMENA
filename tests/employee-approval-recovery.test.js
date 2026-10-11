import test from 'node:test';
import assert from 'node:assert/strict';
import {APPROVAL_STALE_SECONDS,staleApprovalAction} from '../tgcloud/lib/employee-approval-recovery.js';
const time=1800000000;
test('interrupted employee approval returns pending if employee was never activated',()=>{
 assert.equal(staleApprovalAction({status:'approving',updatedAt:time-601},null,time),'pending');
});
test('approval with already activated employee is recovered as approved without another insert',()=>{
 assert.equal(staleApprovalAction({status:'approving',updatedAt:time-601},{active:1},time),'approved');
});
test('live operations are never recovered concurrently',()=>{
 assert.equal(staleApprovalAction({status:'approving',updatedAt:time-APPROVAL_STALE_SECONDS+1},{active:1},time),null);
 assert.equal(staleApprovalAction({status:'approved',updatedAt:time-601},null,time),null);
 assert.equal(staleApprovalAction({status:'pending',updatedAt:time-601},null,time),null);
});
