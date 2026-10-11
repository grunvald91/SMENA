import {registerHooks} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const fake=new URL('./helpers/control-sdk.js',import.meta.url).href;
registerHooks({resolve(spec,ctx,next){if(spec==='sdk'||spec==='sdk/db'||spec.endsWith('/schema.js'))return {url:fake,shortCircuit:true};return next(spec,ctx);}});
const {rows,sent,reset,failWith,BotApiError}=await import('./helpers/control-sdk.js');
const {createControl,controlContext,beginControl,completeControl}=await import('../tgcloud/lib/control.js');
const sec=()=>Math.floor(Date.now()/1000),requestId='r'.repeat(32),token='q'.repeat(32);
function fixture(){
 reset();rows.organizations=[{id:1,ownerTgId:101,name:'Первая',timezone:'Europe/Moscow'},{id:2,ownerTgId:201,name:'Вторая',timezone:'Europe/Moscow'}];
 rows.locations=[{id:10,orgId:1,chatId:-10,name:'Кухня'},{id:20,orgId:2,chatId:-20,name:'Другая точка'}];
 rows.employees=[{id:11,orgId:1,tgId:111,active:1,name:'Первый'},{id:12,orgId:1,tgId:112,active:1,name:'Второй'},{id:21,orgId:2,tgId:211,active:1,name:'Чужой'}];
 rows.shifts=[{id:1,orgId:1,locationId:10,employeeId:11,endedAt:null}];rows.devices=[{id:1,orgId:1,locationId:10,revokedAt:null}];rows.qrPasses=[{token,orgId:1,locationId:10,deviceId:1,expiresAt:sec()+30}];
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+3600000)).map(p=>[p.type,p.value]));
 return {requestId,locationId:10,employeeId:'all',instruction:'Порядок и продукты',deadline:`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`};
}
function jpeg(){const b=Buffer.alloc(2048,1);b[0]=255;b[1]=216;b[2046]=255;b[2047]=217;return b.toString('base64');}
test('owner permissions, tenant isolation and snapshot all currently working recipients',async()=>{
 const input=fixture();await assert.rejects(createControl(111,input),e=>e.code==='FORBIDDEN');await assert.rejects(createControl(101,{...input,locationId:20}),e=>e.code==='BAD_LOCATION');await assert.rejects(createControl(101,{...input,employeeId:21}),e=>e.code==='NO_EMPLOYEES');
 await createControl(101,input);assert.deepEqual(rows.controlRequests[0].targets,[{id:11,name:'Первый'}]);assert.equal(sent[0].params.chat_id,-10);
 await createControl(101,input);assert.equal(rows.controlRequests.length,1);assert.equal(sent.length,1);
 assert.equal((await controlContext(111)).tasks.length,1);assert.equal((await controlContext(112)).tasks.length,0);assert.equal((await controlContext(201)).requests.length,0);assert.equal((await controlContext(211)).tasks.length,0);
 await assert.rejects(beginControl(112,requestId,token),e=>e.code==='FORBIDDEN');
 rows.qrPasses[0].locationId=20;await assert.rejects(beginControl(111,requestId,token),e=>e.code==='WRONG_LOCATION');
});
test('one authenticated response posts one album with public comment, then retries are idempotent',async()=>{
 await createControl(101,fixture());const intent=await beginControl(111,requestId,token);
 await assert.rejects(completeControl(112,intent.submissionId,[jpeg()],'Чужое'),e=>e.code==='FORBIDDEN');
 const result=await completeControl(111,intent.submissionId,[jpeg(),jpeg()],' Всё в порядке ');assert.equal(result.photoCount,2);
 assert.equal(sent[1].method,'sendMediaGroup');assert.equal(sent[1].params.media.length,2);assert.match(sent[1].params.media[0].caption,/Комментарий: Всё в порядке/);assert.equal(sent[1].params.reply_parameters.message_id,101);
 assert.equal((await completeControl(111,intent.submissionId)).alreadyDone,true);assert.equal(sent.length,2);
 const owner=await controlContext(101);assert.equal(owner.requests[0].recipients[0].comment,'Всё в порядке');assert.equal((await controlContext(111)).requests.length,0);
});
test('expired session, revoked device and invalid photos send nothing; late answer is explicitly flagged',async()=>{
 await createControl(101,fixture());const intent=await beginControl(111,requestId,token),sub=rows.controlSubmissions[0];
 sub.expiresAt=sec()-1;await assert.rejects(completeControl(111,intent.submissionId,[jpeg()]),e=>e.code==='EXPIRED');sub.expiresAt=sec()+30;
 rows.devices[0].revokedAt=sec();await assert.rejects(completeControl(111,intent.submissionId,[jpeg()]),e=>e.code==='DEVICE_REVOKED');rows.devices[0].revokedAt=null;
 await assert.rejects(completeControl(111,intent.submissionId,[]),e=>e.code==='BAD_PHOTOS');assert.equal(sent.length,1);
 rows.controlRequests[0].deadlineAt=sec()-1;const r=await completeControl(111,intent.submissionId,[jpeg()],'Готово');assert.equal(r.late,true);assert.equal(sent[1].method,'sendPhoto');assert.match(sent[1].params.caption,/С опозданием/);
});
test('known Telegram rejection permits retry; unknown network result blocks duplicate publication',async()=>{
 await createControl(101,fixture());const intent=await beginControl(111,requestId,token);
 failWith(new BotApiError(403));await assert.rejects(completeControl(111,intent.submissionId,[jpeg()]));assert.equal(rows.controlSubmissions[0].status,'pending');
 failWith(new Error('network timeout'));await assert.rejects(completeControl(111,intent.submissionId,[jpeg()]));assert.equal(rows.controlSubmissions[0].status,'uncertain');
 failWith(null);const count=sent.length;await assert.rejects(completeControl(111,intent.submissionId,[jpeg()]),e=>e.code==='DELIVERY_UNCERTAIN');assert.equal(sent.length,count);
});
