import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTemplate,templateWindow,chooseAssignment,daysAround} from '../tgcloud/lib/roster.js';
import {DomainError} from '../tgcloud/lib/errors.js';
const template=(id,name,startTime,endTime,graceMinutes=5)=>({id,name,startTime,endTime,graceMinutes});
test('different morning and evening shift end times',()=>{
 const morning=template(1,'Утренняя','09:00','15:00');
 const evening=template(2,'Вечерняя','15:00','21:00');
 const a=templateWindow('2026-10-10',morning,'Europe/Moscow');
 const b=templateWindow('2026-10-10',evening,'Europe/Moscow');
 assert.equal(new Date(a.startAt*1000).toISOString(),'2026-10-10T06:00:00.000Z');
 assert.equal(new Date(a.endAt*1000).toISOString(),'2026-10-10T12:00:00.000Z');
 assert.equal(a.endAt,b.startAt);assert.equal(b.endAt-a.endAt,6*3600);
});
test('assigned employee is matched to their shift, not location opening hours',()=>{
 const tt=[template(1,'Утренняя','09:00','15:00'),template(2,'Вечерняя','15:00','21:00')];
 const aa=[{id:5,templateId:1,workDate:'2026-10-10'}];
 const selected=chooseAssignment(Date.parse('2026-10-10T06:06:00Z')/1000,'Europe/Moscow',aa,tt);
 assert.equal(selected.templateId,1);
 assert.equal(selected.assignmentId,5);
 assert.equal(new Date(selected.endAt*1000).toISOString(),'2026-10-10T12:00:00.000Z');
});
test('evening employee cannot check in as unassigned morning',()=>{
 const tt=[template(1,'Утренняя','09:00','15:00'),template(2,'Вечерняя','15:00','21:00')];
 const aa=[{id:7,templateId:2,workDate:'2026-10-10'}];
 assert.equal(chooseAssignment(Date.parse('2026-10-10T06:00:00Z')/1000,'Europe/Moscow',aa,tt),null);
 const selected=chooseAssignment(Date.parse('2026-10-10T11:30:00Z')/1000,'Europe/Moscow',aa,tt);
 assert.equal(selected.templateName,'Вечерняя');
});
test('overnight employee uses previous date schedule',()=>{
 const night=template(9,'Ночная','21:00','09:00');
 const a=templateWindow('2026-10-10',night,'Europe/Moscow');
 assert.equal(new Date(a.endAt*1000).toISOString(),'2026-10-11T06:00:00.000Z');
 const t=Date.parse('2026-10-10T23:10:00Z')/1000;
 assert.deepEqual(daysAround(t,'Europe/Moscow'),['2026-10-10','2026-10-11','2026-10-12']);
 assert.equal(chooseAssignment(t,'Europe/Moscow',[{id:11,templateId:9,workDate:'2026-10-10'}],[night]).assignmentId,11);
});
test('invalid shift templates and missing assignment rejected',()=>{
 assert.throws(()=>validateTemplate('x','09:00','17:00'),DomainError);
 assert.throws(()=>validateTemplate('Утренняя','09:00','09:00'),DomainError);
 assert.throws(()=>validateTemplate('Утренняя','09:00','18:00',181),DomainError);
 assert.equal(chooseAssignment(Date.now()/1000,'Europe/Moscow',[],[]),null);
});
