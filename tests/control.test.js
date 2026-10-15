import test from 'node:test';
import assert from 'node:assert/strict';
import {controlDeadline,controlPhotos,controlStatus,controlCaption} from '../tgcloud/lib/control-rules.js';
import {shiftPhotoCaption} from '../tgcloud/lib/shift-caption.js';
import {portraitCrop,fullFrameSize} from '../web/portrait.js';
const now=Date.parse('2026-10-10T12:00:00Z')/1000;
test('control deadline uses organization timezone, rejects past, impossible dates and nonexistent DST time',()=>{
 assert.equal(controlDeadline('2026-10-10T16:00','Europe/Moscow',now),now+3600);
 for(const value of ['2026-10-10T14:59','2026-02-30T16:00','2026-10-10T25:00','2026-12-10T16:00','oops'])assert.throws(()=>controlDeadline(value,'Europe/Moscow',now));
 assert.throws(()=>controlDeadline('2026-03-29T02:30','Europe/Berlin',Date.parse('2026-03-28T12:00Z')/1000));
});
test('camera crops portrait and landscape streams to a central vertical 3:4 frame',()=>{
 for(const [w,h] of [[1920,1080],[1280,960],[960,1280],[1080,1920],[640,480]]){
  const p=portraitCrop(w,h);assert.equal(p.width/p.height,3/4);assert.ok(p.height<=1200&&p.x>=0&&p.y>=0);assert.ok(p.x+p.cropWidth<=w&&p.y+p.cropHeight<=h);assert.equal(p.x*2+p.cropWidth,w);assert.equal(p.y*2+p.cropHeight,h);
 }
 assert.throws(()=>portraitCrop(0,1080));
});
function jpeg(n=1024){const b=Buffer.alloc(n,1);b[0]=255;b[1]=216;b[n-2]=255;b[n-1]=217;return b.toString('base64');}
test('control accepts 1–10 JPEGs, bounds aggregate payload, rejects mixed invalid input',()=>{
 assert.equal(controlPhotos([jpeg()]).length,1);assert.equal(controlPhotos(Array(10).fill(jpeg())).length,10);
 for(const photos of [[],Array(11).fill(jpeg()),[jpeg(),'bad'],Array(10).fill(jpeg(110000))])assert.throws(()=>controlPhotos(photos));
});
test('public group captions include comments, local time and late status within Telegram caption limit',()=>{
 const comment='О'.repeat(500),request={deadlineAt:now,instruction:'П'.repeat(300)};
 for(const action of ['in','out'])for(const confirmed of [false,true]){
  const s=shiftPhotoCaption({action,employee:'И'.repeat(100),location:'Т'.repeat(100),eventAt:now,comment,confirmed,durationSeconds:36000});assert.ok(s.includes('Комментарий: '+comment));assert.ok(s.length<=1024);
 }
 const s=controlCaption({request,employee:'И'.repeat(100),location:'Т'.repeat(100),timezone:'Europe/Moscow',at:now+1,comment});
 assert.ok(s.includes('Комментарий: '+comment)&&s.includes('С опозданием')&&s.includes('GMT+3'));assert.ok(s.length<=1024,s.length);
});
test('deadline flags come from response time, allow late response and show uncertain delivery',()=>{
 const r={deadlineAt:now};assert.equal(controlStatus(r,null,now),'Ожидается ответ');assert.match(controlStatus(r,null,now+1),/Просрочено/);
 assert.equal(controlStatus(r,{status:'done',completedAt:now},now+1),'Получено · ждёт приёмки');assert.equal(controlStatus(r,{status:'done',completedAt:now+1},now+1),'Получено с опозданием · ждёт приёмки');assert.match(controlStatus(r,{status:'uncertain'},now),/Проверьте/);
});

test('workplace photos preserve full landscape frame including its edges',()=>{
 assert.deepEqual(fullFrameSize(1920,1080),{width:1200,height:675});
 assert.deepEqual(fullFrameSize(1080,1920),{width:675,height:1200});
 assert.deepEqual(fullFrameSize(640,480),{width:640,height:480});
 assert.throws(()=>fullFrameSize(0,480));
});
