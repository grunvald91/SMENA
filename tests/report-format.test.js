import test from 'node:test';
import assert from 'node:assert/strict';
import {reportRange,reportDate,reportMoment,formatReport} from '../tgcloud/lib/report-format.js';
test('human report periods include the final worked day across month, year and leap-day boundaries',()=>{
 assert.equal(reportRange({start:'2026-10-01',endExclusive:'2026-10-11'}),'1 октября 2026 — 10 октября 2026');
 assert.equal(reportRange({start:'2024-02-01',endExclusive:'2024-03-01'}),'1 февраля 2024 — 29 февраля 2024');
 assert.equal(reportRange({start:'2026-12-31',endExclusive:'2027-01-01'}),'31 декабря 2026');
 assert.throws(()=>reportDate('2026-02-30'));
});
test('display hides timezone labels while preserving organization-local date and time',()=>{
 const stamp=Date.parse('2026-10-10T22:30:00Z')/1000;
 assert.equal(reportMoment(stamp,'Europe/Moscow'),'11 октября 2026, 01:30');
 assert.equal(reportMoment(stamp,'UTC'),'10 октября 2026, 22:30');
});
test('concise report keeps amounts, bonuses and actual attendance exceptions without explanatory footers',()=>{
 const r={period:{start:'2026-10-01',endExclusive:'2026-10-11',tz:'Europe/Moscow'},entries:[{name:'Анна',hours:8,grossKopeks:270000,bonusKopeks:30000,unclosed:1}],totals:{grossKopeks:270000,unclosed:1},exceptions:[{name:'Анна',status:'early',differenceMinutes:-30,plannedEndAt:1791644400,endedAt:1791642600,closeComment:'По согласованию'}],missingAssignments:[{name:'Иван',workDate:'2026-10-09',templateName:'Утренняя'}]};
 const text=formatReport(r);
 assert.match(text,/Анна: 8 ч · 2[\s\u00a0]700,00 ₽ \(надбавки 300,00 ₽\)/);
 assert.match(text,/незакрытых смен: 1/);assert.match(text,/раньше на 30 мин/);assert.match(text,/По согласованию/);assert.match(text,/9 октября 2026 · Иван · Утренняя/);
 assert.doesNotMatch(text,/НДФЛ|бухгалтер|удержан|требуется проверка|часовой пояс|GMT|Europe|не включая|2026-10/i);
 const ordinary=formatReport({...r,exceptions:[],missingAssignments:[],entries:[{...r.entries[0],bonusKopeks:0,unclosed:0}],totals:{...r.totals,unclosed:0}});
 assert.doesNotMatch(ordinary,/надбавки|незакрытых|Отклонения|без отметки/);
 assert.match(ordinary.trim().split('\n').at(-1),/^Итого: /);
});
