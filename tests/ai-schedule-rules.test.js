import test from 'node:test';
import assert from 'node:assert/strict';
import {moscowClock,deepAnalysisDecision,DEEP_MESSAGE_THRESHOLD,NIGHTLY_HOUR_MSK} from '../tgcloud/lib/ai-schedule-rules.js';

test('Moscow-nightly boundary uses local Moscow time, not server timezone',()=>{
 const before=Date.parse('2026-10-12T23:59:00Z'); // 02:59 next day in Moscow
 const due=Date.parse('2026-10-13T00:01:00Z'); // 03:01 next day in Moscow
 assert.equal(moscowClock(before).hour,2);
 assert.deepEqual(moscowClock(due),{date:'2026-10-13',hour:3});
 assert.equal(deepAnalysisDecision({pendingMessages:3,nowMs:before,lastNightlyDate:'2026-10-12'}).trigger,false);
 const report=deepAnalysisDecision({pendingMessages:3,nowMs:due,lastNightlyDate:'2026-10-12'});
 assert.equal(report.trigger,true);assert.equal(report.reason,'nightly');
});
test('enough messages launch deep analysis in daytime; few messages do not',()=>{
 assert.equal(DEEP_MESSAGE_THRESHOLD,30);
 assert.equal(NIGHTLY_HOUR_MSK,3);
 const midday=Date.parse('2026-10-12T11:00:00Z');
 assert.equal(deepAnalysisDecision({pendingMessages:29,nowMs:midday,lastNightlyDate:'2026-10-12'}).trigger,false);
 const full=deepAnalysisDecision({pendingMessages:30,nowMs:midday,lastNightlyDate:'2026-10-12'});
 assert.equal(full.trigger,true);assert.equal(full.reason,'threshold');
});
test('nightly pass is not called repeatedly and zero events need no model invocation',()=>{
 const ms=Date.parse('2026-10-13T01:00:00Z');
 assert.equal(deepAnalysisDecision({pendingMessages:1,lastNightlyDate:'2026-10-13',nowMs:ms}).trigger,false);
 const empty=deepAnalysisDecision({pendingMessages:0,lastNightlyDate:'2026-10-12',nowMs:ms});
 assert.equal(empty.nightlyWindow,true);assert.equal(empty.trigger,false);assert.equal(empty.reason,'empty');
});
test('edited-message backlog counts toward deep analysis trigger',()=>{
 const ms=Date.parse('2026-10-12T11:00:00Z');
 const trigger=deepAnalysisDecision({pendingMessages:26,pendingChanges:4,lastNightlyDate:'2026-10-12',nowMs:ms});
 assert.equal(trigger.trigger,true);assert.equal(trigger.reason,'threshold');
});
