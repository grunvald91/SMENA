import test from 'node:test';
import assert from 'node:assert/strict';
import {FIRST_REVIEW_DAYS,FOLLOWUP_DAYS,firstReviewDue,followingReviewDue} from '../tgcloud/lib/ai-calibration-rules.js';

test('first calibration is scheduled exactly 14 days after enabling chat',()=>{
 const enabledAt=Date.parse('2026-10-11T10:00:00Z')/1000;
 assert.equal(FIRST_REVIEW_DAYS,14);
 assert.equal(new Date(firstReviewDue(enabledAt)*1000).toISOString(),'2026-10-25T10:00:00.000Z');
});
test('follow-up interval is seven days after the previous due review',()=>{
 assert.equal(FOLLOWUP_DAYS,7);
 const stamp=1791730000;
 assert.equal(followingReviewDue(stamp)-stamp,7*86400);
});
